"use client";

// Close-incident dialog. Every close picks a disposition. If the closure gate
// blocks (PATCH answers 409 with its blockers — e.g. no postmortem yet), the
// blockers are listed and the responder can either resolve them or "Close with
// override", which requires a written reason; the API ledgers the override
// (closure_gate_overridden) with the reason and the blocker codes.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DISPOSITION_LABELS, type Disposition } from "@/lib/incident/disposition";
import { apiErrorMessage } from "@/lib/incident/lock-shared";

interface Blocker {
  code: string;
  message: string;
}

// False positive has its own flow (reason codes for detection tuning), so the
// generic close offers the other dispositions and links to that flow.
const CLOSE_DISPOSITIONS: Disposition[] = ["true_positive", "benign"];
const OVERRIDE_REASON_MAX = 2000;

export function CloseIncidentDialog({
  incidentId,
  open,
  onOpenChange,
  onClosed,
  onFalsePositive,
}: {
  incidentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void | Promise<void>;
  /** Switch to the dedicated false-positive flow instead. */
  onFalsePositive?: () => void;
}) {
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [note, setNote] = useState("");
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDisposition("");
    setNote("");
    setOverrideReason("");
    setError(null);
    setBlockers([]);
  }, [open]);

  const blocked = blockers.length > 0;
  const reason = overrideReason.trim();

  const submit = async (withOverride: boolean) => {
    if (!disposition) {
      setError("Select a disposition.");
      return;
    }
    if (withOverride && !reason) {
      setError("Enter a reason for the override.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/incidents/${incidentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "closed",
          closureDisposition: disposition,
          closureNote: note.trim() || undefined,
          ...(withOverride ? { overrideClosureGate: true, overrideReason: reason } : {}),
        }),
      });
      if (res.ok) {
        toast.success(withOverride ? "Incident closed with override" : "Incident closed");
        onOpenChange(false);
        await onClosed();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.error === "closure_blocked") {
        setBlockers(Array.isArray(body.blockers) ? body.blockers : []);
        setError(null);
      } else {
        setError(apiErrorMessage(body, "Couldn't close the incident. Try again."));
      }
    } catch {
      setError("Couldn't close the incident. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> Close incident
          </DialogTitle>
          <DialogDescription>
            Pick a disposition and close. Reopen to undo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {blocked && (
            <div className="rounded-md border border-[color:var(--mist-warn)]/40 bg-[color:var(--mist-warn)]/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[color:var(--mist-warn)]">
                <AlertTriangle className="h-3.5 w-3.5" /> Closure is blocked
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Resolve these or close with an override. The override and your reason are recorded.
              </p>
            </div>
          )}

          <div>
            <label htmlFor="close-disposition" className="mb-1 block text-xs font-medium text-muted-foreground">
              Disposition (required)
            </label>
            <select
              id="close-disposition"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as Disposition | "")}
              className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-sm"
            >
              <option value="">Select a disposition</option>
              {CLOSE_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </select>
            {onFalsePositive && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onFalsePositive();
                }}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                <ShieldX className="h-3 w-3" /> Close as {DISPOSITION_LABELS.false_positive.toLowerCase()} instead
              </button>
            )}
          </div>

          <div>
            <label htmlFor="close-note" className="mb-1 block text-xs font-medium text-muted-foreground">
              Closure note (optional)
            </label>
            <textarea
              id="close-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Outcome"
              className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-sm"
            />
          </div>

          {blocked && (
            <div>
              <label htmlFor="override-reason" className="mb-1 block text-xs font-medium text-muted-foreground">
                Override reason (required)
              </label>
              <textarea
                id="override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
                maxLength={OVERRIDE_REASON_MAX}
                placeholder="Why close with these open?"
                className="w-full rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-2 text-sm"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-xs text-[color:var(--mist-danger)]">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {blocked ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => submit(true)}
              disabled={submitting || !disposition || !reason}
            >
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />}
              Close with override
            </Button>
          ) : (
            <Button size="sm" onClick={() => submit(false)} disabled={submitting || !disposition}>
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Close incident
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
