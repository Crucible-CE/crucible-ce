// Findings review: every area for improvement starts as proposed, and a
// facilitator accepts or rejects it. Accepted findings appear in the report
// and get an action item or a "No action needed" reason. Rejected findings
// stay out of the report and are listed, with the reason, in the appendix.
// Only "Create action item" creates work. Pure.
//
//   const { sections, log } = applyFindingAction(sections, { kind: "accept", ids: ["afi_1"] }, actor, now);

import { AarEditError } from "./edit";
import {
  FINDING_SOURCE_LABELS,
  FINDING_STATUS_LABELS,
  FINDING_STATUSES,
  NO_ACTION_PRESETS,
  REJECT_PRESETS,
  aarSectionsSchema,
  type AarSections,
  type Afi,
  type EditLogEntry,
  type FindingDecision,
  type FindingStatus,
} from "./schema";

const MAX_AFIS_PER_OBJECTIVE = 40;

export interface FindingActor {
  userId: string | null;
  name: string;
}

export interface FindingLocation {
  /** analysis index, or null for a finding with no objective. */
  objectiveIndex: number | null;
  /** Index in analysis[i].afis or unassignedFindings. */
  index: number;
}

export interface FindingView extends FindingLocation {
  afi: Afi;
  objectiveId: string | null;
  objectiveText: string;
  /** Section and path for section edits of this finding's text. */
  section: "analysis" | "unassignedFindings";
  base: string;
}

/** Every finding: under objectives in report order, then those with no objective. */
export function allFindings(sections: AarSections): FindingView[] {
  const out: FindingView[] = [];
  sections.analysis.forEach((a, i) => {
    a.afis.forEach((afi, j) => out.push({ afi, objectiveIndex: i, index: j, objectiveId: a.objectiveId, objectiveText: a.objectiveText, section: "analysis", base: `${i}.afis.${j}` }));
  });
  sections.unassignedFindings.forEach((afi, k) => out.push({ afi, objectiveIndex: null, index: k, objectiveId: null, objectiveText: "", section: "unassignedFindings", base: String(k) }));
  return out;
}

/**
 * Status of a stored AFI in any shape, including reports signed before the
 * findings review: those carried every AFI in the report unless it had a
 * rejection reason.
 */
export function findingStatusOf(f: { status?: unknown; rejectedReason?: unknown }): FindingStatus {
  if (typeof f.status === "string" && (FINDING_STATUSES as readonly string[]).includes(f.status)) return f.status as FindingStatus;
  return typeof f.rejectedReason === "string" && f.rejectedReason.trim() ? "rejected" : "accepted";
}

/** AFIs the report body prints: accepted only. */
export function reportAfis<T extends { status?: unknown; rejectedReason?: unknown }>(afis: T[]): T[] {
  return afis.filter((f) => findingStatusOf(f) === "accepted");
}

/** Findings the appendix lists: rejected (with reason), and proposed while the report is a draft. */
export function appendixFindings(sections: Pick<AarSections, "analysis"> & { unassignedFindings?: AarSections["unassignedFindings"] }): Array<{ afi: Afi; objectiveText: string; status: FindingStatus }> {
  const out: Array<{ afi: Afi; objectiveText: string; status: FindingStatus }> = [];
  for (const a of sections.analysis) {
    for (const f of a.afis) {
      const status = findingStatusOf(f);
      if (status !== "accepted") out.push({ afi: f, objectiveText: a.objectiveText, status });
    }
  }
  for (const f of sections.unassignedFindings ?? []) {
    const status = findingStatusOf(f);
    if (status !== "accepted") out.push({ afi: f, objectiveText: "", status });
  }
  return out;
}

const PRESETS = { rejected: REJECT_PRESETS, no_action: NO_ACTION_PRESETS } as const;

export function presetLabel(kind: FindingDecision["kind"], preset: string | null | undefined): string {
  if (!preset || kind === "action") return "";
  return (PRESETS[kind] as ReadonlyArray<{ key: string; label: string }>).find((p) => p.key === preset)?.label ?? "";
}

