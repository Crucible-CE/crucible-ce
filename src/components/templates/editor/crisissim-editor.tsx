"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, Copy, Download, Loader2, Play, Plus, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import type { ValidationIssue } from "@/lib/exercise/modes/crisissim/validate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { CRISISSIM_DEFAULT_INJECTS, CRISISSIM_STEPS, buildCrisisSimPrompt } from "@/lib/exercise/build-guide/crisissim-prompt";
import { BuildGuideDialog } from "../build-guide-dialog";
import { EditorHeading } from "./editor-heading";
import { InjectEditor } from "./inject-editor";
import { IssuesList } from "./issues-list";
import { ReferenceCard } from "./scenario-library";
import { ScenarioSettings } from "./scenario-settings";
import { ScorePreview } from "./score-preview";
import {
  fetchTemplate,
  formatOffset,
  fromApi,
  liveIssues,
  newInject,
  produce,
  toBody,
  type ApiTemplate,
  type EditorInject,
  type EditorState,
  type TemplateStatus,
} from "./state";

type View = { kind: "scenario" } | { kind: "issues" } | { kind: "preview" } | { kind: "inject"; key: string };
type Busy = "save" | "publish" | "archive" | "duplicate" | "launch" | null;
type ApiError = { error?: string; issues?: ValidationIssue[]; details?: unknown } | null;

const MAX_INJECTS = 30;

