// Proposed findings from the exercise record: hotwash areas for improvement,
// evaluator observations marked as an area for improvement, participant
// feedback "improvements" answers, and low grades. Each proposal records its
// source and evidence. A source row is proposed once; a proposal whose text
// repeats an existing finding adds its source to that finding instead.
// Names become roles. Nothing here decides a finding. Pure.
//
//   const { sections, added } = proposeFindings(inputs, sections, newId);

import { GRADE_RATING_LABELS } from "@/lib/exercise/modes/document/schema";
import { ANSWER_RATING_LABELS } from "@/lib/exercise/modes/strategic/schema";
import type { AarInputs } from "./inputs";
import { clip, nameReplacerFor } from "./draft";
import { evidenceFromOption, evidenceOptions } from "./evidence";
import { allFindings, normalizeFindingText } from "./findings";
import { aarSectionsSchema, type AarSections, type Afi, type Evidence, type FindingSource } from "./schema";

/** Grades at or below this score (of 4) are proposed as findings. */
export const LOW_GRADE_MAX_SCORE = 1;
/** Ratings always proposed, whatever the score. */
export const LOW_GRADE_RATINGS = ["not_met", "ineffective"] as const;

const GRADE_LABELS: Record<string, string> = { ...GRADE_RATING_LABELS, ...ANSWER_RATING_LABELS };

/** A grade that becomes a proposed finding: not met, not effective, or a score of 1 or less of 4. */
export function isLowGrade(rating: string | null | undefined, score: number | null | undefined): boolean {
  if (rating && (LOW_GRADE_RATINGS as readonly string[]).includes(rating)) return true;
  return typeof score === "number" && Number.isFinite(score) && score <= LOW_GRADE_MAX_SCORE;
}

export function gradeLabel(rating: string | null | undefined): string {
  return rating ? (GRADE_LABELS[rating] ?? rating.replace(/_/g, " ")) : "Low score";
}

interface Proposal {
  source: FindingSource;
  objectiveId: string | null;
  capabilityKey: string | null;
  title: string;
  observation: string;
  evidence: Evidence[];
}

/** One proposal per source row, names replaced by roles. Pure. */
export function proposalsFrom(inputs: AarInputs): Proposal[] {
  const replace = nameReplacerFor(inputs);
  const objectiveIds = new Set(inputs.objectives.map((o) => o.id));
  const capOf = new Map(inputs.objectives.map((o) => [o.id, o.capabilities[0]?.key ?? null]));
  const injectById = new Map(inputs.injects.map((i) => [i.id, i]));
  const chips = new Map(evidenceOptions(inputs).map((o) => [`${o.kind}:${o.sourceId}`, evidenceFromOption(o)]));
  const chip = (kind: string, id: string) => chips.get(`${kind}:${id}`);
  const out: Proposal[] = [];
  const text = (s: string) => replace(s.trim().replace(/\s+/g, " "));

  for (const h of inputs.hotwash) {
    if (h.kind !== "afi" || !h.text.trim()) continue;
    const t = text(h.text);
    const objectiveId = h.objectiveId && objectiveIds.has(h.objectiveId) ? h.objectiveId : null;
    out.push({ source: { kind: "hotwash", sourceId: h.id }, objectiveId, capabilityKey: objectiveId ? (capOf.get(objectiveId) ?? null) : null, title: clip(t, 300), observation: clip(t, 3000), evidence: [] });
  }
  for (const o of inputs.observations) {
    if (o.kind !== "afi" || !o.text.trim()) continue;
    const t = text(o.text);
    const objectiveId = o.objectiveId && objectiveIds.has(o.objectiveId) ? o.objectiveId : null;
    const e = chip("observation", o.id);
    out.push({
      source: { kind: "evaluator", sourceId: o.id },
      objectiveId,
      capabilityKey: o.capabilityKey ?? (objectiveId ? (capOf.get(objectiveId) ?? null) : null),
      title: clip(t, 300),
      observation: clip(t, 3000),
      evidence: e ? [e] : [],
    });
  }
  for (const f of inputs.feedback.improvements) {
    if (!f.text.trim()) continue;
    const t = text(f.text);
    out.push({ source: { kind: "feedback", sourceId: f.id }, objectiveId: null, capabilityKey: null, title: clip(t, 300), observation: clip(t, 3000), evidence: [] });
  }
  for (const r of inputs.responses) {
    if (r.ratingSource !== "human" || !isLowGrade(r.rating, r.ratingScore)) continue;
    const inj = injectById.get(r.injectId);
    const objectives = (inj?.objectiveIds ?? []).filter((id) => objectiveIds.has(id));
    const objectiveId = objectives.length === 1 ? objectives[0] : null;
    const who = [r.team, r.role].filter(Boolean).join(", ");
    const title = `${inj ? `Inject ${inj.seq}. ${inj.title}` : "A response"}: graded ${gradeLabel(r.rating).toLowerCase()}`;
    const rationale = r.ratingRationale?.trim() ? `Evaluator rationale: ${text(r.ratingRationale)}` : "";
    const answer = r.text.trim() ? `${who ? `${who} wrote` : "The response was"}: ${text(r.text)}` : "";
    const e = chip(r.sourceKind, r.sourceId);
    out.push({
      source: { kind: "grade", sourceId: r.sourceId },
      objectiveId,
      capabilityKey: objectiveId ? (capOf.get(objectiveId) ?? null) : null,
      title: clip(text(title), 300),
      observation: clip([rationale, answer].filter(Boolean).join("\n\n"), 3000),
      evidence: e ? [e] : [],
    });
  }
  return out;
}

