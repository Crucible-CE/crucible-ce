"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Minus,
  Lock,
  Pencil,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ShieldX } from "lucide-react";
import { DISPOSITION_LABELS, FALSE_POSITIVE_REASONS, fpReasonLabel, type Disposition } from "@/lib/incident/disposition";
import { SlaTimers } from "@/components/incident/sla-timers";
import { RelatedIncidents } from "@/components/incident/related-incidents";
import { BusinessImpact } from "@/components/incident/business-impact";
import { DecisionsPanel } from "@/components/incident/decisions-panel";
import { TasksPanel } from "@/components/incident/tasks-panel";
import { IncidentLog } from "@/components/incident/incident-log";
import { ResponseTeam } from "@/components/incident/response-team";
import { AccessPanel } from "@/components/incident/access-panel";
import { IncidentChat } from "@/components/incident/incident-chat";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { CloseIncidentDialog } from "@/components/incident/close-incident-dialog";
import { useIncidentShell } from "@/components/incident/incident-shell";
import { deriveStageStates } from "@/lib/incident/stage-progress";
import { apiErrorMessage } from "@/lib/incident/lock-shared";
import { useNow } from "@/hooks/use-now";
import { formatElapsed } from "@/lib/datetime/duration";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityEntry {
  id: string;
  action: string;
  notes: string;
  userId: string;
  userName: string | null;
  timestamp: string;
  metadata: Record<string, unknown> | null;
}

