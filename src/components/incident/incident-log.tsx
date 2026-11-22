"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScrollText, ShieldCheck, ShieldAlert, Loader2, Plus, Zap, ChevronRight,
  Gavel, ListChecks, Users, Megaphone, Siren, Check, FolderLock,
  Lock, MessageSquare, CheckCircle2, Shield,
} from "lucide-react";
import { toast } from "sonner";
import { useIncidentShell } from "./incident-shell";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface ActivityEntry {
  id: string;
  action: string;
  notes: string | null;
  userName: string | null;
  timestamp: string;
}

interface LedgerEntry {
  seq: number;
  eventType: string;
  actorLabel: string | null;
  payloadJson: Record<string, unknown> | null;
  createdAt: string;
}

interface LogItem {
  key: string;
  ts: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
  actor: string | null;
  verified: boolean;
}

// Activity actions already mirrored on the ledger — skip them to avoid dupes.
const LEDGER_MIRRORED = new Set(["declared", "status_changed", "closure_gate_overridden", "false_positive"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function describeLedger(e: LedgerEntry): { icon: LogItem["icon"]; label: string; detail?: string } {
  const p = e.payloadJson ?? {};
  switch (e.eventType) {
    case "declared": return { icon: Zap, label: "Incident declared" };
    case "status_changed":
    case "incident_closed":
    case "incident_reopened": {
      // Payload is { from, to } (older rows may carry { status }).
      const to = str(p.to) || str(p.status);
      const from = str(p.from);
      const label = e.eventType === "incident_closed"
        ? "Incident closed"
        : e.eventType === "incident_reopened"
          ? `Incident reopened → ${to || "open"}`
          : `Status → ${to || "changed"}`;
      const parts = [from && to ? `${from} → ${to}` : "", str(p.disposition).replace(/_/g, " ")].filter(Boolean);
      return { icon: e.eventType === "incident_closed" ? CheckCircle2 : ChevronRight, label, detail: parts.join(" · ") || undefined };
    }
    case "closure_gate_overridden": {
      const blockers = Array.isArray(p.blockers) ? (p.blockers as unknown[]).map((b) => str(b).replace(/_/g, " ")).join(", ") : "";
      return { icon: ShieldAlert, label: "Closed with override", detail: [str(p.reason), blockers ? `overrode: ${blockers}` : ""].filter(Boolean).join(" · ") };
    }
    case "false_positive_marked": return { icon: Shield, label: "Closed as false positive", detail: str(p.reason).replace(/_/g, " ") };
    case "decision_made": return { icon: Gavel, label: `Decision: ${str(p.title)}`, detail: str(p.status) };
    case "task_updated": return { icon: ListChecks, label: `Action: ${str(p.title)}`, detail: str(p.kind) };
    case "task_assigned": return { icon: ListChecks, label: `Action assigned: ${str(p.title)}` };
    case "task_acknowledged": return { icon: ListChecks, label: `Action acknowledged: ${str(p.title)}` };
    case "task_status_changed": return { icon: ListChecks, label: `Action ${str(p.from)} → ${str(p.to)}`, detail: str(p.title) };
    case "task_commented": return { icon: MessageSquare, label: `Comment on action: ${str(p.title)}` };
    case "task_attachment_added": return { icon: FolderLock, label: `Uploaded to action: ${str(p.filename)}` };
    case "role_assigned": return { icon: Users, label: `Command role assigned: ${str(p.role).replace(/_/g, " ")}` };
    case "notification_sent": return { icon: Megaphone, label: `Stakeholder notified: ${str(p.stakeholder)}`, detail: str(p.channel) };
    case "page_sent": return { icon: Siren, label: `Paged ${str(p.targetName) || "a responder"}`, detail: str(p.note) };
    case "page_acked": return { icon: Check, label: "Page acknowledged" };
    case "page_delivery": {
      const ds = Array.isArray(p.deliveries) ? (p.deliveries as Array<Record<string, unknown>>) : [];
      const detail = ds.map((d) => `${str(d.channel) || str(d.provider)}: ${str(d.status)}`).join(" · ");
      const what = str(p.deliveryKind) === "escalation" ? "Escalation delivered" : "Page delivered";
      return { icon: Siren, label: `${what}${str(p.target) ? ` to ${str(p.target)}` : ""}`, detail: detail || undefined };
    }
    case "page_cancelled": {
      const n = typeof p.count === "number" ? p.count : 0;
      return { icon: Siren, label: n === 1 ? "Open page cancelled" : `${n} open pages cancelled`, detail: str(p.reason).replace(/_/g, " ") || undefined };
    }
    case "evidence_added": return { icon: FolderLock, label: `Evidence added: ${str(p.filename)}` };
    case "incident_locked": return { icon: Lock, label: "Incident locked" };
    case "incident_unlocked": return { icon: Lock, label: "Incident unlocked" };
    case "incident_deleted": return { icon: ScrollText, label: "Incident deleted by an Org admin" };
    case "participant_added": return { icon: Users, label: `Participant added: ${str(p.userName)}` };
    case "participant_removed": return { icon: Users, label: `Participant removed: ${str(p.userName)}` };
    case "note_added": return { icon: MessageSquare, label: str(p.note) || "Note" };
    case "handover_accepted": return { icon: Users, label: "Shift handover accepted", detail: str(p.fromUserName) ? `from ${str(p.fromUserName)}` : undefined };
    case "guest_invited": return { icon: Users, label: `Guest invited: ${str(p.email)}` };
    case "guest_revoked": return { icon: Users, label: `Guest link revoked: ${str(p.email)}` };
    case "status_page_published": return { icon: Megaphone, label: "Status page published" };
    case "status_page_unpublished": return { icon: Megaphone, label: "Status page taken offline" };
    case "status_page_update_posted": return { icon: Megaphone, label: `Posted to status page: ${str(p.headline)}` };
    case "status_page_update_removed": return { icon: Megaphone, label: `Removed from status page: ${str(p.headline)}` };
    case "playbook_attached": return { icon: ListChecks, label: `Playbook attached: ${str(p.title)}` };
    case "playbook_removed": return { icon: ListChecks, label: `Playbook removed: ${str(p.title)}` };
    case "playbook_step_done": return { icon: ListChecks, label: `Playbook step done: ${str(p.step)}`, detail: str(p.title) || undefined };
    case "playbook_step_reopened": return { icon: ListChecks, label: `Playbook step reopened: ${str(p.step)}`, detail: str(p.title) || undefined };
    default: return { icon: ScrollText, label: e.eventType.replace(/_/g, " ") };
  }
}

function describeActivity(a: ActivityEntry): { icon: LogItem["icon"]; label: string; detail?: string } {
  switch (a.action) {
    case "note_added": return { icon: MessageSquare, label: a.notes ?? "Note" };
    case "containment_initiated": return { icon: Shield, label: a.notes ?? "Containment initiated" };
    case "resolved": return { icon: CheckCircle2, label: a.notes ?? "Resolved" };
    default: return { icon: ScrollText, label: a.notes ?? a.action.replace(/_/g, " ") };
  }
}

// Unified, ledger-first incident log. Merges the tamper-evident ledger (the
// authoritative defensible record) with activity-only events (notes, document
// links, playbook starts), newest first, and exposes one-click chain
// verification + inline note capture.
export function IncidentLog({
  incidentId,
  activity,
  onChange,
}: {
  incidentId: string;
  activity: ActivityEntry[];
  onChange: () => void;
}) {
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [verify, setVerify] = useState<{
    valid: boolean;
    status?: "valid" | "head_unsigned" | "key_mismatch" | "tampered";
    brokenAtSeq: number | null;
    entryCount: number;
    reason?: string | null;
    warnings?: string[];
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const { readOnly } = useIncidentShell();

  const loadLedger = useCallback(async () => {
    const res = await fetch(`/api/incidents/${incidentId}/ledger`);
    if (res.ok) setLedger((await res.json()).entries ?? []);
    setLoading(false);
  }, [incidentId]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger, activity]);

  const runVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/ledger/verify`);
      if (res.ok) setVerify(await res.json());
    } finally {
      setVerifying(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "note_added", notes: note.trim() }),
      });
      if (res.ok) {
        setNote("");
        setNoteOpen(false);
        onChange();
      } else toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't add note. Try again."));
    } finally {
      setAdding(false);
    }
  };

  const items: LogItem[] = [
    ...ledger.map((e) => {
      const d = describeLedger(e);
      return { key: `l-${e.seq}`, ts: e.createdAt, icon: d.icon, label: d.label, detail: d.detail, actor: e.actorLabel, verified: true };
    }),
    ...activity
      .filter((a) => !LEDGER_MIRRORED.has(a.action))
      .map((a) => {
        const d = describeActivity(a);
        return { key: `a-${a.id}`, ts: a.timestamp, icon: d.icon, label: d.label, detail: d.detail, actor: a.userName, verified: false };
      }),
  ].sort((x, y) => new Date(y.ts).getTime() - new Date(x.ts).getTime());

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-[color:var(--mist-indigo)]" />
          <h2 className="text-sm font-semibold">Incident log</h2>
        </div>
        <div className="flex items-center gap-2">
          {verify && (
            <span
              title={verify.reason || verify.warnings?.join("; ") || undefined}
              className={`inline-flex items-center gap-1 text-[11px] font-medium ${verify.valid ? "text-[color:var(--mist-ok)]" : "text-[color:var(--mist-danger)]"}`}
            >
              {verify.valid ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
              {verify.valid
                ? `Chain intact (${verify.entryCount})${verify.warnings?.length ? " (see note)" : ""}`
                : verify.status === "key_mismatch"
                  ? "Key changed, can't verify"
                  : verify.brokenAtSeq != null
                  ? `Broken at #${verify.brokenAtSeq}`
                  : verify.status === "head_unsigned"
                    ? "Head unsigned"
                    : "Head check failed"}
            </span>
          )}
          <button
            type="button"
            onClick={runVerify}
            disabled={verifying}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[color:var(--color-border)] px-2 py-1 text-[11px] hover:border-[color:var(--mist-indigo)]/50"
          >
            {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            Verify
          </button>
          {!readOnly && <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-2 py-1 text-[11px] font-medium text-white"
          >
            <Plus className="h-3 w-3" /> Note
          </button>}
        </div>
      </div>

      {noteOpen && !readOnly && (
        <div className="space-y-2 border-b border-[color:var(--color-border)] p-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Add a note"
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-2 text-[13px]"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setNoteOpen(false); setNote(""); }} className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[color:var(--color-muted-foreground)]">Cancel</button>
            <button type="button" onClick={addNote} disabled={adding || !note.trim()} className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-[color:var(--mist-indigo)] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50">
              {adding && <Loader2 className="h-3 w-3 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[420px] overflow-y-auto p-3">
        {loading ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-[color:var(--color-muted-foreground)]" /></div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--color-muted-foreground)]">No entries.</p>
        ) : (
          <ul className="space-y-0">
            {items.map((it, i) => {
              const Icon = it.icon;
              return (
                <li key={it.key} className="relative flex gap-3 pb-3">
                  {i < items.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-[color:var(--color-border)]" />}
                  <span className="relative z-10 mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
                    <Icon className="h-3.5 w-3.5 text-[color:var(--mist-indigo)]" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium leading-tight">{it.label}</span>
                      {it.verified && <ShieldCheck className="h-3 w-3 shrink-0 text-[color:var(--mist-ok)]" aria-label="Ledger-verified" />}
                    </div>
                    {it.detail && <p className="truncate text-[11.5px] text-[color:var(--color-muted-foreground)] first-letter:uppercase">{it.detail}</p>}
                    <p className="mt-0.5 text-[10.5px] text-[color:var(--color-muted-foreground)]">
                      {it.actor ?? "System"} · {new Date(it.ts).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