const keyOf = (s: FindingSource) => (s.sourceId ? `${s.kind}:${s.sourceId}` : null);

/**
 * Add proposals the report does not have yet. A source row already on any
 * finding is skipped. Text that matches a finding (same normalized title or
 * observation) adds the source and evidence to that finding.
 */
export function proposeFindings(
  inputs: AarInputs,
  current: AarSections,
  newId: () => string,
): { sections: AarSections; added: string[]; linked: string[] } {
  const sections = structuredClone(current);
  const added: string[] = [];
  const linked: string[] = [];
  const known = new Set(allFindings(sections).flatMap((f) => f.afi.sources.map(keyOf).filter((k): k is string => Boolean(k))));
  const objectiveIndex = new Map(sections.analysis.map((a, i) => [a.objectiveId, i]));

  for (const p of proposalsFrom(inputs)) {
    const key = keyOf(p.source);
    if (!key || known.has(key)) continue;
    known.add(key);
    const norm = normalizeFindingText(p.title);
    const normObs = normalizeFindingText(p.observation);
    const same = allFindings(sections).find((f) => {
      const t = normalizeFindingText(f.afi.title);
      const o = normalizeFindingText(f.afi.observation);
      return (norm && (t === norm || o === norm)) || (normObs && o === normObs);
    });
    if (same) {
      const f = same.afi;
      if (f.sources.length < 20) f.sources.push(p.source);
      for (const e of p.evidence) if (!f.evidence.some((x) => x.kind === e.kind && x.sourceId === e.sourceId) && f.evidence.length < 10) f.evidence.push(e);
      linked.push(f.id);
      continue;
    }
    const afi: Afi = {
      id: newId(),
      title: p.title,
      observation: p.observation,
      analysis: "",
      recommendation: "",
      capabilityKey: p.capabilityKey ? p.capabilityKey.slice(0, 60) : null,
      references: [],
      evidence: p.evidence.slice(0, 10),
      actionItemId: null,
      rejectedReason: null,
      status: "proposed",
      decision: null,
      review: null,
      sources: [p.source],
      mergedFrom: [],
    };
    const i = p.objectiveId ? objectiveIndex.get(p.objectiveId) : undefined;
    if (i !== undefined && sections.analysis[i].afis.length < 40) sections.analysis[i].afis.push(afi);
    else if (sections.unassignedFindings.length < 100) sections.unassignedFindings.push(afi);
    else continue;
    added.push(afi.id);
  }
  return { sections: aarSectionsSchema.parse(sections), added, linked };
}
