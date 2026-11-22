"use client";

// Scenario Studio: graph editor for Strategic TTX and Document TTX templates.
// Canvas on the left, a side panel with the selected inject, its branches,
// template settings and checks on the right. Edits stay local until saved;
// the server checks the same rules (src/studio/validate.ts) and refuses a
// save when someone else saved first.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Copy, Download, Loader2, Plus, Save, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { BuildGuideDialog } from "@/components/templates/build-guide-dialog";
import { STRATEGIC_LABELS } from "@/lib/exercise/build-guide/labels";
import { STRATEGIC_DEFAULT_INJECTS, STRATEGIC_STEPS, buildStrategicPrompt } from "@/lib/exercise/build-guide/strategic-prompt";
import { STATUS_LABELS, launchHref, statusVariant } from "@/components/templates/labels";
import {
  addBranch,
  addInject,
  duplicateInject,
  normalizeGraph,
  removeInject,
  setBranching,
  toPutGraph,
  updateInject,
  type DraftGraph,
} from "@/lib/exercise/studio/editor";
import { blocksPublish, hasErrors, type StudioIssue } from "@/lib/exercise/studio/graph";
import { autoLayout, layoutEdges, type LayoutDirection } from "@/lib/exercise/studio/layout";
import { STUDIO_MODE_LABELS, type StudioMode } from "@/lib/exercise/studio/schema";
import { validateStudio } from "@/lib/exercise/studio/validate";
import { BranchesPanel } from "./branches-panel";
import { StudioCanvas } from "./canvas";
import { ChecksPanel } from "./checks-panel";
import { NodePanel } from "./node-panel";
import { SettingsPanel, type DocumentInfo } from "./settings-panel";

interface Loaded {
  template: {
    id: string;
    mode: StudioMode;
    title: string;
    summary: string | null;
    status: string;
    version: number;
    branching: "linear" | "branched";
    config: unknown;
    objectives: unknown;
    updatedAt: string;
  };
  injects: unknown[];
  branches: unknown[];
  rubricKeys: string[];
  document: (DocumentInfo & { sections: Array<{ id: string; heading: string }> }) | null;
  inUse: boolean;
  ready: boolean;
}

type Tab = "inject" | "branches" | "template" | "checks";

function overlapping(g: DraftGraph): boolean {
  const seen = new Set<string>();
  for (const i of g.injects) {
    const k = `${Math.round(i.position.x / 20)}:${Math.round(i.position.y / 20)}`;
    if (seen.has(k)) return true;
    seen.add(k);
  }
  return false;
}

function layout(g: DraftGraph, dir: LayoutDirection): DraftGraph {
  const pos = autoLayout(
    g.injects.map((i) => i.nodeId),
    layoutEdges(g.template.branching, g.injects, g.branches),
    dir,
  );
  return { ...g, injects: g.injects.map((i) => ({ ...i, position: { ...i.position, ...(pos.get(i.nodeId) ?? {}) } })) };
}

export function Studio({ id, canLaunch }: { id: string; canLaunch: boolean }) {
  return (
    <ConfirmDialogProvider>
      <StudioInner id={id} canLaunch={canLaunch} />
    </ConfirmDialogProvider>
  );
}

