"use client";

// Improvement plan UI pieces shared by the AAR panel and the /action-items page.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePromptDialog } from "@/components/ui/prompt-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { api } from "@/components/exercise/api";
import { toast } from "sonner";

export const POETE_OPTIONS = [
  { value: "planning", label: "Planning" },
  { value: "organization", label: "Organization" },
  { value: "equipment", label: "Equipment" },
  { value: "training", label: "Training" },
  { value: "exercise", label: "Exercise" },
];
export const POETE_LABEL: Record<string, string> = Object.fromEntries(POETE_OPTIONS.map((o) => [o.value, o.label]));

export const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "rejected", label: "Rejected" },
];
export const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

export const PRIORITY_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
export const PRIORITY_LABEL: Record<string, string> = Object.fromEntries(PRIORITY_OPTIONS.map((o) => [o.value, o.label]));

export interface ActionItem {
  id: string;
  exerciseId: string | null;
  exerciseTitle: string | null;
  aarId: string | null;
  aarVersion: number | null;
  aarStatus: string | null;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityName: string | null;
  objectiveId: string | null;
  objectiveText: string | null;
  afiId: string | null;
  afi: string;
  correctiveAction: string;
  poete: string | null;
  responsibleOrg: string | null;
  poc: string | null;
  pocEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  closureEvidence: string | null;
  rejectedReason: string | null;
  overdue: boolean;
  locked: boolean;
}

export interface PlanOptions {
  objectives: Array<{ id: string; seq: number; text: string }>;
  capabilities: Array<{ id: string; key: string; name: string }>;
}

export interface ItemDraft {
  afi: string;
  correctiveAction: string;
  capabilityId: string;
  objectiveId: string;
  poete: string;
  responsibleOrg: string;
  poc: string;
  pocEmail: string;
  startDate: string;
  dueDate: string;
  priority: string;
}

export const BLANK_DRAFT: ItemDraft = {
  afi: "",
  correctiveAction: "",
  capabilityId: "",
  objectiveId: "",
  poete: "",
  responsibleOrg: "",
  poc: "",
  pocEmail: "",
  startDate: "",
  dueDate: "",
  priority: "medium",
};

export function draftFromItem(i: ActionItem): ItemDraft {
  return {
    afi: i.afi,
    correctiveAction: i.correctiveAction,
    capabilityId: i.capabilityId ?? "",
    objectiveId: i.objectiveId ?? "",
    poete: i.poete ?? "",
    responsibleOrg: i.responsibleOrg ?? "",
    poc: i.poc ?? "",
    pocEmail: i.pocEmail ?? "",
    startDate: i.startDate?.slice(0, 10) ?? "",
    dueDate: i.dueDate?.slice(0, 10) ?? "",
    priority: i.priority,
  };
}

export function draftBody(d: ItemDraft) {
  return {
    afi: d.afi.trim(),
    correctiveAction: d.correctiveAction.trim(),
    capabilityId: d.capabilityId || null,
    objectiveId: d.objectiveId || null,
    poete: d.poete || null,
    responsibleOrg: d.responsibleOrg.trim() || null,
    poc: d.poc.trim() || null,
    pocEmail: d.pocEmail.trim() || null,
    startDate: d.startDate || null,
    dueDate: d.dueDate || null,
    priority: d.priority,
  };
}