/** "Tracked elsewhere. Reference: CHG-1042. Owned by IT." Empty for an action. */
export function decisionText(d: Pick<FindingDecision, "kind" | "preset" | "reason" | "reference"> | null | undefined): string {
  if (!d || d.kind === "action") return "";
  const label = d.preset === "other" ? "" : presetLabel(d.kind, d.preset);
  // Free text alone stays as written.
  if (!label && !d.reference?.trim()) return d.reason?.trim() ?? "";
  const parts = [label, d.reference?.trim() ? `Reference: ${d.reference.trim()}` : "", d.reason?.trim() ?? ""]
    .map((p) => p.replace(/[.\s]+$/, ""))
    .filter(Boolean);
  return parts.length ? `${parts.join(". ")}.` : "";
}

export interface ReasonInput {
  preset?: string | null;
  reason?: string | null;
  reference?: string | null;
}

/** Why a reason is not enough, or null. Pure. */
export function reasonProblem(kind: "rejected" | "no_action", r: ReasonInput): string | null {
  const preset = r.preset ?? null;
  const reason = (r.reason ?? "").trim();
  const reference = (r.reference ?? "").trim();
  if (preset && !(PRESETS[kind] as ReadonlyArray<{ key: string }>).some((p) => p.key === preset)) return "Pick a reason from the list.";
  if (!preset && !reason) return "Give a reason.";
  if (preset === "other" && !reason) return "Describe the reason.";
  if (preset === "tracked_elsewhere" && !reference) return "Say where it is tracked.";
  return null;
}

/** Lowercase letters and digits only, for spotting repeats. */
export function normalizeFindingText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type FindingAction =
  | { kind: "accept"; ids: string[]; objectiveId?: string | null }
  | ({ kind: "reject"; ids: string[] } & ReasonInput)
  | ({ kind: "no_action"; ids: string[] } & ReasonInput)
  | { kind: "reopen"; ids: string[] }
  | { kind: "link_action"; id: string; actionItemId: string }
  | { kind: "merge"; primaryId: string; secondaryId: string }
  | { kind: "add"; id: string; objectiveId: string | null; title: string; observation?: string; analysis?: string; recommendation?: string };

export interface FindingActionResult {
  sections: AarSections;
  log: Array<Omit<EditLogEntry, "at" | "byUserId" | "origin">>;
  /** One entry per finding changed, for the audit record. */
  changed: Array<{ afiId: string; status: FindingStatus; decision: FindingDecision["kind"] | null }>;
}

function locate(sections: AarSections, id: string): FindingView {
  const hit = allFindings(sections).find((f) => f.afi.id === id);
  if (!hit) throw new AarEditError(404, "That finding is not in this report.");
  return hit;
}

function take(sections: AarSections, loc: FindingLocation): Afi {
  if (loc.objectiveIndex === null) return sections.unassignedFindings.splice(loc.index, 1)[0];
  return sections.analysis[loc.objectiveIndex].afis.splice(loc.index, 1)[0];
}

function place(sections: AarSections, afi: Afi, objectiveIndex: number | null): FindingView {
  if (objectiveIndex === null) {
    sections.unassignedFindings.push(afi);
  } else {
    const a = sections.analysis[objectiveIndex];
    if (a.afis.length >= MAX_AFIS_PER_OBJECTIVE) throw new AarEditError(409, "That objective has the most findings it can hold. Merge or reject some first.");
    if (!afi.capabilityKey && a.capabilityKeys[0]) afi.capabilityKey = a.capabilityKeys[0];
    a.afis.push(afi);
  }
  return locate(sections, afi.id);
}

function pathOf(v: FindingView): { section: "analysis" | "unassignedFindings"; path: string } {
  return { section: v.section, path: `${v.section}.${v.base}` };
}

function stamp(actor: FindingActor, at: string) {
  return { byUserId: actor.userId, byName: actor.name.slice(0, 120), at };
}

