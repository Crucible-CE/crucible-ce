"use client";

// Findings tab: every area for improvement starts as proposed. The
// facilitator accepts it (it goes in the report) or rejects it with a reason
// (it goes in the appendix). An accepted finding then gets an action item or
// "No action needed" with a reason. Bulk accept and reject, merge two
// proposed findings, reopen any decision.

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { api } from "@/components/exercise/api";
import { formatInZone } from "@/lib/exercise/time";
import { AAR_FIELD_LABELS as F, FINDINGS_LABELS as L } from "@/lib/exercise/aar/field-labels";
import { allFindings, decisionText, type FindingView } from "@/lib/exercise/aar/findings";
import { FINDING_SOURCE_LABELS, type AarSections } from "@/lib/exercise/aar/schema";
import { BLANK_DRAFT, ItemDialog, draftFromAfi, draftBody, type ItemDraft, type PlanOptions } from "@/components/aar/plan/shared";
import { EditableText, EvidenceChip, EvidencePicker, FieldLabel } from "@/components/aar/editor/fields";
import type { ReportActions } from "@/components/aar/editor/report-view";
import { ReasonDialog, type ReasonValue } from "./reason-dialog";

export interface FindingsPanelProps {
  exerciseId: string;
  aarId: string;
  sections: AarSections;
  /** Draft: merge, write and edit text. */
  contentEditable: boolean;
  /** Draft or review: accept, reject, reopen, action items and "No action needed". */
  followUpEditable: boolean;
  canDrive: boolean;
  timezone: string;
  actions: ReportActions;
  onChanged: () => Promise<void> | void;
}

type ReasonState = { kind: "rejected" | "no_action"; ids: string[] } | null;

function SourceBadges({ f }: { f: FindingView }) {
  const kinds = [...new Set(f.afi.sources.map((s) => s.kind))];
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sources">
      {kinds.map((k) => (
        <li key={k}>
          <Badge variant="outline">{FINDING_SOURCE_LABELS[k]}</Badge>
        </li>
      ))}
    </ul>
  );
}

function byLine(by: string, at: string, tz: string): string {
  const when = at ? formatInZone(new Date(at), tz) : "";
  return [by, when].filter(Boolean).join(", ");
}

