"use client";

// <ImprovementPlanPanel exerciseId aarId editable />, rendered by the AAR page.
// Accepted findings with their follow-up (action item or "No action needed"),
// and the HSEEP improvement plan matrix. The Findings tab accepts and rejects;
// this panel uses the same model. After the version is final, rows keep live
// status tracking; everything else is locked.

import { useCallback, useMemo, useState } from "react";
import { Download, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { api } from "@/components/exercise/api";
import { usePoll } from "@/components/hotwash/use-poll";
import { ReasonDialog, type ReasonValue } from "@/components/aar/findings/reason-dialog";
import {
  BLANK_DRAFT,
  ItemDialog,
  POETE_LABEL,
  PRIORITY_LABEL,
  StatusBadge,
  StatusSelect,
  day,
  draftBody,
  draftFromAfi,
  draftFromItem,
  type ActionItem,
  type ItemDraft,
  type PlanOptions,
} from "./shared";

interface Afi {
  id: string;
  title: string;
  observation: string;
  recommendation: string;
  capabilityKey: string | null;
  objectiveId: string | null;
  objectiveText: string;
  actionItemId: string | null;
  rejectedReason: string | null;
  status: "proposed" | "accepted" | "rejected";
  decision: "action" | "no_action" | "rejected" | null;
  decisionText: string;
  carried: boolean;
}

interface Plan {
  aar: { id: string; exerciseId: string; version: number; status: string; isLatest: boolean };
  exercise: { title: string; isPractice: boolean; status: string };
  afis: Afi[];
  sectionsReadable: boolean;
  items: ActionItem[];
  options: PlanOptions;
  canWrite: boolean;
  locked: boolean;
}

type DialogState = { mode: "create"; afiId: string | null; initial: ItemDraft } | { mode: "edit"; item: ActionItem; initial: ItemDraft } | null;

function Panel({ exerciseId, aarId, editable }: { exerciseId: string; aarId: string; editable: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [noAction, setNoAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(async () => {
    const r = await api<Plan>(`/api/action-items/plan?aarId=${encodeURIComponent(aarId)}`);
    if (r.ok) {
      setPlan(r.data);
      setError(null);
    } else setError(r.error);
  }, [aarId]);
  usePoll(load, 20000);

  const itemsById = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.id, i])), [plan]);

  if (!plan) {
    if (error) return <p role="alert" className="text-[13px] text-[color:var(--mist-danger)]">{error}</p>;
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  if (plan.exercise.isPractice) return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Practice exercises do not get an improvement plan.</p>;

  const canEdit = editable && plan.canWrite && !plan.locked;
  const canTrack = plan.canWrite;
  const accepted = plan.afis.filter((a) => a.status === "accepted");
  const proposed = plan.afis.filter((a) => a.status === "proposed");
  const followUp = accepted.filter((a) => !a.actionItemId && a.decision !== "no_action");

  function createFromAfi(a: Afi) {
    setDialog({ mode: "create", afiId: a.id, initial: draftFromAfi(a, plan!.options) });
  }

  async function submitDialog(d: ItemDraft): Promise<boolean> {
    if (!dialog) return false;
    const r =
      dialog.mode === "create"
        ? await api(`/api/action-items`, { body: { ...draftBody(d), aarId, exerciseId, afiId: dialog.afiId }, fallback: "The action was not saved. Try again." })
        : await api(`/api/action-items/${dialog.item.id}`, { method: "PATCH", body: draftBody(d), fallback: "The change was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    void load();
    return true;
  }

  async function afiAction(a: Afi, action: "reopen" | "carry") {
    const res = await api(`/api/action-items/afis`, { body: { aarId, afiId: a.id, action }, fallback: "That did not save. Try again." });
    if (!res.ok) toast.error(res.error);
    else if (action === "carry") toast.success("Added to the suggested objectives.");
    void load();
  }

  async function submitNoAction(v: ReasonValue): Promise<boolean> {
    if (!noAction) return false;
    const res = await api(`/api/action-items/afis`, { body: { aarId, afiId: noAction, action: "no_action", ...v }, fallback: "That did not save. Try again." });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success("No action needed recorded.");
    void load();
    return true;
  }

  return (
    <div className="space-y-4">
      <Card dense className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-[15px] font-semibold">Accepted areas for improvement</h3>
          {accepted.length > 0 &&
            (followUp.length ? <Badge variant="warning">{followUp.length} to follow up</Badge> : <Badge variant="success">All followed up</Badge>)}
        </div>
        {!plan.sectionsReadable && <p className="text-[13px] text-[color:var(--mist-danger)]">The report sections could not be read.</p>}
        {proposed.length > 0 && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
            {proposed.length === 1 ? "One finding is proposed." : `${proposed.length} findings are proposed.`} Accept or reject them on the Findings tab.
          </p>
        )}
        {accepted.length === 0 && plan.sectionsReadable && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No accepted areas for improvement yet.</p>}
        <ul className="space-y-2">
          {accepted.map((a) => {
            const linked = a.actionItemId ? itemsById.get(a.actionItemId) : undefined;
            return (
              <li key={a.id} className="rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-[12px] text-[color:var(--color-muted-foreground)]">{a.objectiveText}</p>
                  </div>
                  {linked ? (
                    <Badge variant="success">Work item created</Badge>
                  ) : a.decision === "no_action" ? (
                    <Badge variant="secondary">No action needed</Badge>
                  ) : (
                    <Badge variant="warning">Open</Badge>
                  )}
                  {a.carried && <Badge variant="accent">Carried</Badge>}
                </div>
                {a.recommendation && <p className="mt-1 text-[12.5px]">Recommendation. {a.recommendation}</p>}
                {a.decision === "no_action" && a.decisionText && <p className="mt-1 text-[12.5px] text-[color:var(--color-muted-foreground)]">Reason. {a.decisionText}</p>}
                {linked && <p className="mt-1 text-[12.5px] text-[color:var(--color-muted-foreground)]">Action. {linked.correctiveAction}</p>}
                {canEdit && (
                  <div className="mt-2 flex flex-wrap justify-end gap-1">
                    {!a.actionItemId && a.decision !== "no_action" && (
                      <>
                        <Button size="xs" onClick={() => createFromAfi(a)}>
                          Create work item
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => setNoAction(a.id)}>
                          No action needed
                        </Button>
                      </>
                    )}
                    {a.decision === "no_action" && (
                      <Button size="xs" variant="ghost" onClick={() => void afiAction(a, "reopen")}>
                        Reopen
                      </Button>
                    )}
                    {!a.carried && !linked && (
                      <Button size="xs" variant="ghost" onClick={() => void afiAction(a, "carry")}>
                        Carry to next exercise
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card dense className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 text-[15px] font-semibold">Improvement plan</h3>
          <a
            href={`/api/action-items/export?aarId=${encodeURIComponent(aarId)}&status=all`}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-medium hover:bg-[color:var(--color-muted)]"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "create", afiId: null, initial: BLANK_DRAFT })}>
              <Plus className="h-4 w-4" />
              Add action
            </Button>
          )}
        </div>
        {plan.locked && <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">This version is final. Status and closure evidence can still change.</p>}
        {plan.items.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No actions yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[1100px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-[color:var(--color-muted-foreground)]">
                  <th className="py-1.5 pr-2 font-medium">Capability</th>
                  <th className="py-1.5 pr-2 font-medium">Objective</th>
                  <th className="py-1.5 pr-2 font-medium">Area for improvement</th>
                  <th className="py-1.5 pr-2 font-medium">Corrective action</th>
                  <th className="py-1.5 pr-2 font-medium">POETE</th>
                  <th className="py-1.5 pr-2 font-medium">Responsible org</th>
                  <th className="py-1.5 pr-2 font-medium">POC</th>
                  <th className="py-1.5 pr-2 font-medium">Start</th>
                  <th className="py-1.5 pr-2 font-medium">Due</th>
                  <th className="py-1.5 pr-2 font-medium">Priority</th>
                  <th className="py-1.5 pr-2 font-medium">Status</th>
                  <th className="py-1.5 font-medium">Closure evidence</th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map((i) => (
                  <tr key={i.id} className="border-t border-[color:var(--color-border)] align-top">
                    <td className="py-2 pr-2">{i.capabilityKey ?? ""}</td>
                    <td className="max-w-[160px] py-2 pr-2">{i.objectiveText ?? ""}</td>
                    <td className="max-w-[200px] py-2 pr-2">{i.afi}</td>
                    <td className="max-w-[220px] py-2 pr-2">
                      {i.correctiveAction}
                      {canEdit && (
                        <Button size="xs" variant="ghost" className="ml-1" onClick={() => setDialog({ mode: "edit", item: i, initial: draftFromItem(i) })}>
                          Edit
                        </Button>
                      )}
                    </td>
                    <td className="py-2 pr-2">{i.poete ? POETE_LABEL[i.poete] : ""}</td>
                    <td className="py-2 pr-2">{i.responsibleOrg ?? ""}</td>
                    <td className="py-2 pr-2">{i.poc ?? ""}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{day(i.startDate)}</td>
                    <td className="py-2 pr-2 font-mono tabular-nums">{day(i.dueDate)}</td>
                    <td className="py-2 pr-2">{PRIORITY_LABEL[i.priority] ?? i.priority}</td>
                    <td className="py-2 pr-2">
                      {canTrack ? <StatusSelect item={i} onChanged={() => void load()} /> : <StatusBadge item={i} />}
                      {i.overdue && <p className="mt-1 text-[11px] text-[color:var(--mist-danger)]">Overdue</p>}
                    </td>
                    <td className="max-w-[200px] py-2">{i.status === "rejected" ? (i.rejectedReason ?? "") : (i.closureEvidence ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ReasonDialog open={noAction !== null} kind="no_action" count={1} onClose={() => setNoAction(null)} onSubmit={submitNoAction} />
      <ItemDialog
        open={dialog !== null}
        title={dialog?.mode === "edit" ? "Edit action" : dialog?.afiId ? "Create action for this area" : "Add action"}
        initial={dialog?.initial ?? BLANK_DRAFT}
        options={plan.options}
        submitLabel={dialog?.mode === "edit" ? "Save" : "Create"}
        onClose={() => setDialog(null)}
        onSubmit={submitDialog}
      />
    </div>
  );
}

export function ImprovementPlanPanel({ exerciseId, aarId, editable = true }: { exerciseId: string; aarId: string; editable?: boolean }) {
  return (
    <ConfirmDialogProvider>
      <Panel exerciseId={exerciseId} aarId={aarId} editable={editable} />
    </ConfirmDialogProvider>
  );
}

