"use client";

// Playbook Exercise template editor: modules, questions, expected actions and
// rubric criteria, written by hand with the source document beside them.
// Lives at /documents/templates/[id] and inside the new Playbook Exercise
// flow. Reads and writes /api/documents/templates/[id]/**.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Archive, ArrowDown, ArrowUp, ChevronDown, Copy, Loader2, Network, Play, Plus, Quote, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { QUESTION_CATEGORIES, QUESTION_CATEGORY_LABELS } from "@/lib/exercise/modes/document/schema";
import { request } from "./api";
import { DocumentPane, type PaneSection } from "./document-pane";

// ---------------------------------------------------------------------------
// Types (GET /api/documents/templates/[id])
// ---------------------------------------------------------------------------

interface Question {
  key: string;
  text: string;
  category: string;
  capabilityKeys: string[];
  objectiveKeys: string[];
  docSectionRefs: string[];
}
interface ModuleDraft {
  id?: string;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  content: {
    schemaVersion: 1;
    scenarioUpdate: string;
    rationale?: string;
    keyIssues: string[];
    sourceExcerpt?: string;
    docSectionRefs: string[];
    questions: Question[];
  };
  secret: { schemaVersion: 1; expectedActions: string[] };
}
interface Criterion {
  id: string;
  text: string;
  controlRefs: Array<{ framework: string; controlId: string }>;
}
interface RubricDraft {
  questionKey: string;
  criteria: Criterion[];
  modelAnswer: string | null;
  capabilityKey: string | null;
}
interface Objective {
  key: string;
  text: string;
  capabilityKeys: string[];
}
interface Issue {
  module: number | null;
  message: string;
}
interface EditorData {
  template: {
    id: string;
    title: string;
    summary: string | null;
    status: "draft" | "published" | "archived";
    version: number;
    config: { sourceDocumentId: string | null; teams: string[]; moduleMinutes: number | null; paced: "facilitator" | "timer" };
    objectives: Objective[];
  };
  modules: ModuleDraft[];
  rubrics: RubricDraft[];
  document: { id: string; title: string; changed: boolean; text: string; sections: PaneSection[] } | null;
  capabilities: Array<{ key: string; name: string }>;
  controls: Array<{ framework: string; frameworkLabel: string; controlId: string; title: string }>;
  issues: Issue[];
  inUse: boolean;
}

const STATUS_LABEL: Record<EditorData["template"]["status"], string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

/** First lines of a section, trimmed to a short excerpt that is still word for word. */
function excerptOf(text: string, max = 600): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (stop > 120 ? cut.slice(0, stop + 1) : cut).trim();
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{children}</p>;
}