function unique(ids: string[]): string[] {
  const out = [...new Set(ids.filter(Boolean))];
  if (!out.length) throw new AarEditError(400, "Pick at least one finding.");
  return out;
}

function objectiveIndexOf(sections: AarSections, objectiveId: string | null | undefined): number | null {
  if (!objectiveId) return null;
  const i = sections.analysis.findIndex((a) => a.objectiveId === objectiveId);
  if (i < 0) throw new AarEditError(400, "That objective is not in this report.");
  return i;
}

/**
 * Apply one findings action to a copy of the sections. Bulk actions check
 * every finding before changing any. Throws AarEditError on a rule failure.
 */
export function applyFindingAction(input: AarSections, action: FindingAction, actor: FindingActor, now: Date = new Date()): FindingActionResult {
  const sections = structuredClone(input);
  const at = now.toISOString();
  const log: FindingActionResult["log"] = [];
  const changed: FindingActionResult["changed"] = [];
  const done = (v: FindingView, note: string) => {
    log.push({ ...pathOf(v), note: note.slice(0, 300) });
    changed.push({ afiId: v.afi.id, status: v.afi.status, decision: v.afi.decision?.kind ?? null });
  };

  switch (action.kind) {
    case "accept": {
      const ids = unique(action.ids);
      const target = action.objectiveId === undefined ? undefined : objectiveIndexOf(sections, action.objectiveId);
      const views = ids.map((id) => locate(sections, id));
      for (const v of views) {
        if (v.afi.status !== "proposed") throw new AarEditError(409, `"${v.afi.title}" is already ${v.afi.status}. Reopen it first.`);
        if (v.objectiveIndex === null && (target === undefined || target === null)) {
          throw new AarEditError(400, sections.analysis.length ? "Pick the objective each finding is about." : "The exercise has no objectives. Add one before accepting findings.");
        }
      }
      for (const id of ids) {
        const v = locate(sections, id);
        v.afi.status = "accepted";
        v.afi.review = stamp(actor, at);
        v.afi.decision = null;
        v.afi.rejectedReason = null;
        let now2 = v;
        if (target !== undefined && target !== null && target !== v.objectiveIndex) {
          const afi = take(sections, v);
          now2 = place(sections, afi, target);
        }
        done(now2, "Accepted");
      }
      break;
    }
    case "reject":
    case "no_action": {
      const ids = unique(action.ids);
      const kind = action.kind === "reject" ? "rejected" : "no_action";
      const problem = reasonProblem(kind, action);
      if (problem) throw new AarEditError(400, problem);
      for (const id of ids) {
        const v = locate(sections, id);
        if (v.afi.actionItemId) throw new AarEditError(409, `"${v.afi.title}" has a work item. Change it on the Improvement plan tab.`);
        if (action.kind === "reject" && v.afi.status === "rejected") throw new AarEditError(409, `"${v.afi.title}" is already rejected.`);
        if (action.kind === "no_action" && v.afi.status !== "accepted") throw new AarEditError(409, `Accept "${v.afi.title}" first.`);
      }
      const decision: FindingDecision = {
        kind,
        preset: action.preset ?? null,
        reason: (action.reason ?? "").trim().slice(0, 1000),
        reference: (action.reference ?? "").trim().slice(0, 300),
        ...stamp(actor, at),
      };
      const text = decisionText(decision).slice(0, 1000);
      for (const id of ids) {
        const v = locate(sections, id);
        v.afi.decision = { ...decision };
        if (action.kind === "reject") {
          v.afi.status = "rejected";
          v.afi.review = stamp(actor, at);
          v.afi.rejectedReason = text;
          done(v, `Rejected. ${text}`);
        } else {
          v.afi.rejectedReason = null;
          done(v, `No action needed. ${text}`);
        }
      }
      break;
    }
    case "reopen": {
      const ids = unique(action.ids);
      for (const id of ids) {
        const v = locate(sections, id);
        if (v.afi.actionItemId) throw new AarEditError(409, `"${v.afi.title}" has a work item. Change it on the Improvement plan tab.`);
      }
      for (const id of ids) {
        const v = locate(sections, id);
        v.afi.status = "proposed";
        v.afi.decision = null;
        v.afi.review = null;
        v.afi.rejectedReason = null;
        done(v, "Reopened");
      }
      break;
    }
    case "link_action": {
      const v = locate(sections, action.id);
      if (v.afi.status === "rejected") throw new AarEditError(409, "That finding is rejected. Reopen and accept it first.");
      if (v.objectiveIndex === null) throw new AarEditError(400, "Accept the finding under an objective first.");
      if (v.afi.status === "proposed") v.afi.review = stamp(actor, at);
      v.afi.status = "accepted";
      v.afi.actionItemId = action.actionItemId;
      v.afi.rejectedReason = null;
      v.afi.decision = { kind: "action", preset: null, reason: "", reference: "", ...stamp(actor, at) };
      done(v, "Work item linked");
      break;
    }
    case "merge": {
      if (action.primaryId === action.secondaryId) throw new AarEditError(400, "Pick two different findings.");
      const p = locate(sections, action.primaryId);
      const s = locate(sections, action.secondaryId);
      if (p.afi.status !== "proposed" || s.afi.status !== "proposed") throw new AarEditError(409, "Only proposed findings can be merged.");
      const secondary = take(sections, s);
      const primary = locate(sections, action.primaryId);
      const f = primary.afi;
      const extra = secondary.observation.trim();
      if (extra && !normalizeFindingText(f.observation).includes(normalizeFindingText(extra))) {
        f.observation = [f.observation.trim(), extra].filter(Boolean).join("\n\n").slice(0, 3000);
      }
      if (!f.analysis.trim()) f.analysis = secondary.analysis;
      if (!f.recommendation.trim()) f.recommendation = secondary.recommendation;
      if (!f.capabilityKey) f.capabilityKey = secondary.capabilityKey;
      const srcKey = (x: { kind: string; sourceId: string | null }) => `${x.kind}:${x.sourceId ?? ""}`;
      for (const src of secondary.sources) if (!f.sources.some((x) => srcKey(x) === srcKey(src)) && f.sources.length < 20) f.sources.push(src);
      for (const e of secondary.evidence) if (!f.evidence.some((x) => x.kind === e.kind && x.sourceId === e.sourceId) && f.evidence.length < 10) f.evidence.push(e);
      for (const r of secondary.references) if (!f.references.some((x) => x.type === r.type && x.ref === r.ref) && f.references.length < 10) f.references.push(r);
      f.mergedFrom = [...new Set([...f.mergedFrom, secondary.id, ...secondary.mergedFrom])].slice(0, 20);
      log.push({ ...pathOf(s), note: `Merged into ${f.id}` });
      done(primary, `Merged ${secondary.id} into this finding`);
      break;
    }
    case "add": {
      const title = action.title.trim();
      if (!title) throw new AarEditError(400, "Give the finding a title.");
      if (allFindings(sections).some((f) => f.afi.id === action.id)) throw new AarEditError(409, "That finding already exists.");
      const target = objectiveIndexOf(sections, action.objectiveId);
      const afi: Afi = {
        id: action.id,
        title: title.slice(0, 300),
        observation: (action.observation ?? "").trim().slice(0, 3000),
        analysis: (action.analysis ?? "").trim().slice(0, 3000),
        recommendation: (action.recommendation ?? "").trim().slice(0, 2000),
        capabilityKey: null,
        references: [],
        evidence: [],
        actionItemId: null,
        rejectedReason: null,
        status: "proposed",
        decision: null,
        review: null,
        sources: [{ kind: "written", sourceId: null }],
        mergedFrom: [],
      };
      if (target === null && sections.unassignedFindings.length >= 100) throw new AarEditError(409, "The report has the most findings it can hold. Merge or reject some first.");
      done(place(sections, afi, target), "Written");
      break;
    }
  }
  return { sections: aarSectionsSchema.parse(sections), log, changed };
}

