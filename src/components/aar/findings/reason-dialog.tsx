"use client";

// Reason for rejecting a finding or for "No action needed": a preset, free
// text, and a reference for "Tracked elsewhere". The reason is required.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { reasonProblem } from "@/lib/exercise/aar/findings";
import { FINDINGS_LABELS } from "@/lib/exercise/aar/field-labels";
import { NO_ACTION_PRESETS, REJECT_PRESETS } from "@/lib/exercise/aar/schema";

export interface ReasonValue {
  preset: string | null;
  reason: string;
  reference: string;
}

export function ReasonDialog({
  open,
  kind,
  count,
  onClose,
  onSubmit,
}: {
  open: boolean;
  kind: "rejected" | "no_action";
  /** Findings this reason applies to. */
  count: number;
  onClose: () => void;
  onSubmit: (v: ReasonValue) => Promise<boolean>;
}) {
  const presets = kind === "rejected" ? REJECT_PRESETS : NO_ACTION_PRESETS;
  const [preset, setPreset] = useState<string>(presets[0].key);
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPreset(presets[0].key);
      setReason("");
      setReference("");
      setError(null);
    }
  }, [open, presets]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = reasonProblem(kind, { preset, reason, reference });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const ok = await onSubmit({ preset, reason: reason.trim(), reference: reference.trim() });
    setBusy(false);
    if (ok) onClose();
  }

  const title = kind === "rejected" ? (count > 1 ? `Reject ${count} findings` : "Reject this finding") : FINDINGS_LABELS.noAction;
  const description = kind === "rejected" ? "It stays out of the report and is listed in the appendix with the reason." : "The finding stays in the report with no work item.";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[13px] font-medium">{FINDINGS_LABELS.reason}</legend>
            {presets.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-[14px]">
                <input type="radio" name={`reason-${kind}`} value={p.key} checked={preset === p.key} onChange={() => setPreset(p.key)} className="size-4 accent-[color:var(--mist-navy)]" />
                {p.label}
              </label>
            ))}
          </fieldset>
          {preset === "tracked_elsewhere" && (
            <div className="space-y-1.5">
              <Label htmlFor="reason-reference">{FINDINGS_LABELS.reference}</Label>
              <Input id="reason-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={300} placeholder="Ticket or plan reference" required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="reason-details">{FINDINGS_LABELS.details}</Label>
            <Textarea id="reason-details" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} required={preset === "other"} />
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} variant={kind === "rejected" ? "destructive" : "default"}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {kind === "rejected" ? FINDINGS_LABELS.reject : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