function ChipPicker({
  label,
  values,
  options,
  onChange,
  max = 6,
  disabled,
}: {
  label: string;
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (v: string[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  const remaining = options.filter((o) => !values.includes(o.value));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[color:var(--color-muted-foreground)]">{label}</span>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(values.filter((x) => x !== v))}
          className="inline-flex max-w-64 items-center gap-1 truncate rounded-full bg-[color:var(--mist-indigo-soft)] px-2 py-0.5 text-xs text-[color:var(--mist-indigo)] disabled:opacity-60"
          aria-label={`Remove ${options.find((o) => o.value === v)?.label ?? v}`}
          title={options.find((o) => o.value === v)?.label ?? v}
        >
          <span className="truncate">{options.find((o) => o.value === v)?.label ?? v}</span>
          <X className="h-3 w-3 shrink-0" />
        </button>
      ))}
      {!disabled && values.length < max && remaining.length > 0 && (
        <FieldSelect
          aria-label={`Add ${label.toLowerCase()}`}
          className="h-7 w-48 px-2 text-xs"
          value=""
          onChange={(v) => v && onChange([...values, v])}
          options={[{ value: "", label: "Add" }, ...remaining]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function Editor({ id, canLaunch, embedded = false }: { id: string; canLaunch: boolean; embedded?: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [data, setData] = useState<EditorData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [modules, setModules] = useState<ModuleDraft[]>([]);
  const [rubrics, setRubrics] = useState<Record<string, RubricDraft>>({});
  const [paced, setPaced] = useState<"facilitator" | "timer">("facilitator");
  const [minutes, setMinutes] = useState("");
  const [groups, setGroups] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [active, setActive] = useState(0);
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set([0]));

  const load = useCallback(
    async (resetDraft = true) => {
      const r = await request<EditorData>(`/api/documents/templates/${id}`, { fallback: "The template did not load. Reload the page." });
      if (!r.ok) return setLoadError(r.error);
      setData(r.data);
      setIssues(r.data.issues);
      if (resetDraft) {
        const t = r.data.template;
        setTitle(t.title);
        setSummary(t.summary ?? "");
        setObjectives(t.objectives);
        setModules(r.data.modules);
        setRubrics(Object.fromEntries(r.data.rubrics.map((x) => [x.questionKey, x])));
        setPaced(t.config.paced);
        setMinutes(t.config.moduleMinutes ? String(t.config.moduleMinutes) : "");
        setGroups(t.config.teams.join("\n"));
        setDirty(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const sectionOptions = useMemo(
    () => (data?.document?.sections ?? []).map((s) => ({ value: s.id, label: `${"  ".repeat(Math.max(0, s.level - 1))}${s.heading}` })),
    [data],
  );
  const capabilityOptions = useMemo(() => (data?.capabilities ?? []).map((c) => ({ value: c.key, label: `${c.key} ${c.name}` })), [data]);
  const objectiveOptions = objectives.map((o) => ({ value: o.key, label: `${o.key}: ${o.text.slice(0, 50)}` }));
  const controlOptions = useMemo(
    () => (data?.controls ?? []).map((c) => ({ value: `${c.framework}|${c.controlId}`, label: `${c.frameworkLabel} ${c.controlId} ${c.title}` })),
    [data],
  );

  if (loadError) return <p role="alert" className="text-sm text-[color:var(--mist-danger)]">{loadError}</p>;
  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  const t = data.template;
  const locked = data.inUse;
  const editable = true;

  // ---- draft mutations ----
  const touch = () => setDirty(true);
  function patchModule(i: number, fn: (m: ModuleDraft) => ModuleDraft) {
    setModules((list) => list.map((m, j) => (j === i ? fn(m) : m)));
    touch();
  }
  function patchContent(i: number, patch: Partial<ModuleDraft["content"]>) {
    patchModule(i, (m) => ({ ...m, content: { ...m.content, ...patch } }));
  }
  function patchQuestion(mi: number, qi: number, patch: Partial<Question>) {
    patchModule(mi, (m) => ({ ...m, content: { ...m.content, questions: m.content.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } }));
  }
  function newQuestionKey(): string {
    const used = new Set(modules.flatMap((m) => m.content.questions.map((q) => q.key)));
    for (let n = 1; ; n++) if (!used.has(`q${n}`)) return `q${n}`;
  }
  function addQuestion(mi: number) {
    const key = newQuestionKey();
    patchModule(mi, (m) => ({
      ...m,
      content: { ...m.content, questions: [...m.content.questions, { key, text: "", category: "decision_making", capabilityKeys: [], objectiveKeys: [], docSectionRefs: [] }] },
    }));
    setRubrics((r) => ({ ...r, [key]: { questionKey: key, criteria: [{ id: "c1", text: "", controlRefs: [] }], modelAnswer: null, capabilityKey: null } }));
  }
  function removeQuestion(mi: number, qi: number) {
    patchModule(mi, (m) => ({ ...m, content: { ...m.content, questions: m.content.questions.filter((_, j) => j !== qi) } }));
  }
  function patchRubric(key: string, patch: Partial<RubricDraft>) {
    setRubrics((r) => ({ ...r, [key]: { ...(r[key] ?? { questionKey: key, criteria: [], modelAnswer: null, capabilityKey: null }), ...patch } }));
    touch();
  }
  function addModule(from?: { title: string; sectionId: string; excerpt: string }) {
    const key = newQuestionKey();
    const last = modules.at(-1);
    const index = modules.length;
    const refs = from ? [from.sectionId] : [];
    setModules((list) => [
      ...list,
      {
        title: from?.title.slice(0, 160) ?? "",
        scenarioOffsetMin: last ? last.scenarioOffsetMin + 30 : 0,
        plannedDelayMin: null,
        content: {
          schemaVersion: 1,
          scenarioUpdate: "",
          keyIssues: [],
          docSectionRefs: refs,
          ...(from?.excerpt ? { sourceExcerpt: from.excerpt } : {}),
          questions: [{ key, text: "", category: "decision_making", capabilityKeys: [], objectiveKeys: [], docSectionRefs: refs }],
        },
        secret: { schemaVersion: 1, expectedActions: [] },
      },
    ]);
    setRubrics((r) => ({ ...r, [key]: { questionKey: key, criteria: [{ id: "c1", text: "", controlRefs: [] }], modelAnswer: null, capabilityKey: null } }));
    setActive(index);
    setOpenSet((o) => new Set(o).add(index));
    touch();
  }
  function quoteIntoActive(text: string, sectionId: string | null) {
    if (locked || modules.length === 0) return;
    const i = Math.min(active, modules.length - 1);
    patchModule(i, (m) => ({
      ...m,
      content: {
        ...m.content,
        sourceExcerpt: text.slice(0, 3000),
        docSectionRefs: sectionId && !m.content.docSectionRefs.includes(sectionId) ? [...m.content.docSectionRefs, sectionId].slice(0, 8) : m.content.docSectionRefs,
      },
    }));
    setOpenSet((o) => new Set(o).add(i));
    toast.success(`Quoted into module ${i + 1}.`);
  }
  function moveModule(i: number, dir: -1 | 1) {
    setModules((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  }

  // ---- server actions ----
  function body() {
    if (locked) return { title: title.trim(), summary: summary.trim() || null };
    const keys = new Set(modules.flatMap((m) => m.content.questions.map((q) => q.key)));
    return {
      title: title.trim(),
      summary: summary.trim() || null,
      objectives,
      teams: lines(groups).slice(0, 10),
      moduleMinutes: minutes.trim() ? Math.round(Number(minutes)) : null,
      paced,
      modules: modules.map((m) => ({
        ...m,
        title: m.title.trim(),
        content: {
          ...m.content,
          keyIssues: m.content.keyIssues.map((k) => k.trim()).filter(Boolean),
          rationale: m.content.rationale?.trim() || undefined,
          sourceExcerpt: m.content.sourceExcerpt?.trim() || undefined,
          questions: m.content.questions.map((q) => ({ ...q, text: q.text.trim() })),
        },
        secret: { ...m.secret, expectedActions: m.secret.expectedActions.map((a) => a.trim()).filter(Boolean) },
      })),
      rubrics: Object.values(rubrics)
        .filter((r) => keys.has(r.questionKey))
        .map((r) => ({
          ...r,
          criteria: r.criteria.filter((c) => c.text.trim()).map((c, i) => ({ ...c, id: `c${i + 1}`, text: c.text.trim() })),
          modelAnswer: r.modelAnswer?.trim() || null,
        }))
        .filter((r) => r.criteria.length > 0),
    };
  }

  async function save(): Promise<boolean> {
    setBusy("save");
    const r = await request<{ issues: Issue[] }>(`/api/documents/templates/${id}`, { method: "PATCH", body: body(), fallback: "The template was not saved. Try again." });
    setBusy(null);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Saved.");
    setIssues(r.data.issues);
    await load();
    return true;
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy("publish");
    const r = await request(`/api/documents/templates/${id}/publish`, { method: "POST", fallback: "The template was not published. Try again." });
    setBusy(null);
    if (!r.ok) {
      const list = (r.body as { issues?: Issue[] } | null)?.issues;
      if (list) setIssues(list);
      return toast.error(r.error);
    }
    toast.success("Published.");
    void load();
  }

  async function duplicate() {
    setBusy("duplicate");
    const r = await request<{ id: string }>(`/api/documents/templates/${id}/duplicate`, { method: "POST", fallback: "The template was not copied. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    router.push(`/documents/templates/${r.data.id}`);
  }

  async function archive(archived: boolean) {
    setBusy("archive");
    const r = await request(`/api/documents/templates/${id}/archive`, { body: { archived }, fallback: "That did not work. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(archived ? "Archived." : "Restored as a draft.");
    void load();
  }

  async function remove() {
    const ok = await confirm({ title: "Delete this template?", description: "This cannot be undone.", confirmLabel: "Delete", destructive: true });
    if (!ok) return;
    setBusy("delete");
    const r = await request(`/api/documents/templates/${id}`, { method: "DELETE", fallback: "The template was not deleted. Try again." });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    router.push(data?.document ? `/documents/${data.document.id}` : "/documents");
  }

  async function launch() {
    setBusy("launch");
    const r = await request<{ id: string }>("/api/exercises", {
      body: {
        mode: "document",
        templateId: id,
        ...(data?.document ? { sourceDocumentId: data.document.id } : {}),
        title: t.title,
        advancePolicy: t.config.paced === "timer" && t.config.moduleMinutes ? "timer" : "facilitator",
      },
      fallback: "The exercise was not created. Try again.",
    });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    router.push(`/exercises/${r.data.id}`);
  }

  // ---- render ----
  const pane = data.document ? (
    <DocumentPane
      title={data.document.title}
      text={data.document.text}
      sections={data.document.sections}
      activeModule={modules.length ? Math.min(active, modules.length - 1) + 1 : null}
      canEdit={!locked}
      onStartModule={(sec) => addModule({ title: sec.heading, sectionId: sec.id, excerpt: excerptOf(data.document!.text.slice(sec.start, sec.end).split("\n").slice(1).join("\n")) })}
      onQuote={quoteIntoActive}
    />
  ) : null;

  const main = (
    <div className="min-w-0 space-y-5 pb-16">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={t.status === "published" ? "accent" : "outline"}>{STATUS_LABEL[t.status]}</Badge>
            {t.version > 1 && <span className="text-xs text-[color:var(--color-muted-foreground)]">Version {t.version}</span>}
            {data.document && (
              <Link href={`/documents/${data.document.id}`} className="truncate text-xs text-[color:var(--mist-indigo)] hover:underline">
                {data.document.title}
              </Link>
            )}
          </div>
          {editable ? (
            <Input
              aria-label="Template title"
              value={title}
              maxLength={160}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              className="h-11 font-display text-xl font-semibold"
            />
          ) : (
            <h1 className="headline">{t.title}</h1>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button variant={dirty ? "default" : "outline"} disabled={busy !== null || !dirty} onClick={() => void save()}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          )}
          {editable && t.status !== "archived" && !embedded && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void publish()}>
              {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Publish
            </Button>
          )}
          {t.status === "published" && canLaunch && (
            <Button variant="accent" disabled={busy !== null || dirty} onClick={() => void launch()}>
              {busy === "launch" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch exercise
            </Button>
          )}
          {editable && !embedded && (
            <Button variant="outline" asChild>
              <Link
                href={`/studio/${id}`}
                onClick={(e) => {
                  if (!dirty) return;
                  e.preventDefault();
                  toast.error("Save your changes first.");
                }}
              >
                <Network className="h-4 w-4" />
                Open in Studio
              </Link>
            </Button>
          )}
          {editable && !embedded && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void duplicate()}>
              <Copy className="h-4 w-4" />
              Duplicate
            </Button>
          )}
          {editable && !embedded && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void archive(t.status !== "archived")}>
              {t.status === "archived" ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {t.status === "archived" ? "Restore" : "Archive"}
            </Button>
          )}
          {!embedded && (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void remove()} aria-label="Delete template">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {editable && (
        <>
          {locked && (
            <Card dense className="flex-row items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[color:var(--mist-warn)]" />
              An exercise that has not ended uses this template. Only the title and summary can change. Duplicate it to edit modules.
            </Card>
          )}
          {data.document?.changed && (
            <Card dense className="flex-row items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-[color:var(--mist-warn)]" />
              The source document changed after this template was written.
            </Card>
          )}
          {issues.length > 0 && (
            <Card dense className="gap-1 text-sm">
              <SectionLabel>Fix before publishing</SectionLabel>
              <ul className="list-disc space-y-0.5 pl-5">
                {issues.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="t-summary">Summary</Label>
              <Textarea
                id="t-summary"
                rows={2}
                maxLength={800}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  touch();
                }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-paced">Pacing</Label>
                <FieldSelect
                  id="t-paced"
                  disabled={locked}
                  value={paced}
                  onChange={(v) => {
                    setPaced(v as "facilitator" | "timer");
                    touch();
                  }}
                  options={[
                    { value: "facilitator", label: "The facilitator advances" },
                    { value: "timer", label: "Timed modules" },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-minutes">Minutes per module</Label>
                <Input
                  id="t-minutes"
                  type="number"
                  min={5}
                  max={120}
                  disabled={locked}
                  value={minutes}
                  placeholder="Optional"
                  onChange={(e) => {
                    setMinutes(e.target.value);
                    touch();
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-groups">Participating groups</Label>
                <Textarea
                  id="t-groups"
                  rows={2}
                  disabled={locked}
                  value={groups}
                  placeholder="One per line"
                  onChange={(e) => {
                    setGroups(e.target.value);
                    touch();
                  }}
                />
              </div>
            </div>
          </Card>

          <Card className="gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Objectives</h2>
              {!locked && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const used = new Set(objectives.map((o) => o.key));
                    let n = objectives.length + 1;
                    while (used.has(`o${n}`)) n++;
                    setObjectives((l) => [...l, { key: `o${n}`, text: "", capabilityKeys: [] }]);
                    touch();
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add objective
                </Button>
              )}
            </div>
            {objectives.length === 0 && <p className="text-sm text-[color:var(--color-muted-foreground)]">No objectives.</p>}
            {objectives.map((o, i) => (
              <div key={o.key} className="space-y-2 rounded-lg border border-[color:var(--color-border)] p-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">{o.key}</span>
                  <Input
                    aria-label={`Objective ${o.key}`}
                    disabled={locked}
                    value={o.text}
                    maxLength={1000}
                    onChange={(e) => {
                      setObjectives((l) => l.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)));
                      touch();
                    }}
                  />
                  {!locked && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove objective"
                      onClick={() => {
                        setObjectives((l) => l.filter((_, j) => j !== i));
                        setModules((list) =>
                          list.map((m) => ({ ...m, content: { ...m.content, questions: m.content.questions.map((q) => ({ ...q, objectiveKeys: q.objectiveKeys.filter((k) => k !== o.key) })) } })),
                        );
                        touch();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <ChipPicker
                  label="Capabilities"
                  disabled={locked}
                  values={o.capabilityKeys}
                  options={capabilityOptions}
                  onChange={(v) => {
                    setObjectives((l) => l.map((x, j) => (j === i ? { ...x, capabilityKeys: v } : x)));
                    touch();
                  }}
                />
              </div>
            ))}
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Modules</h2>
              {!locked && (
                <Button size="sm" variant="outline" disabled={modules.length >= 12} onClick={() => addModule()}>
                  <Plus className="h-4 w-4" />
                  Add module
                </Button>
              )}
            </div>
            <CloudSeam feature="playbook-prepare" />
            {modules.length === 0 && (
              <Card dense className="gap-2 text-sm">
                <p>No modules yet.</p>
                <p className="text-[color:var(--color-muted-foreground)]">
                  {data.document ? "Add a module, or start one from a section of the document." : "Add a module to begin."}
                </p>
              </Card>
            )}
            {modules.map((m, mi) => (
              <ModuleCard
                key={m.id ?? `new-${mi}`}
                index={mi}
                count={modules.length}
                active={data.document !== null && mi === Math.min(active, modules.length - 1)}
                open={openSet.has(mi)}
                onToggle={() =>
                  setOpenSet((o) => {
                    const next = new Set(o);
                    if (next.has(mi)) next.delete(mi);
                    else next.add(mi);
                    return next;
                  })
                }
                onFocus={() => setActive(mi)}
                module={m}
                locked={locked}
                issues={issues.filter((x) => x.module === mi)}
                rubrics={rubrics}
                sectionOptions={sectionOptions}
                capabilityOptions={capabilityOptions}
                objectiveOptions={objectiveOptions}
                controlOptions={controlOptions}
                onModule={(fn) => patchModule(mi, fn)}
                onContent={(p) => patchContent(mi, p)}
                onQuestion={(qi, p) => patchQuestion(mi, qi, p)}
                onAddQuestion={() => addQuestion(mi)}
                onRemoveQuestion={(qi) => removeQuestion(mi, qi)}
                onRubric={patchRubric}
                onMove={(d) => {
                  moveModule(mi, d);
                  setActive(mi + d);
                  setOpenSet((o) => new Set([...o].map((x) => (x === mi ? mi + d : x === mi + d ? mi : x))));
                }}
                onRemove={() => {
                  setModules((list) => list.filter((_, j) => j !== mi));
                  setActive((a) => Math.max(0, a > mi ? a - 1 : a));
                  setOpenSet((o) => new Set([...o].filter((x) => x !== mi).map((x) => (x > mi ? x - 1 : x))));
                  touch();
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );

  if (!pane) return main;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
      {main}
      <aside className="order-first xl:order-none" aria-label="Source document">
        <div className="xl:sticky xl:top-4">{pane}</div>
      </aside>
    </div>
  );
}

function ModuleCard(props: {
  index: number;
  count: number;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onFocus: () => void;
  module: ModuleDraft;
  locked: boolean;
  issues: Issue[];
  rubrics: Record<string, RubricDraft>;
  sectionOptions: Array<{ value: string; label: string }>;
  capabilityOptions: Array<{ value: string; label: string }>;
  objectiveOptions: Array<{ value: string; label: string }>;
  controlOptions: Array<{ value: string; label: string }>;
  onModule: (fn: (m: ModuleDraft) => ModuleDraft) => void;
  onContent: (p: Partial<ModuleDraft["content"]>) => void;
  onQuestion: (qi: number, p: Partial<Question>) => void;
  onAddQuestion: () => void;
  onRemoveQuestion: (qi: number) => void;
  onRubric: (key: string, p: Partial<RubricDraft>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { module: m, locked, index, open } = props;
  const c = m.content;
  return (
    <Card
      dense
      onFocusCapture={props.onFocus}
      onClick={props.onFocus}
      className={cn("gap-4", props.issues.length > 0 && "ring-1 ring-[color:var(--mist-warn)]", props.active && "ring-2 ring-[color:var(--mist-indigo)]")}
    >
      <div className="flex items-center gap-2">
        <button type="button" onClick={props.onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
          <span className="font-mono text-xs text-[color:var(--color-muted-foreground)]">{index + 1}</span>
          <span className="truncate font-medium">{m.title || "Untitled module"}</span>
          {props.active && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[color:var(--mist-indigo)]">
              <Quote className="h-3 w-3" />
              Quotes go here
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-[color:var(--color-muted-foreground)]">
            {c.questions.length} {c.questions.length === 1 ? "question" : "questions"}
          </span>
        </button>
        {!locked && (
          <>
            <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => props.onMove(-1)}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={index === props.count - 1} onClick={() => props.onMove(1)}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Remove module" onClick={props.onRemove}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
      {props.issues.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-[color:var(--mist-warn)]">
          {props.issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      )}
      {open && (
        <fieldset disabled={locked} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px]">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={m.title} maxLength={160} onChange={(e) => props.onModule((x) => ({ ...x, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Scenario minute</Label>
              <Input
                type="number"
                min={0}
                value={m.scenarioOffsetMin}
                onChange={(e) => props.onModule((x) => ({ ...x, scenarioOffsetMin: Math.max(0, Math.round(Number(e.target.value) || 0)) }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minutes</Label>
              <Input
                type="number"
                min={5}
                max={120}
                placeholder="Default"
                value={m.plannedDelayMin ?? ""}
                onChange={(e) => props.onModule((x) => ({ ...x, plannedDelayMin: e.target.value ? Math.round(Number(e.target.value)) : null }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Scenario update</Label>
            <Textarea rows={4} maxLength={6000} value={c.scenarioUpdate} onChange={(e) => props.onContent({ scenarioUpdate: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Key issues</Label>
              <Textarea rows={3} placeholder="One per line" value={c.keyIssues.join("\n")} onChange={(e) => props.onContent({ keyIssues: e.target.value.split("\n").slice(0, 8) })} onBlur={(e) => props.onContent({ keyIssues: lines(e.target.value).slice(0, 8) })} />
            </div>
            <div className="space-y-1.5">
              <Label>Expected actions</Label>
              <Textarea
                rows={3}
                placeholder="One per line. Players never see these."
                value={m.secret.expectedActions.join("\n")}
                onChange={(e) => props.onModule((x) => ({ ...x, secret: { ...x.secret, expectedActions: e.target.value.split("\n").slice(0, 10) } }))}
                onBlur={(e) => props.onModule((x) => ({ ...x, secret: { ...x.secret, expectedActions: lines(e.target.value).slice(0, 10) } }))}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>What it tests</Label>
              <Textarea rows={2} maxLength={1500} value={c.rationale ?? ""} onChange={(e) => props.onContent({ rationale: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Source excerpt</Label>
              <Textarea rows={2} maxLength={3000} placeholder="Copied word for word from the document." value={c.sourceExcerpt ?? ""} onChange={(e) => props.onContent({ sourceExcerpt: e.target.value })} />
            </div>
          </div>
          <ChipPicker label="Sections" values={c.docSectionRefs} options={props.sectionOptions} max={8} onChange={(v) => props.onContent({ docSectionRefs: v })} disabled={locked} />

          <div className="space-y-3">
            <SectionLabel>Questions</SectionLabel>
            {c.questions.map((q, qi) => (
              <QuestionEditor
                key={q.key}
                number={qi + 1}
                question={q}
                rubric={props.rubrics[q.key]}
                locked={locked}
                canRemove={c.questions.length > 1}
                sectionOptions={props.sectionOptions}
                capabilityOptions={props.capabilityOptions}
                objectiveOptions={props.objectiveOptions}
                controlOptions={props.controlOptions}
                onChange={(p) => props.onQuestion(qi, p)}
                onRubric={(p) => props.onRubric(q.key, p)}
                onRemove={() => props.onRemoveQuestion(qi)}
              />
            ))}
            {!locked && c.questions.length < 8 && (
              <Button size="sm" variant="outline" type="button" onClick={props.onAddQuestion}>
                <Plus className="h-4 w-4" />
                Add question
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </Card>
  );
}

function QuestionEditor(props: {
  number: number;
  question: Question;
  rubric: RubricDraft | undefined;
  locked: boolean;
  canRemove: boolean;
  sectionOptions: Array<{ value: string; label: string }>;
  capabilityOptions: Array<{ value: string; label: string }>;
  objectiveOptions: Array<{ value: string; label: string }>;
  controlOptions: Array<{ value: string; label: string }>;
  onChange: (p: Partial<Question>) => void;
  onRubric: (p: Partial<RubricDraft>) => void;
  onRemove: () => void;
}) {
  const { question: q, locked } = props;
  const rubric = props.rubric ?? { questionKey: q.key, criteria: [], modelAnswer: null, capabilityKey: null };
  const setCriterion = (i: number, patch: Partial<Criterion>) => props.onRubric({ criteria: rubric.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-3 rounded-lg border border-[color:var(--color-border)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 font-mono text-xs text-[color:var(--color-muted-foreground)]">{props.number}</span>
        <Textarea aria-label={`Question ${props.number}`} rows={2} maxLength={1000} value={q.text} onChange={(e) => props.onChange({ text: e.target.value })} />
        <FieldSelect
          aria-label="Category"
          className="w-44"
          value={q.category}
          onChange={(v) => props.onChange({ category: v })}
          options={QUESTION_CATEGORIES.map((c) => ({ value: c, label: QUESTION_CATEGORY_LABELS[c] }))}
        />
        {!locked && props.canRemove && (
          <Button size="icon-sm" variant="ghost" aria-label="Remove question" type="button" onClick={props.onRemove}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="space-y-1.5 pl-5">
        <ChipPicker label="Objectives" values={q.objectiveKeys} options={props.objectiveOptions} onChange={(v) => props.onChange({ objectiveKeys: v })} disabled={locked} />
        <ChipPicker label="Capabilities" values={q.capabilityKeys} options={props.capabilityOptions} onChange={(v) => props.onChange({ capabilityKeys: v })} disabled={locked} />
        <ChipPicker label="Sections" values={q.docSectionRefs} options={props.sectionOptions} onChange={(v) => props.onChange({ docSectionRefs: v })} disabled={locked} />
      </div>
      <div className="space-y-2 rounded-md bg-[color:var(--color-muted)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <SectionLabel>Rubric</SectionLabel>
          <FieldSelect
            aria-label="Rubric capability"
            className="ml-auto h-8 w-64 text-xs"
            disabled={locked}
            value={rubric.capabilityKey ?? ""}
            onChange={(v) => props.onRubric({ capabilityKey: v || null })}
            options={[{ value: "", label: "No capability" }, ...props.capabilityOptions]}
          />
        </div>
        {rubric.criteria.map((c, i) => (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <Input aria-label={`Criterion ${i + 1}`} maxLength={400} value={c.text} onChange={(e) => setCriterion(i, { text: e.target.value })} placeholder="One checkable element of a strong answer." />
              {!locked && (
                <Button size="icon-sm" variant="ghost" type="button" aria-label="Remove criterion" onClick={() => props.onRubric({ criteria: rubric.criteria.filter((_, j) => j !== i) })}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <ChipPicker
              label="Controls"
              max={4}
              disabled={locked}
              values={c.controlRefs.map((r) => `${r.framework}|${r.controlId}`)}
              options={props.controlOptions}
              onChange={(v) => setCriterion(i, { controlRefs: v.map((x) => ({ framework: x.split("|")[0], controlId: x.split("|").slice(1).join("|") })) })}
            />
          </div>
        ))}
        {!locked && rubric.criteria.length < 6 && (
          <Button
            size="xs"
            variant="outline"
            type="button"
            onClick={() => props.onRubric({ criteria: [...rubric.criteria, { id: `c${rubric.criteria.length + 1}`, text: "", controlRefs: [] }] })}
          >
            <Plus className="h-3 w-3" />
            Add criterion
          </Button>
        )}
        <div className="space-y-1">
          <Label className="text-xs">Model answer</Label>
          <Textarea rows={2} maxLength={3000} value={rubric.modelAnswer ?? ""} onChange={(e) => props.onRubric({ modelAnswer: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

export function DocumentTemplateEditor(props: { id: string; canLaunch: boolean; embedded?: boolean }) {
  return (
    <ConfirmDialogProvider>
      <Editor {...props} />
    </ConfirmDialogProvider>
  );
}