export function ItemDialog({
  open,
  title,
  initial,
  options,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initial: ItemDraft;
  options: PlanOptions;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (d: ItemDraft) => Promise<boolean>;
}) {
  const [d, setD] = useState<ItemDraft>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setD(initial);
  }, [open, initial]);
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => setD((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(d);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>HSEEP improvement plan row.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ip-afi">Area for improvement</Label>
            <Textarea id="ip-afi" value={d.afi} onChange={(e) => set("afi", e.target.value)} rows={2} maxLength={2000} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ip-action">Corrective action</Label>
            <Textarea id="ip-action" value={d.correctiveAction} onChange={(e) => set("correctiveAction", e.target.value)} rows={2} maxLength={2000} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ip-cap">Capability</Label>
              <FieldSelect
                id="ip-cap"
                value={d.capabilityId}
                onChange={(v) => set("capabilityId", v)}
                options={[{ value: "", label: "None" }, ...options.capabilities.map((c) => ({ value: c.id, label: `${c.key} ${c.name}` }))]}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-obj">Objective</Label>
              <FieldSelect
                id="ip-obj"
                value={d.objectiveId}
                onChange={(v) => set("objectiveId", v)}
                options={[{ value: "", label: "None" }, ...options.objectives.map((o) => ({ value: o.id, label: o.seq ? `${o.seq}. ${o.text}` : o.text }))]}
                className="h-10"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-poete">POETE element</Label>
              <FieldSelect id="ip-poete" value={d.poete} onChange={(v) => set("poete", v)} options={[{ value: "", label: "None" }, ...POETE_OPTIONS]} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-priority">Priority</Label>
              <FieldSelect id="ip-priority" value={d.priority} onChange={(v) => set("priority", v)} options={PRIORITY_OPTIONS} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-org">Responsible organization</Label>
              <Input id="ip-org" value={d.responsibleOrg} onChange={(e) => set("responsibleOrg", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-poc">Point of contact</Label>
              <Input id="ip-poc" value={d.poc} onChange={(e) => set("poc", e.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ip-email">POC email</Label>
              <Input id="ip-email" type="email" value={d.pocEmail} onChange={(e) => set("pocEmail", e.target.value)} maxLength={200} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ip-start">Start</Label>
                <Input id="ip-start" type="date" value={d.startDate} onChange={(e) => set("startDate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ip-due">Due</Label>
                <Input id="ip-due" type="date" value={d.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !d.afi.trim() || !d.correctiveAction.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inline status select. Done asks for closure evidence; rejected asks for a reason. */
/** owner: the POC changing their own item (no rejection). */
export function StatusSelect({ item, disabled, owner, onChanged }: { item: ActionItem; disabled?: boolean; owner?: boolean; onChanged: () => void }) {
  const promptText = usePromptDialog();
  const [busy, setBusy] = useState(false);

  async function change(status: string) {
    if (status === item.status) return;
    const body: Record<string, unknown> = { status };
    if (status === "done") {
      const ev = await promptText({
        title: "Closure evidence",
        label: "What shows this is done?",
        placeholder: "Updated plan v3.2 approved 2026-11-02",
        required: true,
        multiline: true,
        confirmLabel: "Mark done",
      });
      if (ev === null) return;
      body.closureEvidence = ev;
    }
    if (status === "rejected") {
      const reason = await promptText({ title: "Reject this action", label: "Reason", required: true, multiline: true, confirmLabel: "Reject", destructive: true });
      if (reason === null) return;
      body.rejectedReason = reason;
    }
    setBusy(true);
    const r = await api(`/api/action-items/${item.id}`, { method: "PATCH", body, fallback: "The status was not saved. Try again." });
    setBusy(false);
    if (!r.ok) toast.error(r.error);
    onChanged();
  }

  return (
    <FieldSelect
      aria-label="Status"
      value={item.status}
      onChange={(v) => void change(v)}
      options={owner && item.status !== "rejected" ? STATUS_OPTIONS.filter((o) => o.value !== "rejected") : STATUS_OPTIONS}
      disabled={disabled || busy || (owner && item.status === "rejected")}
      className="h-8 min-w-[118px] text-[12.5px]"
    />
  );
}

export function StatusBadge({ item }: { item: Pick<ActionItem, "status" | "overdue"> }) {
  if (item.overdue) return <Badge variant="destructive">Overdue</Badge>;
  const v = item.status === "done" ? "success" : item.status === "rejected" ? "outline" : item.status === "in_progress" ? "accent" : "secondary";
  return <Badge variant={v}>{STATUS_LABEL[item.status] ?? item.status}</Badge>;
}

export function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Days from today, as YYYY-MM-DD. */
function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The action item form prefilled from an accepted finding: the area for
 * improvement, the corrective action from the recommendation, the objective,
 * the capability, and a start date of today with a due date 90 days out.
 */
export function draftFromAfi(
  a: { title: string; recommendation: string; objectiveId: string | null; capabilityKey: string | null },
  options: PlanOptions,
): ItemDraft {
  const capId = a.capabilityKey ? options.capabilities.find((c) => c.key === a.capabilityKey)?.id : undefined;
  return {
    ...BLANK_DRAFT,
    afi: a.title,
    correctiveAction: a.recommendation,
    objectiveId: a.objectiveId && options.objectives.some((o) => o.id === a.objectiveId) ? a.objectiveId : "",
    capabilityId: capId ?? "",
    startDate: dayFromNow(0),
    dueDate: dayFromNow(90),
  };
}