function StudioInner({ id, canLaunch }: { id: string; canLaunch: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [meta, setMeta] = useState<Loaded | null>(null);
  const [graph, setGraph] = useState<DraftGraph | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [serverIssues, setServerIssues] = useState<StudioIssue[]>([]);
  const [busy, setBusy] = useState<null | "save" | "publish" | "duplicate" | "import">(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("template");
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [capabilities, setCapabilities] = useState<Array<{ value: string; label: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/studio/templates/${id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as (Loaded & { error?: string }) | null;
      if (!res.ok || !data?.template) {
        setLoadError(data?.error ?? "The template did not load. Try again.");
        return;
      }
      let g = normalizeGraph(data.template.mode, data.template, data.injects, data.branches);
      if (g.injects.length > 1 && overlapping(g)) g = layout(g, "TB");
      setMeta(data);
      setGraph(g);
      setUpdatedAt(data.template.updatedAt);
      setDirty(false);
      setConflict(false);
      setServerIssues([]);
      setLoadError(null);
      setSelected((cur) => (cur && g.injects.some((i) => i.nodeId === cur) ? cur : (g.injects[0]?.nodeId ?? null)));
      if (g.injects.length) setTab((t) => (t === "template" ? "inject" : t));
    } catch {
      setLoadError("The template did not load. Check your connection and try again.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/capabilities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { capabilities?: Array<{ key: string; name: string }> } | null) => {
        if (alive && d?.capabilities) setCapabilities(d.capabilities.map((c) => ({ value: c.key, label: `${c.key} ${c.name}` })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mode = meta?.template.mode ?? "strategic";
  const readOnly = !meta || meta.inUse || !meta.ready;

  const issues = useMemo(() => {
    if (!graph) return [];
    const local = validateStudio(mode, toPutGraph(mode, graph)).issues;
    const seen = new Set(local.map((i) => i.message));
    return [...local, ...serverIssues.filter((i) => !seen.has(i.message))];
  }, [graph, mode, serverIssues]);

  const severityByNode = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) {
      if (!i.nodeId || i.severity === "info") continue;
      if (i.severity === "error" || !m.has(i.nodeId)) m.set(i.nodeId, i.severity);
    }
    return m;
  }, [issues]);

  const update = useCallback((fn: (g: DraftGraph) => DraftGraph) => {
    setGraph((g) => (g ? fn(g) : g));
    setDirty(true);
    setServerIssues([]);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!graph || !meta) return false;
    if (hasErrors(issues)) {
      setTab("checks");
      toast.error("Fix the errors before saving.");
      return false;
    }
    setBusy("save");
    try {
      const res = await fetch(`/api/studio/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: updatedAt, graph: toPutGraph(mode, graph) }),
      });
      const data = (await res.json().catch(() => null)) as { updatedAt?: string; error?: string; issues?: StudioIssue[] } | null;
      if (res.status === 409) {
        setConflict(true);
        toast.error(data?.error ?? "The template was not saved. Reload and try again.");
        return false;
      }
      if (!res.ok || !data?.updatedAt) {
        if (data?.issues?.length) {
          setServerIssues(data.issues);
          setTab("checks");
        }
        toast.error(data?.error ?? "The template was not saved. Try again.");
        return false;
      }
      setUpdatedAt(data.updatedAt);
      setDirty(false);
      toast.success("Saved.");
      return true;
    } catch {
      toast.error("The template was not saved. Check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }, [graph, meta, issues, id, updatedAt, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!readOnly && dirty) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, readOnly, dirty]);

  async function publish() {
    if (!graph) return;
    if (blocksPublish(issues)) {
      setTab("checks");
      toast.error("Fix the errors and warnings before publishing.");
      return;
    }
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      const res = await fetch(`/api/studio/templates/${id}/publish`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { error?: string; issues?: StudioIssue[] } | null;
      if (!res.ok) {
        if (data?.issues?.length) {
          setServerIssues(data.issues);
          setTab("checks");
        }
        toast.error(data?.error ?? "The template was not published. Try again.");
        return;
      }
      toast.success("Published.");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function duplicate() {
    if (dirty && !(await confirm({ title: "Duplicate the saved version?", description: "Unsaved changes are not copied.", confirmLabel: "Duplicate" }))) return;
    setBusy("duplicate");
    try {
      const res = await fetch(`/api/studio/templates/${id}/duplicate`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? "The template was not duplicated. Try again.");
        return;
      }
      setDirty(false);
      router.push(`/studio/${data.id}`);
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    if (!(await confirm({ title: "Archive this template?", description: "It leaves the template picker. Exercises that used it keep their copy.", confirmLabel: "Archive" }))) return;
    const res = await fetch(`/api/templates/${id}/archive`, { method: "POST" });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      toast.error(data?.error ?? "The template was not archived. Try again.");
      return;
    }
    toast.success("Archived.");
    await load();
  }

  function exportFile() {
    if (dirty) toast.message("The export uses the saved version. Save first to include your changes.");
    window.location.href = `/api/templates/${id}/export`;
  }

  async function importFile(file: File) {
    setBusy("import");
    try {
      if (file.size > 2 * 1024 * 1024) {
        toast.error("The file is larger than 2 MB. Pick a template export file.");
        return;
      }
      const res = await fetch("/api/templates/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      const data = (await res.json().catch(() => null)) as { id?: string; href?: string; error?: string; warnings?: string[]; issues?: unknown[] } | null;
      if (!res.ok || !data?.id) {
        toast.error(data?.error ?? "The template was not imported. Check the file and try again.");
        return;
      }
      for (const w of data.warnings ?? []) toast.warning(w);
      toast.success(data.issues?.length ? "Imported as a draft. Fix the listed problems before publishing." : "Imported as a draft.");
      router.push(data.href ?? `/templates/${data.id}`);
    } catch {
      toast.error("The file could not be read. Pick a template export file.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteNode(nodeId: string) {
    const n = graph?.injects.find((i) => i.nodeId === nodeId);
    if (!n) return;
    const ok = await confirm({ title: "Delete this inject?", description: "Its branches are removed too.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    update((g) => removeInject(g, nodeId));
    setSelected(null);
  }

  if (!meta || !graph) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        {loadError ? (
          <Card className="max-w-xl">
            <p className="text-[13px]">{loadError}</p>
            <div>
              <Button variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </Card>
        ) : (
          <div className="flex items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading
          </div>
        )}
      </div>
    );
  }

  const t = meta.template;
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "inject", label: STRATEGIC_LABELS.injectTab },
    { key: "branches", label: STRATEGIC_LABELS.branchesTab },
    { key: "template", label: STRATEGIC_LABELS.templateTab },
    { key: "checks", label: errorCount + warnCount ? `${STRATEGIC_LABELS.checksTab} (${errorCount + warnCount})` : STRATEGIC_LABELS.checksTab },
  ];
  const cfg = graph.template.config as typeof graph.template.config & {
    scenarioAnchor?: { weekday: number; time: string } | null;
    targetDurationMin?: number;
    executiveBriefMd?: string;
    scenario?: { crisisType?: string; threatActorKey?: string | null; replayKey?: string | null; industryKey?: string | null };
  };
  const buildPrompt = (injectCount: number) =>
    buildStrategicPrompt({
      title: graph.template.title,
      summary: graph.template.summary,
      executiveBrief: cfg.executiveBriefMd,
      crisisType: cfg.scenario?.crisisType,
      teams: cfg.teams,
      targetDurationMin: cfg.targetDurationMin,
      anchor: cfg.scenarioAnchor,
      clocks: cfg.regulatoryClocks,
      objectives: graph.template.objectives,
      injects: [...graph.injects].sort((a, b) => a.seq - b.seq),
      injectCount,
      reference: cfg.scenario,
    });

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="headline truncate">{graph.template.title || "Untitled template"}</h1>
          <Badge variant={statusVariant(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</Badge>
          <Badge variant="outline">{STUDIO_MODE_LABELS[mode]}</Badge>
          {dirty && <Badge variant="warning">Unsaved</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Flow" className="inline-flex rounded-md border border-[color:var(--color-border)] p-0.5">
            {(["linear", "branched"] as const).map((b) => (
              <button
                key={b}
                type="button"
                disabled={readOnly}
                aria-pressed={graph.template.branching === b}
                onClick={() => {
                  if (graph.template.branching === b) return;
                  update((g) => {
                    const next = setBranching(g, b);
                    return g.branches.length === 0 && b === "branched" ? layout(next, direction) : next;
                  });
                }}
                className={cn(
                  "rounded px-2.5 py-1 text-[13px] font-medium disabled:opacity-50",
                  graph.template.branching === b ? "bg-[color:var(--color-muted)]" : "text-[color:var(--color-muted-foreground)]",
                )}
              >
                {b === "linear" ? "Linear" : "Branched"}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() => {
              const r = addInject(mode, graph, selected);
              update(() => r.graph);
              setSelected(r.nodeId);
              setSelectedBranch(null);
              setTab("inject");
            }}
          >
            <Plus className="h-4 w-4" />
            Add inject
          </Button>
          <Button disabled={readOnly || !dirty || busy !== null} onClick={() => void save()}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button variant="accent" disabled={readOnly || busy !== null} onClick={() => void publish()}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Publish
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null || !meta.ready} onClick={() => void duplicate()}>
          <Copy className="h-4 w-4" />
          Duplicate
        </Button>
        <Button size="sm" variant="outline" disabled={!meta.ready} onClick={exportFile}>
          <Download className="h-4 w-4" />
          Export
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
          }}
        />
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import
        </Button>
        {t.status !== "archived" && (
          <Button size="sm" variant="ghost" disabled={busy !== null || !meta.ready} onClick={() => void archive()}>
            Archive
          </Button>
        )}
        {mode === "strategic" && (
          <BuildGuideDialog
            size="sm"
            editorName="Scenario Studio"
            steps={STRATEGIC_STEPS}
            defaultCount={graph.injects.length || STRATEGIC_DEFAULT_INJECTS}
            buildPrompt={buildPrompt}
            cloudNote={<CloudSeam feature="strategic-injects" className="border-t border-[color:var(--color-border)] pt-3" />}
          />
        )}
        {canLaunch && t.status === "published" && !dirty && (
          <Button size="sm" variant="ghost" asChild>
            <Link href={launchHref({ id: t.id, mode })}>Launch</Link>
          </Button>
        )}
      </div>

      {meta.inUse && (
        <Banner tone="warn">An exercise using this template has not ended. Duplicate the template to make changes.</Banner>
      )}
      {conflict && (
        <Banner tone="danger">
          Someone saved this template after you opened it.{" "}
          <button type="button" className="font-medium underline" onClick={() => void load()}>
            Reload
          </button>{" "}
          to see their changes. Your unsaved edits are lost on reload.
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="h-[72vh] min-h-[520px] gap-0 overflow-hidden p-0">
          {graph.injects.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No injects yet.</p>
              <Button
                variant="outline"
                disabled={readOnly}
                onClick={() => {
                  const r = addInject(mode, graph, null);
                  update(() => r.graph);
                  setSelected(r.nodeId);
                  setTab("inject");
                }}
              >
                <Plus className="h-4 w-4" />
                Add inject
              </Button>
            </div>
          ) : (
            <StudioCanvas
              mode={mode}
              graph={graph}
              severityByNode={severityByNode}
              selectedNodeId={selected}
              selectedBranch={selectedBranch}
              readOnly={readOnly}
              direction={direction}
              onDirection={(d) => {
                setDirection(d);
                if (!readOnly) update((g) => layout(g, d));
              }}
              onSelectNode={(nodeId) => {
                setSelected(nodeId);
                setSelectedBranch(null);
                if (nodeId && (tab === "template" || tab === "checks")) setTab("inject");
              }}
              onSelectBranch={(index) => {
                const b = graph.branches[index];
                if (!b) return;
                setSelected(b.fromNodeId);
                setSelectedBranch(index);
                setTab("branches");
              }}
              onConnect={(from, to) => {
                update((g) => addBranch(mode, g, from, to));
                setSelected(from);
                setSelectedBranch(null);
                setTab("branches");
              }}
              onMoveNode={(nodeId, pos) => update((g) => updateInject(g, nodeId, (i) => ({ ...i, position: { ...i.position, ...pos } })))}
              onLayout={() => update((g) => layout(g, direction))}
            />
          )}
        </Card>

        <Card className="h-[72vh] min-h-[520px] gap-0 overflow-hidden p-0">
          <div role="tablist" aria-label="Studio panels" className="flex border-b border-[color:var(--color-border)] px-2">
            {tabs.map((x) => (
              <button
                key={x.key}
                role="tab"
                type="button"
                aria-selected={tab === x.key}
                onClick={() => setTab(x.key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium",
                  tab === x.key ? "border-[color:var(--mist-indigo)] text-[color:var(--color-foreground)]" : "border-transparent text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]",
                  x.key === "checks" && errorCount > 0 && "text-[color:var(--mist-danger)]",
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
            {tab === "inject" && (
              <NodePanel
                mode={mode}
                templateId={id}
                graph={graph}
                nodeId={selected}
                readOnly={readOnly}
                issues={issues}
                capabilities={capabilities}
                sections={(meta.document?.sections ?? []).map((s) => ({ value: s.id, label: s.heading }))}
                rubricKeys={meta.rubricKeys}
                update={update}
                onDuplicate={(nodeId) => {
                  const r = duplicateInject(graph, nodeId);
                  update(() => r.graph);
                  setSelected(r.nodeId);
                }}
                onDelete={(nodeId) => void deleteNode(nodeId)}
              />
            )}
            {tab === "branches" && (
              <BranchesPanel
                mode={mode}
                graph={graph}
                nodeId={selected}
                selectedBranch={selectedBranch}
                readOnly={readOnly}
                update={update}
                onSelectNode={(nodeId) => {
                  setSelected(nodeId);
                  setSelectedBranch(null);
                }}
              />
            )}
            {tab === "template" && (
              <SettingsPanel
                mode={mode}
                templateId={id}
                graph={graph}
                readOnly={readOnly}
                issues={issues}
                capabilities={capabilities}
                document={meta.document}
                update={update}
              />
            )}
            {tab === "checks" && (
              <ChecksPanel
                graph={graph}
                issues={issues}
                onSelectNode={(nodeId) => {
                  setSelected(nodeId);
                  setSelectedBranch(null);
                  setTab("inject");
                }}
                onSelectBranch={(index) => {
                  const b = graph.branches[index];
                  if (!b) return;
                  setSelected(b.fromNodeId);
                  setSelectedBranch(index);
                  setTab("branches");
                }}
                onTemplate={() => setTab("template")}
              />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/templates"
      className="inline-flex w-fit items-center gap-1 text-[13px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
    >
      <ChevronLeft className="h-4 w-4" />
      Templates
    </Link>
  );
}

function Banner({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "rounded-md px-3 py-2 text-[13px]",
        tone === "warn" && "bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] text-[color:var(--mist-warn)]",
        tone === "danger" && "bg-[color:color-mix(in_srgb,var(--mist-danger),transparent_88%)] text-[color:var(--mist-danger)]",
      )}
    >
      {children}
    </div>
  );
}