interface IncidentDetail {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  restricted: boolean;
  /** Read-only for this viewer because the incident is locked. */
  lockReadOnly: boolean;
  /** This viewer may change the incident (permission and lock). */
  viewerCanEdit: boolean;
  /** Administrator: may soft-delete the incident. */
  viewerCanDelete?: boolean;
  category: string | null;
  source: string;
  affectedSystems: string[] | null;
  mitreJson: string[] | null;
  declaredAt: string | null;
  containedAt: string | null;
  resolvedAt: string | null;
  closureDisposition: string | null;
  closureReason: string | null;
  closureNote: string | null;
  createdAt: string;
  reportedBy: { id: string; name: string | null };
  assignedTo: { id: string; name: string | null } | null;
  activityLog: ActivityEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_ORDER = [
  "open",
  "investigating",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;

const STATUS_NEXT: Record<string, { label: string; next: string }> = {
  open: { label: "Start investigating", next: "investigating" },
  investigating: { label: "Mark contained", next: "contained" },
  contained: { label: "Mark eradicated", next: "eradicated" },
  eradicated: { label: "Mark recovered", next: "recovered" },
  recovered: { label: "Close incident", next: "closed" },
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-[color:var(--mist-danger)]/10 text-[color:var(--mist-danger)] border-[color:var(--mist-danger)]/30",
  investigating: "bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)] border-[color:var(--mist-warn)]/30",
  contained: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
  eradicated: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
  recovered: "bg-[color:var(--mist-ok)]/10 text-[color:var(--mist-ok)] border-[color:var(--mist-ok)]/30",
  closed: "bg-muted text-muted-foreground border-border",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-[color:var(--mist-danger)]/10 text-[color:var(--mist-danger)] border-[color:var(--mist-danger)]/30",
  high: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
  medium: "bg-[color:var(--mist-warn)]/10 text-[color:var(--mist-warn)] border-[color:var(--mist-warn)]/30",
  low: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusPipeline({ current, history }: { current: string; history: ActivityEntry[] }) {
  const stages = deriveStageStates(current, history);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {stages.map(({ stage: s, state }, i) => {
        const done = state === "done";
        const active = state === "active";
        const skipped = state === "skipped";
        return (
          <div key={s} className="flex items-center gap-1">
            {i > 0 && (
              <div
                className={`h-px w-4 ${
                  done || active ? "bg-primary/50" : skipped ? "border-t border-dashed border-border" : "bg-border"
                }`}
              />
            )}
            <div
              className={`flex h-5 items-center rounded-full px-2 text-[10px] font-medium transition-colors ${
                active
                  ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                  : done
                  ? "bg-[color:var(--mist-ok)]/15 text-[color:var(--mist-ok)]"
                  : skipped
                  ? "border border-dashed border-border bg-transparent text-muted-foreground/60"
                  : "bg-muted/40 text-muted-foreground/50"
              }`}
            >
              {done && <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />}
              {skipped && <Minus className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />}
              <span className={`capitalize ${skipped ? "line-through" : ""}`}>{s}</span>
              {skipped && <span className="sr-only"> Skipped</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const now = useNow();
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [declaring, setDeclaring] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);
  const [fpOpen, setFpOpen] = useState(false);
  const [fpReason, setFpReason] = useState<string>("");
  const [fpNote, setFpNote] = useState("");
  const [fpSubmitting, setFpSubmitting] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shell = useIncidentShell();
  const router = useRouter();
  const confirm = useConfirm();

  // Administrator-only SOFT delete: hidden from every list and lookup, ledger
  // preserved (an incident_deleted entry is appended). No purge in v0.1.
  const deleteIncident = async () => {
    const ok = await confirm({
      title: "Delete this incident?",
      description:
        "Hides the incident from everyone and cancels open pages. The record, ledger and audit log are kept. You can't restore it from the app.",
      confirmLabel: "Delete incident",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't delete incident. Try again."));
        return;
      }
      toast.success("Incident deleted");
      router.push("/incidents");
    } catch {
      toast.error("Couldn't delete incident. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${params.id}`);
      if (!res.ok) throw new Error();
      setIncident(await res.json());
    } catch {
      toast.error("Couldn't load incident. Try again.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload this page AND the layout's side card after any change.
  const reloadAll = useCallback(async () => {
    await load();
    shell.refresh();
  }, [load, shell]);

  const handleDeclare = async () => {
    setDeclaring(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}/declare`, { method: "POST" });
      if (!res.ok) {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't declare incident. Try again."));
        return;
      }
      toast.success("Incident declared");
      await reloadAll();
    } catch {
      toast.error("Couldn't declare incident. Try again.");
    } finally {
      setDeclaring(false);
    }
  };

  const handleAdvanceStatus = async () => {
    if (!incident) return;
    const next = STATUS_NEXT[incident.status];
    if (!next) return;
    // Closing always goes through the dialog: disposition + closure gate.
    if (next.next === "closed") {
      setCloseOpen(true);
      return;
    }
    setAdvancing(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next.next }),
      });
      if (!res.ok) {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update status. Try again."));
        return;
      }
      toast.success(`Status: ${next.next}`);
      await reloadAll();
    } catch {
      toast.error("Couldn't update status. Try again.");
    } finally {
      setAdvancing(false);
    }
  };

  const startEditTitle = () => {
    if (!incident) return;
    setTitleDraft(incident.title);
    setEditingTitle(true);
  };
  const saveTitle = async () => {
    if (!incident) return;
    const next = titleDraft.trim();
    if (!next || next === incident.title) { setEditingTitle(false); return; }
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't update title. Try again."));
        return;
      }
      toast.success("Title updated");
      setEditingTitle(false);
      await reloadAll();
    } catch {
      toast.error("Couldn't update title. Try again.");
    } finally {
      setSavingTitle(false);
    }
  };

  const markFalsePositive = async () => {
    if (!fpReason) { toast.error("Select a reason"); return; }
    setFpSubmitting(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}/false-positive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: fpReason, note: fpNote.trim() || undefined }),
      });
      if (!res.ok) {
        toast.error(apiErrorMessage(await res.json().catch(() => null), "Couldn't mark as false positive. Try again."));
        return;
      }
      toast.success("Closed as false positive");
      setFpOpen(false);
      setFpReason("");
      setFpNote("");
      await reloadAll();
    } catch {
      toast.error("Couldn't mark as false positive. Try again.");
    } finally {
      setFpSubmitting(false);
    }
  };

  if (loading) {
    return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/30" />;
  }
  if (!incident) {
    return <div className="py-20 text-center text-sm text-muted-foreground">Incident not found.</div>;
  }

  const nextAction = STATUS_NEXT[incident.status];
  const readOnly = !incident.viewerCanEdit;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="pb-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-[18rem] items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                incident.severity === "critical"
                  ? "bg-[color:var(--mist-danger)]/15 text-[color:var(--mist-danger)]"
                  : "bg-orange-500/15 text-orange-700 dark:text-orange-400"
              }`}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {editingTitle ? (
                  <span className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") setEditingTitle(false); }}
                      maxLength={300}
                      className="headline w-[min(70vw,28rem)] rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-0.5"
                    />
                    <button onClick={saveTitle} disabled={savingTitle} title="Save" className="rounded-md border border-[color:var(--color-border)] p-1.5 text-[color:var(--mist-emerald)] disabled:opacity-50">
                      {savingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button onClick={() => setEditingTitle(false)} title="Cancel" className="rounded-md border border-[color:var(--color-border)] p-1.5 text-muted-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ) : (
                  <span className="group flex items-center gap-1.5">
                    <h1 className="headline break-words">{incident.title}</h1>
                    {!readOnly && (
                      <button onClick={startEditTitle} title="Edit title" className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-[color:var(--color-muted)] hover:text-foreground group-hover:opacity-100">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                )}
                <Badge variant="outline" className={`text-[10px] uppercase ${SEVERITY_STYLES[incident.severity] ?? ""}`}>
                  {incident.severity}
                </Badge>
                <Badge variant="outline" className={`text-[10px] capitalize ${STATUS_STYLES[incident.status] ?? ""}`}>
                  {incident.status}
                </Badge>
                {incident.restricted && (
                  <Badge variant="outline" className="border-[color:var(--mist-danger)]/40 text-[10px] uppercase text-[color:var(--mist-danger)]">
                    <Lock className="mr-1 h-3 w-3" /> Locked
                  </Badge>
                )}
                {incident.closureDisposition === "false_positive" && (
                  <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">
                    <ShieldX className="mr-1 h-3 w-3" /> False positive
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {incident.category && <span className="capitalize">{incident.category.replace(/_/g, " ")}</span>}
                <span>Reported {new Date(incident.createdAt).toLocaleString()}</span>
                {incident.declaredAt && (
                  <span className="flex items-center gap-1 text-[color:var(--mist-warn)]">
                    <Clock className="h-3 w-3" />
                    Declared {formatElapsed(incident.declaredAt, now)} ago
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!readOnly && !incident.declaredAt && incident.status !== "closed" && (
              <Button
                size="sm"
                onClick={handleDeclare}
                disabled={declaring}
                className="bg-[color:var(--mist-danger)] text-white hover:bg-[color:var(--mist-danger)]"
              >
                {declaring ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
                Formally declare
              </Button>
            )}
            <Link
              href="/incidents"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary/30"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
          </div>
        </div>

        <StatusPipeline current={incident.status} history={incident.activityLog} />
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main content */}
        <div className="space-y-4">
          <IncidentLog incidentId={incident.id} activity={incident.activityLog} onChange={reloadAll} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <DecisionsPanel incidentId={incident.id} />
            <TasksPanel incidentId={incident.id} />
          </div>

          {/* Details (description, scope, markers) */}
          <details className="rounded-[var(--radius-lg)] border border-border bg-card/60">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Incident details</summary>
            <div className="space-y-4 p-4 pt-0">
              <div>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Description</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{incident.description}</p>
              </div>

              {incident.affectedSystems && incident.affectedSystems.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Affected systems</h3>
                  <div className="flex flex-wrap gap-2">
                    {incident.affectedSystems.map((s) => (
                      <span key={s} className="rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {incident.mitreJson && incident.mitreJson.length > 0 && (
                <div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">MITRE ATT&CK</h3>
                  <div className="flex flex-wrap gap-2">
                    {incident.mitreJson.map((t) => (
                      <span key={t} className="rounded-md bg-[color:var(--mist-indigo)]/10 px-2 py-1 text-[11px] font-mono text-[color:var(--mist-indigo)]">{t}</span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Markers</h3>
                <div className="space-y-2 text-xs">
                  {[
                    { label: "Reported", value: incident.createdAt },
                    { label: "Declared", value: incident.declaredAt },
                    { label: "Contained", value: incident.containedAt },
                    { label: "Closed", value: incident.resolvedAt },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between border-b border-border/30 pb-2 last:border-0 last:pb-0">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={value ? "font-medium" : "italic text-muted-foreground/50"}>
                        {value ? new Date(value).toLocaleString() : "Not yet"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </details>
        </div>

        {/* ── Sidebar ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {incident.status !== "closed" && <SlaTimers incidentId={incident.id} />}
          <BusinessImpact incidentId={incident.id} />
          <RelatedIncidents incidentId={incident.id} />
          {!readOnly && incident.status !== "closed" && <CloudSeam feature="exo-next-actions" />}
          {!readOnly && incident.status !== "closed" && (
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Next step</h3>
              {nextAction && (
                <Button
                  className="w-full"
                  size="sm"
                  onClick={handleAdvanceStatus}
                  disabled={advancing}
                  variant={incident.status === "recovered" ? "destructive" : "default"}
                >
                  {advancing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {nextAction.label}
                </Button>
              )}
              {nextAction && incident.status !== "recovered" && (
                <Button
                  className="mt-2 w-full"
                  size="sm"
                  variant="outline"
                  onClick={() => setCloseOpen(true)}
                >
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  Close incident…
                </Button>
              )}
              <Button
                className="mt-2 w-full text-muted-foreground"
                size="sm"
                variant="outline"
                onClick={() => setFpOpen(true)}
              >
                <ShieldX className="mr-1.5 h-3.5 w-3.5" />
                Mark as false positive
              </Button>
            </div>
          )}

          {incident.status === "closed" && incident.closureDisposition === "false_positive" && (
            <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-muted)]/30 p-4 text-center">
              <ShieldX className="mx-auto mb-1.5 h-6 w-6 text-muted-foreground" />
              <p className="text-xs font-semibold">Closed as false positive</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{fpReasonLabel(incident.closureReason)}</p>
              {incident.closureNote && <p className="mt-1 text-[10px] italic text-muted-foreground">&ldquo;{incident.closureNote}&rdquo;</p>}
              {incident.resolvedAt && (
                <p className="mt-1 text-[10px] text-muted-foreground">{new Date(incident.resolvedAt).toLocaleString()}</p>
              )}
            </div>
          )}

          {incident.status === "closed" && incident.closureDisposition !== "false_positive" && (
            <div className="rounded-xl border border-[color:var(--mist-ok)]/20 bg-[color:var(--mist-ok)]/5 p-4 text-center">
              <CheckCircle2 className="mx-auto mb-1.5 h-6 w-6 text-[color:var(--mist-ok)]" />
              <p className="text-xs font-semibold text-[color:var(--mist-ok)]">Incident closed</p>
              {incident.closureDisposition && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {DISPOSITION_LABELS[incident.closureDisposition as Disposition] ?? incident.closureDisposition}
                </p>
              )}
              {incident.closureNote && <p className="mt-1 text-[10px] italic text-muted-foreground">&ldquo;{incident.closureNote}&rdquo;</p>}
              {incident.resolvedAt && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">Resolved {new Date(incident.resolvedAt).toLocaleString()}</p>
              )}
            </div>
          )}

          {!incident.declaredAt && (
            <div className="rounded-xl border border-[color:var(--mist-warn)]/20 bg-[color:var(--mist-warn)]/5 p-4">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mist-warn)]" />
                <div>
                  <p className="text-xs font-semibold text-[color:var(--mist-warn)]">Not declared</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    Declaring records the time on the ledger.
                  </p>
                </div>
              </div>
            </div>
          )}

          <ResponseTeam incidentId={incident.id} reportedByName={incident.reportedBy.name} onChange={reloadAll} />

          <AccessPanel incidentId={incident.id} onChange={reloadAll} />

          {incident.viewerCanDelete && (
            <div className="rounded-xl border border-[color:var(--mist-danger)]/25 bg-card/60 p-4">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Administrator</h3>
              <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
                Hides the incident from everyone. The ledger and audit log are kept.
              </p>
              <Button className="w-full" size="sm" variant="destructive" onClick={deleteIncident} disabled={deleting}>
                {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                Delete incident…
              </Button>
            </div>
          )}

          <IncidentChat incidentId={incident.id} heightClass="h-[380px]" />
        </div>
      </div>

      <CloseIncidentDialog
        incidentId={incident.id}
        open={closeOpen}
        onOpenChange={setCloseOpen}
        onClosed={reloadAll}
        onFalsePositive={() => setFpOpen(true)}
      />

      <Dialog open={fpOpen} onOpenChange={setFpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldX className="h-4 w-4" /> Mark as false positive</DialogTitle>
            <DialogDescription>
              Closes the incident as not a real security event. Reopen to undo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason</label>
              <select
                value={fpReason}
                onChange={(e) => setFpReason(e.target.value)}
                className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-sm"
              >
                <option value="">Select a reason</option>
                {FALSE_POSITIVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Note (optional)</label>
              <textarea
                value={fpNote}
                onChange={(e) => setFpNote(e.target.value)}
                rows={3}
                placeholder="What did you see?"
                className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFpOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={markFalsePositive} disabled={fpSubmitting || !fpReason}>
              {fpSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldX className="mr-1.5 h-3.5 w-3.5" />}
              Close as false positive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
