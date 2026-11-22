"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  ArrowLeft, Loader2, Send, Paperclip, Check, UserPlus, Download, History, ListChecks, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AssignUserModal } from "@/components/incident/assign-user-modal";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { toDatetimeLocalValue, toIsoOrNull } from "@/lib/datetime/local";

interface Comment { id: string; authorName: string; body: string; createdAt: string }
interface Attachment { id: string; filename: string; mimeType: string; sizeBytes: number; sha256: string; uploadedByName: string | null; createdAt: string }
interface AuditRow { seq: number; eventType: string; actorLabel: string | null; createdAt: string }
interface Task {
  id: string; title: string; description: string | null; assigneeId: string | null; status: string; priority: string;
  dueAt: string | null; assignedAt: string | null; acknowledgedAt: string | null; acknowledgedById: string | null;
  comments: Comment[]; attachments: Attachment[];
}

const STATUSES = ["open", "acknowledged", "in_progress", "blocked", "done"];
const STATUS_CLASS: Record<string, string> = {
  open: "bg-[color:var(--mist-warn)]/12 text-[color:var(--mist-warn)]",
  acknowledged: "bg-[color:var(--mist-indigo)]/12 text-[color:var(--mist-indigo)]",
  in_progress: "bg-[color:var(--mist-indigo)]/12 text-[color:var(--mist-indigo)]",
  blocked: "bg-[color:var(--mist-danger)]/12 text-[color:var(--mist-danger)]",
  done: "bg-[color:var(--mist-success)]/12 text-[color:var(--mist-success)]",
};
const PRIORITY_CLASS: Record<string, string> = {
  low: "text-[color:var(--color-muted-foreground)]", medium: "text-[color:var(--mist-indigo)]",
  high: "text-[color:var(--mist-amber)]", critical: "text-[color:var(--mist-danger)]",
};

function auditLabel(e: string): string {
  return ({
    task_updated: "Edited", task_assigned: "Assigned", task_acknowledged: "Acknowledged",
    task_status_changed: "Status changed", task_commented: "Commented", task_attachment_added: "Uploaded a file",
  } as Record<string, string>)[e] ?? e.replace(/_/g, " ");
}