export function CrisisSimEditor({ initial }: { initial: ApiTemplate }) {
  const router = useRouter();
  const confirm = useConfirm();
  const id = initial.template.id;

  const [state, setState] = useState<EditorState>(() => fromApi(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(toBody(fromApi(initial))));
  const [status, setStatus] = useState<TemplateStatus>(initial.template.status);
  const [view, setView] = useState<View>({ kind: "scenario" });
  const [busy, setBusy] = useState<Busy>(null);
  // Issues from the last save or publish. Stored issues on load already show in the live list.
  const [serverIssues, setServerIssues] = useState<{ title: string; issues: ValidationIssue[] } | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Array<{ value: string; label: string }>>([]);

  const dirty = useMemo(() => JSON.stringify(toBody(state)) !== saved, [state, saved]);
  const deferred = useDeferredValue(state);
  const issues = useMemo(() => liveIssues(deferred), [deferred]);
  const issueCount = useMemo(() => {
    const m = new Map<number | null, number>();
    for (const i of issues) m.set(i.inject, (m.get(i.inject) ?? 0) + 1);
    return m;
  }, [issues]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { capabilities?: Array<{ key: string; name: string }> } | null) => {
        if (cancelled || !d?.capabilities) return;
        setCapabilities(d.capabilities.map((c) => ({ value: c.key, label: c.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const update = useCallback((fn: (s: EditorState) => EditorState) => setState(fn), []);
  const buildPrompt = useCallback(
    (injectCount: number) =>
      buildCrisisSimPrompt({
        title: state.title,
        summary: state.summary,
        orgName: state.config.orgName,
        executiveBrief: state.config.executiveBriefMd,
        teams: state.config.teams,
        thresholds: state.config.pathThresholds,
        targetDurationMin: state.config.targetDurationMin,
        anchor: state.config.scenarioAnchor,
        clocks: state.config.regulatoryClocks,
        objectives: state.objectives,
        injects: state.injects,
        injectCount,
        reference: state.config,
      }),
    [state],
  );
  const editInject = useCallback(
    (key: string) => (fn: (d: EditorInject) => void) =>
      setState((s) => ({ ...s, injects: s.injects.map((x) => (x.key === key ? produce(x, fn) : x)) })),
    [],
  );

  const selectedIndex = view.kind === "inject" ? state.injects.findIndex((i) => i.key === view.key) : -1;

  function jump(inject: number | null) {
    if (inject === null) setView({ kind: "scenario" });
    else if (state.injects[inject]) setView({ kind: "inject", key: state.injects[inject].key });
  }

  function addInject() {
    const inj = newInject(state);
    setState((s) => ({ ...s, injects: [...s.injects, inj] }));
    setView({ kind: "inject", key: inj.key });
  }

  function moveInject(index: number, dir: -1 | 1) {
    setState((s) => {
      const j = index + dir;
      if (j < 0 || j >= s.injects.length) return s;
      const injects = [...s.injects];
      [injects[index], injects[j]] = [injects[j], injects[index]];
      return { ...s, injects };
    });
  }

  function deleteInject(index: number) {
    const remaining = state.injects.filter((_, i) => i !== index);
    setState((s) => ({ ...s, injects: s.injects.filter((_, i) => i !== index) }));
    const next = remaining[Math.min(index, remaining.length - 1)];
    setView(next ? { kind: "inject", key: next.key } : { kind: "scenario" });
  }

  async function save() {
    setBusy("save");
    const viewIndex = selectedIndex;
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toBody(state)),
      });
      const data = (await res.json().catch(() => null)) as ({ ok?: boolean } & NonNullable<ApiError>) | null;
      if (!res.ok) {
        if (data?.details) {
          toast.error("The template was not saved. Fix the listed problems and try again.");
          setView({ kind: "issues" });
        } else {
          toast.error(data?.error ?? "The template was not saved. Try again.");
        }
        return;
      }
      const found = data?.issues ?? [];
      setServerIssues(found.length ? { title: "Saved with problems", issues: found } : null);

      // Reload so new injects get their ids.
      const fresh = await fetchTemplate(id);
      if (fresh.data) {
        const next = fromApi(fresh.data);
        setState(next);
        setSaved(JSON.stringify(toBody(next)));
        setStatus(fresh.data.template.status);
        if (viewIndex >= 0 && next.injects[viewIndex]) setView({ kind: "inject", key: next.injects[viewIndex].key });
      } else {
        setSaved(JSON.stringify(toBody(state)));
        toast.error("Saved, but the template did not reload. Reload the page before more edits.");
        return;
      }
      toast.success(found.length ? "Saved. Fix the listed problems before publishing." : "Saved.");
    } catch {
      toast.error("The template was not saved. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function post(path: string, body?: unknown) {
    const res = await fetch(`/api/templates/${id}/${path}`, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as (NonNullable<ApiError> & { id?: string }) | null;
    return { res, data };
  }

  async function publish() {
    setBusy("publish");
    try {
      const { res, data } = await post("publish");
      if (!res.ok) {
        if (data?.issues?.length) {
          setServerIssues({ title: "Not published", issues: data.issues });
        }
        toast.error(data?.error ?? "The template was not published. Try again.");
        return;
      }
      setStatus("published");
      setServerIssues(null);
      toast.success("Published.");
    } catch {
      toast.error("The template was not published. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    const ok = await confirm({ title: "Archive this template?", confirmLabel: "Archive" });
    if (!ok) return;
    setBusy("archive");
    try {
      const { res, data } = await post("archive");
      if (!res.ok) {
        toast.error(data?.error ?? "The template was not archived. Try again.");
        return;
      }
      setStatus("archived");
      toast.success("Archived.");
    } catch {
      toast.error("The template was not archived. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    setBusy("duplicate");
    try {
      const { res, data } = await post("duplicate");
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? "The template was not copied. Try again.");
        setBusy(null);
        return;
      }
      router.push(`/templates/${data.id}`);
    } catch {
      toast.error("The template was not copied. Check your connection and try again.");
      setBusy(null);
    }
  }

  async function launch() {
    setBusy("launch");
    setLaunchError(null);
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "crisissim", templateId: id, title: state.title }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setLaunchError(data?.error ?? "The exercise was not created. Try again.");
        setBusy(null);
        return;
      }
      router.push(`/exercises/${data.id}`);
    } catch {
      setLaunchError("The exercise was not created. Check your connection and try again.");
      setBusy(null);
    }
  }

  const blockedHint = dirty ? "Save your changes first." : status !== "published" ? "Publish the template to launch it." : null;

  return (
    <div className="flex flex-col gap-6">
      <EditorHeading
        title={state.title || initial.template.title}
        status={status}
        actions={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" disabled={!dirty || busy !== null} onClick={() => void save()}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
              <Button variant="default" disabled={dirty || busy !== null} onClick={() => void publish()}>
                {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publish
              </Button>
              <Button variant="outline" disabled={dirty || busy !== null || status !== "published"} onClick={() => void launch()}>
                {busy === "launch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Launch exercise
              </Button>
              <Button variant="outline" disabled={dirty || busy !== null} onClick={() => void duplicate()}>
                {busy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                Duplicate
              </Button>
              {dirty ? (
                <Button variant="outline" disabled>
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <a href={`/api/templates/${id}/export`} download>
                    <Download className="h-4 w-4" />
                    Export
                  </a>
                </Button>
              )}
              <BuildGuideDialog
                editorName="Crisis Sim"
                steps={CRISISSIM_STEPS}
                defaultCount={state.injects.length || CRISISSIM_DEFAULT_INJECTS}
                buildPrompt={buildPrompt}
                cloudNote={<CloudSeam feature="crisissim-generate" className="border-t border-[color:var(--color-border)] pt-3" />}
              />
              <Button variant="ghost" disabled={busy !== null || status === "archived"} onClick={() => void archive()}>
                {busy === "archive" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                Archive
              </Button>
            </div>
            {blockedHint && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{blockedHint}</p>}
            {launchError && (
              <p role="alert" className="text-[12px] text-[color:var(--mist-danger)]">
                {launchError}
              </p>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Template sections" className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Card dense className="gap-1 p-2">
            <NavItem active={view.kind === "scenario"} onClick={() => setView({ kind: "scenario" })} count={issueCount.get(null)}>
              Scenario
            </NavItem>
            <NavItem active={view.kind === "issues"} onClick={() => setView({ kind: "issues" })}>
              <span className="flex-1">Problems</span>
              <Badge variant={issues.length ? "warning" : "success"}>{issues.length}</Badge>
            </NavItem>
            <NavItem active={view.kind === "preview"} onClick={() => setView({ kind: "preview" })}>
              Score preview
            </NavItem>
          </Card>
          <Card dense className="gap-1 p-2">
            <div className="flex items-center justify-between px-2 py-1">
              <h2 className="text-[13px] font-semibold">Injects</h2>
              <Button size="xs" variant="ghost" disabled={state.injects.length >= MAX_INJECTS} onClick={addInject}>
                <Plus />
                Add
              </Button>
            </div>
            {state.injects.length === 0 && (
              <p className="px-2 py-1 text-[12px] text-[color:var(--color-muted-foreground)]">No injects yet.</p>
            )}
            <ol className="flex flex-col gap-0.5">
              {state.injects.map((inj, i) => (
                <li key={inj.key}>
                  <NavItem
                    active={view.kind === "inject" && view.key === inj.key}
                    onClick={() => setView({ kind: "inject", key: inj.key })}
                    count={issueCount.get(i)}
                  >
                    <span className="w-5 shrink-0 text-[12px] text-[color:var(--color-muted-foreground)]">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{inj.title || "Untitled"}</span>
                      <span className="block text-[11px] text-[color:var(--color-muted-foreground)]">
                        {formatOffset(inj.scenarioOffsetMin)}
                      </span>
                    </span>
                  </NavItem>
                </li>
              ))}
            </ol>
          </Card>
        </nav>

        <fieldset disabled={busy === "save"} className="flex min-w-0 flex-col gap-6">
          {serverIssues && (
            <Card className="border-l-4 border-[color:var(--mist-warn)]">
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <AlertTriangle className="h-4 w-4 text-[color:var(--mist-warn)]" />
                  {serverIssues.title}
                </h2>
                <Button size="icon-sm" variant="ghost" aria-label="Hide" onClick={() => setServerIssues(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <IssuesList issues={serverIssues.issues} injectTitles={state.injects.map((i) => i.title)} onJump={jump} />
            </Card>
          )}

          {view.kind === "scenario" && <ScenarioSettings state={state} update={update} capabilities={capabilities} />}

          {view.kind === "issues" && (
            <Card>
              <h2 className="text-base font-semibold">Problems</h2>
              {issues.length === 0 ? (
                <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No problems found.</p>
              ) : (
                <IssuesList issues={issues} injectTitles={state.injects.map((i) => i.title)} onJump={jump} />
              )}
            </Card>
          )}

          {view.kind === "preview" && <ScorePreview state={deferred} />}

          {view.kind === "inject" && selectedIndex >= 0 && (
            <InjectEditor
              key={state.injects[selectedIndex].key}
              templateId={id}
              state={state}
              index={selectedIndex}
              capabilities={capabilities}
              edit={editInject(state.injects[selectedIndex].key)}
              onMove={(dir) => moveInject(selectedIndex, dir)}
              onDelete={() => deleteInject(selectedIndex)}
            />
          )}
          {view.kind === "inject" && selectedIndex >= 0 && (
            <ReferenceCard keys={state.config} className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" />
          )}
        </fieldset>
      </div>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
        active ? "bg-[color:var(--mist-indigo-soft)] text-[color:var(--mist-indigo)]" : "hover:bg-[color:var(--color-muted)]",
      )}
    >
      {children}
      {count ? (
        <span
          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_85%)] px-1 text-[11px] font-medium text-[color:var(--mist-warn)]"
          aria-label={`${count} problems`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
