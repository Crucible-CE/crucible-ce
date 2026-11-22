"use client";

// The incident Playbooks tab: suggested playbooks from Documents, attach one
// or more, and run each as a checklist. Checking a step off records who and
// when; facilitators can edit the checklist for this incident (the document
// stays as it is) and turn a step into an incident task.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, BookOpen, Check, ListPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { cn } from "@/lib/utils";

interface Step {
  id: string;
  position: number;
  section: string;
  text: string;
  detail: string | null;
  kind: string;
  source: string;
  doneAt: string | null;
  doneByName: string | null;
  taskId: string | null;
}
interface Run {
  id: string;
  documentId: string | null;
  documentTitle: string;
  status: string;
  createdByName: string | null;
  createdAt: string;
  steps: Step[];
  doneCount: number;
  totalCount: number;
}
interface Suggestion { id: string; title: string; scope: string; collection: string | null; reasons: string[] }
interface Doc { id: string; title: string; scope: string; collection: string | null; attached: boolean }

function groupBySection(steps: Step[]): { section: string; steps: Step[] }[] {
  const out: { section: string; steps: Step[] }[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last.section === s.section) last.steps.push(s);
    else out.push({ section: s.section, steps: [s] });
  }
  return out;
}

export function IncidentPlaybooks({ incidentId }: { incidentId: string }) {
  const confirm = useConfirm();
  const { readOnly } = useIncidentShell();
  const [runs, setRuns] = useState<Run[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const api = `/api/incidents/${incidentId}/playbooks`;
  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setRuns(d.runs ?? []);
      setSuggestions(d.suggestions ?? []);
      setDocs(d.documents ?? []);
      setCanEdit(!!d.canEdit);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = canEdit && !readOnly;

  const call = async (url: string, init: RequestInit, success?: string) => {
    setBusy(true);
    try {
      const res = await fetch(url, { ...init, headers: init.body ? { "Content-Type": "application/json" } : undefined });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(apiErrorMessage(d, "Couldn't save. Try again."));
        return null;
      }
      if (success) toast.success(success);
      await load();
      return d;
    } finally {
      setBusy(false);
    }
  };

  const attach = (documentId: string) => call(api, { method: "POST", body: JSON.stringify({ documentId }) }, "Playbook attached");
  const available = useMemo(() => docs.filter((d) => !d.attached), [docs]);

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4 text-[color:var(--mist-indigo)]" aria-hidden /> Playbooks
          </h2>
          {editable && available.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                aria-label="Playbook to attach"
                className="max-w-64 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1 text-xs"
              >
                <option value="">Choose a playbook</option>
                {available.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                    {d.scope === "library" ? " (library)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!pick || busy}
                onClick={() => void attach(pick).then(() => setPick(""))}
                className="inline-flex items-center gap-1 rounded-md bg-[color:var(--mist-indigo)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                <Plus className="h-3 w-3" aria-hidden /> Attach
              </button>
            </div>
          )}
        </div>
        <CloudSeam feature="exo-next-actions" className="mt-2" />

        {loaded && suggestions.length > 0 && (
          <div className="mt-3 space-y-1.5" data-testid="playbook-suggestions">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Suggested for this incident</p>
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-[color:var(--color-border)] px-3 py-2" data-testid="playbook-suggestion">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{s.title}</p>
                  <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">{s.reasons.join(". ")}</p>
                </div>
                {editable && (
                  <button type="button" disabled={busy} onClick={() => void attach(s.id)} className="shrink-0 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs hover:bg-[color:var(--color-muted)] disabled:opacity-50">
                    Attach
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {loaded && runs.length === 0 && suggestions.length === 0 && (
          <p className="mt-3 text-xs text-[color:var(--color-muted-foreground)]">
            {docs.length === 0 ? (
              <>
                No playbooks in <Link href="/documents" className="underline underline-offset-2">Documents</Link> yet.
              </>
            ) : (
              "No playbook matches this incident. Attach one from the list."
            )}
          </p>
        )}
      </div>

      {runs.map((run) => (
        <RunCard key={run.id} incidentId={incidentId} run={run} editable={editable} busy={busy} call={call} confirm={confirm} />
      ))}
    </div>
  );
}

function RunCard({
  incidentId,
  run,
  editable,
  busy,
  call,
  confirm,
}: {
  incidentId: string;
  run: Run;
  editable: boolean;
  busy: boolean;
  call: (url: string, init: RequestInit, success?: string) => Promise<unknown>;
  confirm: ReturnType<typeof useConfirm>;
}) {
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const base = `/api/incidents/${incidentId}/playbooks/${run.id}`;
  const percent = run.totalCount ? Math.round((run.doneCount / run.totalCount) * 100) : 0;
  const groups = groupBySection(run.steps);

  const remove = async () => {
    const ok = await confirm({ title: `Remove ${run.documentTitle} from this incident?`, description: "The checklist and its check-offs are removed. The ledger keeps them.", confirmLabel: "Remove", destructive: true });
    if (ok) await call(base, { method: "DELETE" }, "Playbook removed");
  };

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4" data-testid="playbook-run" aria-label={run.documentTitle}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{run.documentTitle}</h3>
          <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
            Attached by {run.createdByName ?? "Unknown"} on {new Date(run.createdAt).toLocaleString()}
            {run.documentId && (
              <>
                {" · "}
                <Link href={`/documents/${run.documentId}`} className="underline underline-offset-2">
                  Open the document
                </Link>
              </>
            )}
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-border)] px-2 py-1 text-xs">
              <Pencil className="h-3 w-3" aria-hidden /> {editing ? "Done editing" : "Edit checklist"}
            </button>
            <button type="button" onClick={() => void remove()} aria-label="Remove playbook" title="Remove playbook" className="rounded-md p-1 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]">
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2" data-testid="playbook-progress">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-muted)]">
          <div className="h-full rounded-full bg-[color:var(--mist-ok)]" style={{ width: `${percent}%` }} />
        </div>
        <span className="text-[11px] tabular-nums text-[color:var(--color-muted-foreground)]">
          {run.doneCount} of {run.totalCount} done
        </span>
      </div>

      {run.totalCount === 0 && <p className="mt-3 text-xs text-[color:var(--color-muted-foreground)]">No numbered steps found in this document. Add steps with Edit checklist.</p>}

      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={`${g.section}-${g.steps[0]?.id}`}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{g.section}</p>
            <ul className="space-y-1">
              {g.steps.map((s) => (
                <li key={s.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-[color:var(--color-muted)]/40" data-testid="playbook-step">
                  <button
                    type="button"
                    disabled={!editable || busy}
                    onClick={() => void call(`${base}/steps/${s.id}`, { method: "PATCH", body: JSON.stringify({ done: !s.doneAt }) })}
                    aria-label={s.doneAt ? `Reopen ${s.text}` : `Mark ${s.text} done`}
                    aria-pressed={!!s.doneAt}
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      s.doneAt ? "border-[color:var(--mist-ok)] bg-[color:var(--mist-ok)] text-white" : "border-[color:var(--color-border)]",
                    )}
                  >
                    {s.doneAt && <Check className="h-3 w-3" aria-hidden />}
                  </button>
                  <div className="min-w-0 flex-1">
                    {editId === s.id ? (
                      <form
                        className="flex gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void call(`${base}/steps/${s.id}`, { method: "PATCH", body: JSON.stringify({ text: editText }) }).then(() => setEditId(null));
                        }}
                      >
                        <input value={editText} maxLength={240} onChange={(e) => setEditText(e.target.value)} aria-label="Step text" className="min-w-0 flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-0.5 text-[13px]" />
                        <button type="submit" className="rounded border border-[color:var(--color-border)] px-2 text-xs">Save</button>
                        <button type="button" onClick={() => setEditId(null)} aria-label="Cancel" className="px-1"><X className="h-3 w-3" aria-hidden /></button>
                      </form>
                    ) : (
                      <p className={cn("text-[13px]", s.doneAt && "text-[color:var(--color-muted-foreground)] line-through")}>
                        {s.kind === "decision" && <span className="mr-1 rounded bg-[color:var(--mist-amber)]/15 px-1 text-[10px] font-bold uppercase text-[color:var(--mist-amber)]">Decision</span>}
                        {s.text}
                      </p>
                    )}
                    {s.detail && editId !== s.id && (
                      <details className="text-[12px] text-[color:var(--color-muted-foreground)]">
                        <summary className="cursor-pointer select-none">Details</summary>
                        <p className="mt-1 whitespace-pre-wrap">{s.detail}</p>
                      </details>
                    )}
                    <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                      {s.doneAt ? `Done by ${s.doneByName ?? "Unknown"} at ${new Date(s.doneAt).toLocaleString()}` : null}
                      {s.taskId ? (
                        <>
                          {s.doneAt ? " · " : ""}
                          <Link href={`/incidents/${incidentId}`} className="underline underline-offset-2">Task created</Link>
                        </>
                      ) : null}
                      {s.source === "custom" ? `${s.doneAt || s.taskId ? " · " : ""}Added for this incident` : null}
                    </p>
                  </div>
                  {editable && !editing && !s.taskId && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void call(`${base}/steps/${s.id}/task`, { method: "POST" }, "Task created")}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)] opacity-0 hover:text-[color:var(--color-foreground)] focus:opacity-100 group-hover:opacity-100"
                    >
                      Make task
                    </button>
                  )}
                  {editable && editing && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button type="button" onClick={() => { setEditId(s.id); setEditText(s.text); }} aria-label="Edit step" className="p-0.5"><Pencil className="h-3 w-3" aria-hidden /></button>
                      <button type="button" onClick={() => void call(`${base}/steps/${s.id}`, { method: "PATCH", body: JSON.stringify({ move: "up" }) })} aria-label="Move up" className="p-0.5"><ArrowUp className="h-3 w-3" aria-hidden /></button>
                      <button type="button" onClick={() => void call(`${base}/steps/${s.id}`, { method: "PATCH", body: JSON.stringify({ move: "down" }) })} aria-label="Move down" className="p-0.5"><ArrowDown className="h-3 w-3" aria-hidden /></button>
                      <button type="button" onClick={() => void call(`${base}/steps/${s.id}`, { method: "DELETE" })} aria-label="Remove step" className="p-0.5 hover:text-[color:var(--mist-danger)]"><Trash2 className="h-3 w-3" aria-hidden /></button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {editable && editing && (
              adding === g.section ? (
                <form
                  className="mt-1 flex gap-1 pl-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newText.trim()) return;
                    void call(`${base}/steps`, { method: "POST", body: JSON.stringify({ section: g.section, text: newText.trim() }) }, "Step added").then(() => {
                      setAdding(null);
                      setNewText("");
                    });
                  }}
                >
                  <input autoFocus value={newText} maxLength={240} onChange={(e) => setNewText(e.target.value)} aria-label="New step" placeholder="New step" className="min-w-0 flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-0.5 text-[13px]" />
                  <button type="submit" className="rounded border border-[color:var(--color-border)] px-2 text-xs">Add</button>
                  <button type="button" onClick={() => setAdding(null)} aria-label="Cancel" className="px-1"><X className="h-3 w-3" aria-hidden /></button>
                </form>
              ) : (
                <button type="button" onClick={() => { setAdding(g.section); setNewText(""); }} className="mt-1 inline-flex items-center gap-1 pl-6 text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
                  <ListPlus className="h-3 w-3" aria-hidden /> Add a step
                </button>
              )
            )}
          </div>
        ))}
        {editable && editing && run.totalCount === 0 && (
          adding === "Steps" ? null : (
            <button type="button" onClick={() => { setAdding("Steps"); setNewText(""); }} className="inline-flex items-center gap-1 text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
              <ListPlus className="h-3 w-3" aria-hidden /> Add a step
            </button>
          )
        )}
        {editable && editing && run.totalCount === 0 && adding === "Steps" && (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newText.trim()) return;
              void call(`${base}/steps`, { method: "POST", body: JSON.stringify({ section: "Steps", text: newText.trim() }) }, "Step added").then(() => {
                setAdding(null);
                setNewText("");
              });
            }}
          >
            <input autoFocus value={newText} maxLength={240} onChange={(e) => setNewText(e.target.value)} aria-label="New step" placeholder="New step" className="min-w-0 flex-1 rounded border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-0.5 text-[13px]" />
            <button type="submit" className="rounded border border-[color:var(--color-border)] px-2 text-xs">Add</button>
          </form>
        )}
      </div>
    </section>
  );
}