export default function ActionTicketPage() {
  const { id, taskId } = useParams<{ id: string; taskId: string }>();
  const { data: session } = useSession();
  const myId = session?.user?.id;

  const [task, setTask] = useState<Task | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dueDraft, setDueDraft] = useState("");
  const { readOnly } = useIncidentShell();

  const load = useCallback(async () => {
    const [tRes, mRes] = await Promise.all([
      fetch(`/api/incidents/${id}/tasks/${taskId}`),
      fetch(`/api/org-members`),
    ]);
    if (tRes.ok) {
      const d = await tRes.json();
      setTask(d.task);
      setDueDraft(toDatetimeLocalValue(d.task?.dueAt));
      setAudit(d.audit ?? []);
    }
    if (mRes.ok) {
      const ms = await mRes.json();
      const nm: Record<string, string> = {};
      for (const m of ms) nm[m.id] = m.name ?? m.email;
      setMemberNames(nm);
    }
    setLoading(false);
  }, [id, taskId]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/incidents/${id}/tasks/${taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) await load();
    else { const e = await res.json().catch(() => ({})); toast.error(apiErrorMessage(e, "Couldn't update. Try again.")); }
  };

  // Due date+time is a LOCAL wall-clock value in the input; convert to UTC
  // only at the API boundary.
  const saveDue = async (value: string) => {
    const iso = value ? toIsoOrNull(value) : null;
    if (value && !iso) { toast.error("Enter a valid date and time."); return; }
    const current = task?.dueAt ? new Date(task.dueAt).toISOString() : null;
    if (iso === current) return;
    await patch({ dueAt: iso });
  };

  const acknowledge = async () => {
    const res = await fetch(`/api/incidents/${id}/tasks/${taskId}/acknowledge`, { method: "POST" });
    if (res.ok) { toast.success("Acknowledged"); await load(); }
    else { const e = await res.json().catch(() => ({})); toast.error(apiErrorMessage(e, "Couldn't acknowledge. Try again.")); }
  };

  const postComment = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    const res = await fetch(`/api/incidents/${id}/tasks/${taskId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draft.trim() }) });
    setPosting(false);
    if (res.ok) { setDraft(""); await load(); }
    else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't post. Try again."));
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`/api/incidents/${id}/tasks/${taskId}/attachments`, { method: "POST", body: fd });
      if (!res.ok) toast.error(apiErrorMessage(await res.json().catch(() => null), `Couldn't upload ${file.name}. Try again.`));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    await load();
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" /></div>;
  if (!task) return <div className="py-12 text-center text-sm text-[color:var(--color-muted-foreground)]">Action not found.</div>;

  const isAssignee = !!task.assigneeId && task.assigneeId === myId;
  const canAck = !readOnly && !task.acknowledgedAt && (isAssignee || !task.assigneeId);

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-12">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to incident
      </Link>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Main */}
        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <div className="mb-1 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[color:var(--mist-indigo)]" />
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_CLASS[task.status] ?? ""}`}>{task.status.replace("_", " ")}</span>
              {task.acknowledgedAt && <span className="inline-flex items-center gap-0.5 text-[10px] text-[color:var(--mist-success)]"><ShieldCheck className="h-3 w-3" /> acknowledged</span>}
            </div>
            <h1 className="text-lg font-semibold leading-snug">{task.title}</h1>
            {task.description && <p className="mt-2 whitespace-pre-wrap text-[13px] text-[color:var(--color-muted-foreground)]">{task.description}</p>}
            {canAck && (
              <button onClick={acknowledge} className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[color:var(--mist-success)] px-3 py-1.5 text-[12px] font-semibold text-white">
                <Check className="h-3.5 w-3.5" /> Acknowledge this action
              </button>
            )}
          </div>

          {/* Response thread */}
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Comments</h2>
            <ul className="space-y-3">
              {task.comments.map((c) => (
                <li key={c.id} className="text-[13px]">
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="font-medium">{c.authorName}</span>
                    <span className="text-[10.5px] text-[color:var(--color-muted-foreground)]">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
              {task.comments.length === 0 && <li className="py-4 text-center text-xs text-[color:var(--color-muted-foreground)]">No comments.</li>}
            </ul>
            {!readOnly && <div className="mt-3 flex items-end gap-2 border-t border-[color:var(--color-border)] pt-3">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Add a comment" className="flex-1 resize-y rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-transparent px-3 py-2 text-[13px] outline-none focus:border-[color:var(--mist-indigo)]/50" />
              <button onClick={postComment} disabled={posting || !draft.trim()} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
              </button>
            </div>}
          </div>

          {/* Audit trail */}
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><History className="h-4 w-4 text-[color:var(--mist-indigo)]" /> Audit trail</h2>
            <ul className="space-y-1">
              {audit.map((a) => (
                <li key={a.seq} className="flex items-center justify-between gap-2 text-[11.5px]">
                  <span><span className="font-medium">{auditLabel(a.eventType)}</span>{a.actorLabel ? ` · ${a.actorLabel}` : ""}</span>
                  <span className="text-[color:var(--color-muted-foreground)]">{new Date(a.createdAt).toLocaleString()}</span>
                </li>
              ))}
              {audit.length === 0 && <li className="text-[11.5px] text-[color:var(--color-muted-foreground)]">No activity.</li>}
            </ul>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-3">
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3 space-y-3">
            <Field label="Assignee">
              <button onClick={() => setPicking(true)} disabled={readOnly} className="flex w-full items-center justify-between gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1.5 text-[12px] hover:border-[color:var(--mist-indigo)]/50">
                <span className="truncate">{task.assigneeId ? memberNames[task.assigneeId] ?? "Assigned" : "Unassigned"}</span>
                <UserPlus className="h-3.5 w-3.5 text-[color:var(--mist-indigo)]" />
              </button>
            </Field>
            <Field label="Status">
              <select value={task.status} disabled={readOnly} onChange={(e) => patch({ status: e.target.value })} className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-2 py-1.5 text-[12px] text-[color:var(--color-foreground)] capitalize">
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={task.priority} disabled={readOnly} onChange={(e) => patch({ priority: e.target.value })} className={`w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-2 py-1.5 text-[12px] capitalize ${PRIORITY_CLASS[task.priority] ?? ""}`}>
                {["low", "medium", "high", "critical"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Due">
              {readOnly ? (
                <p className="text-[12px]">{task.dueAt ? new Date(task.dueAt).toLocaleString() : "No due date"}</p>
              ) : (
                <div className="flex items-center gap-1">
                  <input
                    type="datetime-local"
                    value={dueDraft}
                    onChange={(e) => setDueDraft(e.target.value)}
                    onBlur={(e) => void saveDue(e.target.value)}
                    aria-label="Due date and time"
                    className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-2 py-1.5 text-[12px] text-[color:var(--color-foreground)]"
                  />
                  {task.dueAt && (
                    <button
                      type="button"
                      onClick={() => { setDueDraft(""); void saveDue(""); }}
                      className="shrink-0 px-1.5 text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-danger)]"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </Field>
          </div>

          {/* Attachments */}
          <div className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">Files</p>
            <ul className="space-y-1.5">
              {task.attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] p-2 text-[11.5px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.filename}</p>
                    <p className="text-[10px] text-[color:var(--color-muted-foreground)]">{(a.sizeBytes / 1024).toFixed(0)} KB · {a.uploadedByName ?? "Unknown"}</p>
                  </div>
                  <a href={`/api/incidents/${id}/tasks/${taskId}/attachments/${a.id}`} className="shrink-0 text-[color:var(--color-muted-foreground)] hover:text-[color:var(--mist-indigo)]" title="Download" aria-label="Download"><Download className="h-3.5 w-3.5" /></a>
                </li>
              ))}
              {task.attachments.length === 0 && <li className="py-2 text-center text-[11px] text-[color:var(--color-muted-foreground)]">No files.</li>}
            </ul>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
            {!readOnly && <button onClick={() => fileRef.current?.click()} disabled={uploading} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border)] py-2 text-[12px] hover:border-[color:var(--mist-indigo)]/50 disabled:opacity-50">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} {uploading ? "Uploading…" : "Upload file"}
            </button>}
            <p className="mt-1.5 text-[10px] text-[color:var(--color-muted-foreground)]">Files are hashed (SHA-256) and logged for chain of custody.</p>
          </div>
        </div>
      </div>

      <AssignUserModal open={picking} onClose={() => setPicking(false)} allowUnassign title="Assign action" onSelect={(userId) => patch({ assigneeId: userId })} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}