/**
 * Why a section edit may not make this change to the findings, or null.
 * Status, decisions and sources change only through the findings actions.
 * A decided finding, or one that came from the record, cannot be removed:
 * reject it instead. Pure.
 */
export function findingsEditProblem(before: AarSections, after: AarSections): string | null {
  const b = new Map(allFindings(before).map((f) => [f.afi.id, f.afi]));
  const a = new Map(allFindings(after).map((f) => [f.afi.id, f.afi]));
  const fp = (f: Afi) => JSON.stringify([f.status, f.decision, f.review, f.sources, f.mergedFrom, f.actionItemId, f.rejectedReason]);
  for (const [id, prev] of b) {
    const next = a.get(id);
    if (!next) {
      if (prev.status !== "proposed" || prev.sources.some((s) => s.kind !== "written")) return "Reject the finding with a reason instead of removing it.";
      continue;
    }
    if (fp(prev) !== fp(next)) return "Accept, reject and follow up on findings on the Findings tab.";
    const where = (s: AarSections) => allFindings(s).find((f) => f.afi.id === id)?.objectiveId ?? null;
    if (where(before) !== where(after)) return "Move a finding to another objective on the Findings tab.";
  }
  for (const [id, next] of a) {
    if (b.has(id)) continue;
    if (next.status !== "proposed" || next.decision || next.review || next.actionItemId || next.rejectedReason) return "A new finding starts as proposed.";
    if (next.sources.some((s) => s.kind !== "written")) return "A new finding starts as proposed.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Appendix
// ---------------------------------------------------------------------------

export interface AppendixRow {
  id: string;
  title: string;
  objective: string;
  status: string;
  sources: string;
  reason: string;
  by: string;
  at: string | null;
}

/** "Hotwash, Grade" for a finding's sources. */
export function sourcesText(sources: Array<{ kind: string }> | undefined): string {
  return [...new Set((sources ?? []).map((s) => FINDING_SOURCE_LABELS[s.kind as keyof typeof FINDING_SOURCE_LABELS] ?? s.kind))].join(", ");
}

/** Rows for the appendix of findings not in the report: rejected with the reason, and proposed ones on a draft. */
export function appendixRows(sections: Pick<AarSections, "analysis"> & { unassignedFindings?: AarSections["unassignedFindings"] }): AppendixRow[] {
  return appendixFindings(sections).map(({ afi, objectiveText, status }) => ({
    id: afi.id,
    title: afi.title,
    objective: objectiveText,
    status: FINDING_STATUS_LABELS[status],
    sources: sourcesText(afi.sources),
    reason: status === "rejected" ? decisionText(afi.decision) || afi.rejectedReason || "" : "Not decided yet.",
    by: status === "rejected" ? (afi.decision?.byName || afi.review?.byName || "") : "",
    at: status === "rejected" ? (afi.decision?.at || afi.review?.at || null) : null,
  }));
}

/** "No action needed. Already fixed." for an accepted finding with no action item, or "". */
export function followUpText(f: Pick<Afi, "decision">): string {
  return f.decision?.kind === "no_action" ? `No action needed. ${decisionText(f.decision)}`.trim() : "";
}

/** Accepted findings, how many have an action item or a "No action needed" decision, and rejected findings. */
export function findingCounts(sections: AarSections): { accepted: number; actionItems: number; noAction: number; rejected: number } {
  const all = allFindings(sections).map((f) => f.afi);
  const accepted = all.filter((f) => f.status === "accepted");
  return {
    accepted: accepted.length,
    actionItems: accepted.filter((f) => f.actionItemId || f.decision?.kind === "action").length,
    noAction: accepted.filter((f) => !f.actionItemId && f.decision?.kind === "no_action").length,
    rejected: all.filter((f) => f.status === "rejected").length,
  };
}