export function FindingsPanel({ exerciseId, aarId, sections, contentEditable, followUpEditable, canDrive, timezone, actions, onChanged }: FindingsPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<ReasonState>(null);
  const [writing, setWriting] = useState(false);
  const [plan, setPlan] = useState<{ afiId: string; initial: ItemDraft; options: PlanOptions } | null>(null);

  const all = useMemo(() => allFindings(sections), [sections]);
  const proposed = all.filter((f) => f.afi.status === "proposed");
  const accepted = all.filter((f) => f.afi.status === "accepted");
  const rejected = all.filter((f) => f.afi.status === "rejected");
  const objectives = sections.analysis.map((a, i) => ({ value: a.objectiveId, label: `${i + 1}. ${a.objectiveText}` }));
  const canDecide = followUpEditable && canDrive;
  const sel = selected.filter((id) => proposed.some((f) => f.afi.id === id));

  async function post(body: Record<string, unknown>, ok: string): Promise<boolean> {
    setBusy(true);
    const r = await api(`/api/exercises/${exerciseId}/aar/findings`, { body, fallback: "That did not save. Try again." });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success(ok);
    setSelected([]);
    await onChanged();
    return true;
  }

  const targetFor = (f: FindingView) => targets[f.afi.id] ?? f.objectiveId ?? "";
  async function accept(list: FindingView[]) {
    const missing = list.filter((f) => !targetFor(f));
    if (missing.length) {
      toast.error("Pick the objective each finding is about.");
      return;
    }
    // One call per target objective, so findings with no objective land where the facilitator chose.
    const groups = new Map<string, string[]>();
    for (const f of list) groups.set(targetFor(f), [...(groups.get(targetFor(f)) ?? []), f.afi.id]);
    for (const [objectiveId, ids] of groups) {
      const ok = await post({ action: "accept", ids, objectiveId }, ids.length > 1 || list.length > 1 ? "Findings accepted." : "Finding accepted.");
      if (!ok) return;
    }
  }

  async function submitReason(v: ReasonValue): Promise<boolean> {
    if (!reason) return false;
    if (reason.kind === "rejected") return post({ action: "reject", ids: reason.ids, ...v }, reason.ids.length > 1 ? "Findings rejected." : "Finding rejected.");
    return post({ action: "no_action", ids: reason.ids, ...v }, "No action needed recorded.");
  }

  async function openActionForm(f: FindingView) {
    const r = await api<{ options: PlanOptions }>(`/api/action-items/plan?aarId=${encodeURIComponent(aarId)}`);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setPlan({ afiId: f.afi.id, options: r.data.options, initial: draftFromAfi({ ...f.afi, objectiveId: f.objectiveId }, r.data.options) });
  }

  async function submitAction(d: ItemDraft): Promise<boolean> {
    if (!plan) return false;
    const r = await api(`/api/action-items`, { body: { ...draftBody(d), aarId, exerciseId, afiId: plan.afiId }, fallback: "The work item was not saved. Try again." });
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    toast.success("Work item created.");
    await onChanged();
    return true;
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  function renderCard(f: FindingView) {
    const a = f.afi;
    const editText = contentEditable && a.status !== "rejected";
    const save = (field: "title" | "observation" | "analysis" | "recommendation") => (v: string) => actions.save(f.section, `${f.base}.${field}`, v);
    const headingId = `finding-${a.id}`;
    return (
      <li key={a.id} className="space-y-3 rounded-md border border-[color:var(--color-border)] p-3" data-testid="finding" data-status={a.status} aria-labelledby={headingId}>
        <div className="flex items-start gap-2">
          {a.status === "proposed" && canDecide && (
            <input
              type="checkbox"
              className="mt-1 size-4 accent-[color:var(--mist-navy)]"
              checked={selected.includes(a.id)}
              onChange={() => toggle(a.id)}
              aria-label={`Select ${a.title}`}
            />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div id={headingId} role="heading" aria-level={4} className="font-semibold">
              <EditableText value={a.title} editable={editText} multiline={false} onSave={save("title")} label={F.title} maxLength={300} />
            </div>
            <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">{f.objectiveText ? `${F.objective}: ${f.objectiveText}` : "No objective yet."}</p>
            <SourceBadges f={f} />
          </div>
        </div>
        {a.status !== "rejected" ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <FieldLabel>{F.observation}</FieldLabel>
              <EditableText value={a.observation} editable={editText} onSave={save("observation")} label={F.observation} maxLength={3000} />
            </div>
            <div>
              <FieldLabel>{F.analysis}</FieldLabel>
              <EditableText value={a.analysis} editable={editText} onSave={save("analysis")} label={F.analysis} maxLength={3000} />
            </div>
            <div>
              <FieldLabel>{F.recommendation}</FieldLabel>
              <EditableText value={a.recommendation} editable={editText} onSave={save("recommendation")} label={F.recommendation} maxLength={2000} />
            </div>
          </div>
        ) : (
          a.observation && <p className="text-[13px]">{a.observation}</p>
        )}
        {(a.evidence.length > 0 || editText) && (
          <div className="space-y-1.5">
            {a.evidence.length > 0 && (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {a.evidence.map((e, k) => (
                  <EvidenceChip key={`${e.sourceId}-${k}`} e={e} timezone={timezone} onRemove={editText ? () => actions.remove(f.section, `${f.base}.evidence.${k}`, "this evidence") : undefined} />
                ))}
              </div>
            )}
            {editText && actions.evidence && <EvidencePicker options={actions.evidence} cited={a.evidence} onPick={(e) => actions.save(f.section, `${f.base}.evidence.${a.evidence.length}`, e)} />}
          </div>
        )}

        {a.status === "proposed" && canDecide && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(f.objectiveId === null || objectives.length > 1) && (
              <FieldSelect
                aria-label={`${L.objective} for ${a.title}`}
                value={targetFor(f)}
                onChange={(v) => setTargets((t) => ({ ...t, [a.id]: v }))}
                options={[{ value: "", label: "Pick an objective" }, ...objectives]}
                className="h-8 max-w-[260px] text-[12.5px]"
              />
            )}
            <Button size="xs" onClick={() => void accept([f])} disabled={busy}>
              <Check />
              {L.accept}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setReason({ kind: "rejected", ids: [a.id] })} disabled={busy}>
              {L.reject}
            </Button>
          </div>
        )}

        {a.status === "accepted" && (
          <div className="space-y-2">
            {a.actionItemId ? (
              <Badge variant="success">Work item created</Badge>
            ) : a.decision?.kind === "no_action" ? (
              <p className="text-[13px]">
                <Badge variant="secondary">{L.noAction}</Badge> {decisionText(a.decision)}
              </p>
            ) : (
              <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Create a work item or record why no action is needed.</p>
            )}
            {a.review?.at && <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Accepted by {byLine(a.review.byName || "a facilitator", a.review.at, timezone)}</p>}
            {canDrive && (
              <div className="flex flex-wrap justify-end gap-2">
                {!a.actionItemId && a.decision?.kind !== "no_action" && followUpEditable && (
                  <>
                    <Button size="xs" onClick={() => void openActionForm(f)} disabled={busy}>
                      {L.createAction}
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => setReason({ kind: "no_action", ids: [a.id] })} disabled={busy}>
                      {L.noAction}
                    </Button>
                  </>
                )}
                {!a.actionItemId && followUpEditable && (
                  <Button size="xs" variant="ghost" onClick={() => void post({ action: "reopen", ids: [a.id] }, "Finding reopened.")} disabled={busy}>
                    {L.reopen}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {a.status === "rejected" && (
          <div className="space-y-1">
            <p className="text-[13px]">
              {L.reason}: {decisionText(a.decision) || a.rejectedReason}
            </p>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Rejected by {byLine(a.decision?.byName || a.review?.byName || "a facilitator", a.decision?.at || a.review?.at || "", timezone)}</p>
            {canDecide && (
              <div className="flex justify-end">
                <Button size="xs" variant="ghost" onClick={() => void post({ action: "reopen", ids: [a.id] }, "Finding reopened.")} disabled={busy}>
                  {L.reopen}
                </Button>
              </div>
            )}
          </div>
        )}
      </li>
    );
  }

  const section = (title: string, list: FindingView[], testId: string, empty: string) => (
    <section className="space-y-2" aria-labelledby={`${testId}-h`} data-testid={testId}>
      <h3 id={`${testId}-h`} className="text-[14px] font-semibold">
        {title} ({list.length})
      </h3>
      {list.length === 0 ? <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{empty}</p> : <ul className="space-y-2">{list.map((f) => renderCard(f))}</ul>}
    </section>
  );

  return (
    <div className="space-y-4" data-testid="findings">
      <Card dense className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold">{L.tab}</h2>
          {proposed.length ? <Badge variant="warning">{proposed.length} to decide</Badge> : all.length ? <Badge variant="success">All decided</Badge> : null}
          {contentEditable && (
            <>
              <Button size="sm" variant="outline" onClick={() => void post({ action: "collect" }, "Checked the record.")} disabled={busy}>
                <RefreshCw />
                {L.collect}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWriting(true)} disabled={busy}>
                <Plus />
                {L.write}
              </Button>
            </>
          )}
        </div>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Accept a finding to put it in the report. Reject it with a reason to keep it out.</p>
        {contentEditable && <CloudSeam feature="aar-drafting" />}
        {!contentEditable && followUpEditable && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">In review a decision changes the report. Signers sign again.</p>}
      </Card>

      {canDecide && proposed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]" role="group" aria-label="Selected findings">
          <span role="status" aria-live="polite" className="flex-1">
            {sel.length ? `${sel.length} selected` : "Select findings to decide them together."}
          </span>
          <Button size="xs" variant="ghost" onClick={() => setSelected(sel.length === proposed.length ? [] : proposed.map((f) => f.afi.id))}>
            {sel.length === proposed.length ? "Clear" : "Select all"}
          </Button>
          <Button size="xs" onClick={() => void accept(proposed.filter((f) => sel.includes(f.afi.id)))} disabled={busy || !sel.length}>
            Accept selected
          </Button>
          <Button size="xs" variant="outline" onClick={() => setReason({ kind: "rejected", ids: sel })} disabled={busy || !sel.length}>
            Reject selected
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void post({ action: "merge", primaryId: sel[0], secondaryId: sel[1] }, "Findings merged.")}
            disabled={busy || sel.length !== 2 || !contentEditable}
            title="Select two findings. The first one selected keeps its title."
          >
            {L.merge}
          </Button>
          {busy && <Loader2 className="size-4 animate-spin" aria-label="Saving" />}
        </div>
      )}

      {section(L.proposed, proposed, "findings-proposed", "No proposed findings.")}
      {section(L.accepted, accepted, "findings-accepted", "No accepted findings yet.")}
      {section(L.rejected, rejected, "findings-rejected", "No rejected findings.")}

      <ReasonDialog open={reason !== null} kind={reason?.kind ?? "rejected"} count={reason?.ids.length ?? 1} onClose={() => setReason(null)} onSubmit={submitReason} />
      <WriteDialog open={writing} objectives={objectives} onClose={() => setWriting(false)} onSubmit={(v) => post({ action: "add", ...v }, "Finding added.")} />
      <ItemDialog
        open={plan !== null}
        title={L.createAction}
        initial={plan?.initial ?? BLANK_DRAFT}
        options={plan?.options ?? { objectives: [], capabilities: [] }}
        submitLabel="Create"
        onClose={() => setPlan(null)}
        onSubmit={submitAction}
      />
    </div>
  );
}

function WriteDialog({
  open,
  objectives,
  onClose,
  onSubmit,
}: {
  open: boolean;
  objectives: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSubmit: (v: { objectiveId: string | null; title: string; observation: string }) => Promise<boolean>;
}) {
  const [objectiveId, setObjectiveId] = useState("");
  const [title, setTitle] = useState("");
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit({ objectiveId: objectiveId || null, title: title.trim(), observation: observation.trim() });
    setBusy(false);
    if (ok) {
      setTitle("");
      setObservation("");
      onClose();
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{L.write}</DialogTitle>
          <DialogDescription>It starts as proposed.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="finding-objective">{L.objective}</Label>
            <FieldSelect id="finding-objective" value={objectiveId} onChange={setObjectiveId} options={[{ value: "", label: "None yet" }, ...objectives]} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="finding-title">{F.title}</Label>
            <Input id="finding-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="finding-observation">{F.observation}</Label>
            <Textarea id="finding-observation" value={observation} onChange={(e) => setObservation(e.target.value)} rows={3} maxLength={3000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
