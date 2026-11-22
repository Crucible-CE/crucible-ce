// Deterministic AAR sections, built from the exercise record without AI:
// overview, decision log, clocks, roster, required roles, methodology, the
// analysis skeleton (objectives with evaluator ratings), parking lot and the
// control mapping derived from AFI references. Pure.
//
//   const sections = buildDeterministicSections(inputs);

import { formatInZone } from "@/lib/exercise/time";
import { getControl } from "@/lib/exercise/content/frameworks";
import type { AarClock, AarInputs } from "./inputs";
import { effectiveRatings } from "./inputs";
import { makeNameReplacer } from "./names";
import { aarSectionsSchema, ATTACK_FRAMEWORK, NOT_EVALUATED, type AarSections, type ObjectiveAnalysis } from "./schema";

export function clip(s: string | null | undefined, max: number): string {
  const v = (s ?? "").trim();
  return v.length > max ? `${v.slice(0, max - 3).trimEnd()}...` : v;
}

function clipOrNull(s: string | null | undefined, max: number): string | null {
  const v = clip(s, max);
  return v ? v : null;
}

/** Names to roles for every text the report writes about people. */
export function nameReplacerFor(inputs: Pick<AarInputs, "roster">): (text: string) => string {
  return makeNameReplacer(
    inputs.roster.map((p) => ({ participantId: p.participantId, name: p.name, aliases: p.aliases, title: p.title, team: p.team, roles: p.roles })),
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function buildOverview(inputs: AarInputs): AarSections["overview"] {
  const e = inputs.exercise;
  const orgs = [...new Set(inputs.roster.filter((p) => !p.removed).map((p) => p.organization?.trim()).filter((o): o is string => Boolean(o)))];
  const pocs = inputs.roster
    .filter((p) => !p.removed && p.roles.includes("lead_facilitator"))
    .map((p) => clip([p.name, p.title, p.organization].filter(Boolean).join(", "), 300))
    .slice(0, 10);
  return {
    name: clip(e.title, 300),
    mode: clip(e.modeLabel, 40),
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    durationMin: e.durationMin,
    timezone: clip(e.timezone, 80),
    scope: clip(e.scope, 3000),
    missionAreas: e.missionAreas.slice(0, 6).map((m) => clip(m, 80)),
    hazard: clip(e.hazard, 1000),
    scenarioSummary: clip(e.scenarioSummary, 6000),
    sponsor: clip(e.sponsor, 200),
    participatingOrganizations: orgs.map((o) => clip(o, 200)).slice(0, 30),
    pointsOfContact: pocs,
    sourceDocument: inputs.sourceDocument
      ? { title: inputs.sourceDocument.title, kind: inputs.sourceDocument.kind, sha256: inputs.sourceDocument.sha256 }
      : null,
    plansExercised: e.plansExercised.slice(0, 20).map((d) => ({
      title: clip(d.title, 300),
      version: clip(d.version, 60),
      date: clip(d.date, 40),
      owner: clip(d.owner, 200),
      sha256: d.sha256 && /^[a-f0-9]{64}$/i.test(d.sha256) ? d.sha256.toLowerCase() : null,
    })),
    requirements: e.requirements.slice(0, 50).map((r) => ({ framework: clip(r.framework, 40), controlId: clip(r.controlId, 60), title: clip(r.title, 300) })),
  };
}

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** One plain sentence per clock outcome. Times are scenario times in the instance zone. */
export function clockStatement(c: Pick<AarClock, "status" | "deadlineAt" | "metAt" | "triggeredAt">, timezone: string): string {
  const t = (iso: string | null) => (iso ? formatInZone(new Date(iso), timezone) : null);
  const due = t(c.deadlineAt);
  const met = t(c.metAt);
  switch (c.status) {
    case "met":
      return due ? `Met on time at ${met ?? "an unrecorded time"}. The deadline was ${due}.` : `Met at ${met ?? "an unrecorded time"}.`;
    case "missed":
      if (met) return `Missed. Met at ${met}, after the ${due ?? "set"} deadline.`;
      return `Missed. Not met by the ${due ?? "set"} deadline.`;
    case "running":
      return due ? `Open at ENDEX. Due ${due}.` : "Open at ENDEX with no deadline set.";
    case "not_applicable":
      return "Not applicable to this exercise.";
    default:
      return "Not started.";
  }
}

export function buildClocks(inputs: AarInputs): AarSections["clocks"] {
  return inputs.clocks.slice(0, 20).map((c) => ({
    key: clip(c.key, 40),
    label: clip(c.label, 200),
    status: c.status,
    triggeredAt: c.triggeredAt,
    deadlineAt: c.deadlineAt,
    metAt: c.metAt,
    statement: clip(clockStatement(c, inputs.exercise.timezone), 600),
  }));
}

// ---------------------------------------------------------------------------
// Decision log
// ---------------------------------------------------------------------------

export const DECISION_LOG_MAX = 300;

export function buildDecisionLog(inputs: AarInputs, replaceNames = nameReplacerFor(inputs)): AarSections["decisionLog"] {
  const rows = [...inputs.decisions].sort((a, b) => a.seq - b.seq || a.at.localeCompare(b.at));
  return rows.slice(0, DECISION_LOG_MAX).map((d) => {
    const decision = d.decision ? replaceNames(d.decision) : null;
    const graded = d.rating ? ` (${d.rating.replace(/_/g, " ")})` : "";
    const split: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.split)) split[k] = v;
    return {
      injectId: clip(d.injectId, 40),
      seq: d.seq,
      scenarioTime: d.scenarioTime,
      team: clipOrNull(d.team, 80),
      owner: clipOrNull(d.owner ? replaceNames(d.owner) : null, 120),
      question: clipOrNull(d.question, 1500),
      decision: clipOrNull(decision ? `${decision}${graded}` : null, 1500),
      split,
      kind: d.kind,
    };
  });
}

// ---------------------------------------------------------------------------
// Roster and required roles
// ---------------------------------------------------------------------------

export function buildRoster(inputs: AarInputs): AarSections["roster"] {
  return inputs.roster.slice(0, 500).map((p) => ({
    participantId: clip(p.participantId, 40),
    name: clip(p.name, 120),
    title: clipOrNull(p.title, 200),
    organization: clipOrNull(p.organization, 200),
    team: clipOrNull(p.team, 80),
    roles: p.roles.slice(0, 6).map((r) => clip(r, 40)),
    guest: p.guest,
    joinedAt: p.joinedAt,
    leftAt: p.leftAt,
    attendance: p.attendance,
    noDevice: p.noDevice,
  }));
}

export function buildRequiredRoles(inputs: AarInputs): AarSections["requiredRoles"] {
  return inputs.requiredRoles.slice(0, 20).map((r) => ({ role: clip(r.role, 80), present: r.present }));
}

// ---------------------------------------------------------------------------
// Methodology
// ---------------------------------------------------------------------------

export function methodologyText(inputs: Pick<AarInputs, "exercise" | "sourceDocument">): string {
  const lines = [
    `This report covers a ${inputs.exercise.modeLabel} exercise and follows the HSEEP after-action report structure.`,
    "Objectives are rated on the HSEEP scale: Performed without challenges (P), Performed with some challenges (S), Performed with major challenges (M), and Unable to be performed (U).",
    "U means the team attempted the task and could not perform it. An objective the exercise did not exercise or observe is marked Not evaluated.",
    "Every rating in a signed report is an evaluator rating.",
    "The overview, decision log, clocks, roster, required roles and control mapping come from the exercise record. Evaluators and facilitators wrote the executive summary, strengths and areas for improvement.",
    "Findings address plans, processes and capabilities, not individuals.",
  ];
  if (inputs.sourceDocument) lines.push(`The exercise was built from the document "${inputs.sourceDocument.title}". The document hash is recorded in the overview.`);
  return lines.join(" ");
}

export function buildMethodology(inputs: AarInputs): AarSections["methodology"] {
  return { text: clip(methodologyText(inputs), 3000) };
}

// ---------------------------------------------------------------------------
// Analysis skeleton and ratings
// ---------------------------------------------------------------------------

export function buildAnalysisSkeleton(inputs: AarInputs): ObjectiveAnalysis[] {
  return applyRatings(
    inputs.objectives.slice(0, 20).map((o) => ({
      objectiveId: clip(o.id, 40),
      objectiveText: clip(o.text, 1000),
      capabilityKeys: [...new Set(o.capabilities.map((c) => clip(c.key, 60)))].slice(0, 8),
      rating: null,
      ratingSource: null,
      ratingRationale: "",
      notEvaluated: false,
      strengths: [],
      afis: [],
    })),
    inputs,
  );
}

/** Put evaluator ratings on the analysis. Every rating is an evaluator's. */
export function applyRatings(analysis: ObjectiveAnalysis[], inputs: Pick<AarInputs, "ratings">): ObjectiveAnalysis[] {
  const eff = effectiveRatings(inputs.ratings);
  return analysis.map((a) => {
    const r = eff.get(a.objectiveId);
    if (r?.source === "evaluator") {
      if (r.rating === NOT_EVALUATED) {
        return { ...a, rating: null, ratingSource: "evaluator", notEvaluated: true, ratingRationale: clip(r.rationale ?? "", 2000) };
      }
      return { ...a, rating: r.rating, ratingSource: "evaluator", notEvaluated: false, ratingRationale: clip(r.rationale ?? a.ratingRationale, 2000) };
    }
    if (a.ratingSource === "evaluator") {
      // The evaluator rating was removed; keep the text but drop the rating.
      return { ...a, rating: null, ratingSource: null, notEvaluated: false };
    }
    if (a.rating) return { ...a, rating: null, ratingSource: null };
    return a;
  });
}

/** Objectives a signed report cannot carry yet: no evaluator rating and no "Not evaluated" with a reason. Pure. */
export function objectivesWithoutEvaluatorRating(analysis: ObjectiveAnalysis[]): ObjectiveAnalysis[] {
  return analysis.filter((a) => {
    if (a.ratingSource !== "evaluator") return true;
    if (a.notEvaluated) return !a.ratingRationale.trim();
    return !a.rating;
  });
}

// ---------------------------------------------------------------------------
// Parking lot and control mapping
// ---------------------------------------------------------------------------

export function buildParkingLot(inputs: AarInputs, replaceNames = nameReplacerFor(inputs)): string[] {
  return inputs.hotwash
    .filter((h) => h.kind === "parking_lot")
    .map((h) => clip(replaceNames(h.text), 1000))
    .filter(Boolean)
    .slice(0, 50);
}

/** "nist-csf:RS.MA-01" or a bare control id with a framework label. */
export function parseControlRef(ref: string, frameworks: string[]): { framework: string; controlId: string; title: string } | null {
  const m = /^([a-z0-9-]+):(.+)$/i.exec(ref.trim());
  const candidates = m ? [{ fw: m[1].toLowerCase(), id: m[2].trim() }] : frameworks.map((fw) => ({ fw, id: ref.trim() }));
  for (const c of candidates) {
    if (!frameworks.includes(c.fw)) continue;
    const control = getControl(c.fw, c.id);
    if (control) return { framework: c.fw, controlId: control.controlId, title: control.title };
  }
  return null;
}

/** Gap per control an AFI references; tested for controls exercised with no AFI. Enabled frameworks only. Then the ATT&CK techniques exercised. */
export function buildControlMapping(
  analysis: ObjectiveAnalysis[],
  inputs: Pick<AarInputs, "frameworks" | "testedControls"> & Partial<Pick<AarInputs, "techniquesExercised">>,
): AarSections["controlMapping"] {
  const rows = new Map<string, AarSections["controlMapping"][number]>();
  // Requirements the plan names count even when their framework is not enabled.
  const frameworks = [...new Set([...inputs.frameworks, ...inputs.testedControls.map((t) => t.framework)])];
  for (const o of analysis) {
    for (const afi of o.afis) {
      if (afi.rejectedReason) continue;
      for (const ref of afi.references) {
        if (ref.type !== "control") continue;
        const c = parseControlRef(ref.ref, frameworks);
        if (!c) continue;
        const key = `${c.framework}:${c.controlId}`;
        const row = rows.get(key) ?? { framework: c.framework, controlId: clip(c.controlId, 60), title: clip(c.title, 300), status: "gap" as const, afiIds: [] };
        if (!row.afiIds.includes(afi.id) && row.afiIds.length < 20) row.afiIds.push(afi.id);
        rows.set(key, row);
      }
    }
  }
  for (const t of inputs.testedControls) {
    const key = `${t.framework}:${t.controlId}`;
    if (!rows.has(key)) rows.set(key, { framework: t.framework, controlId: clip(t.controlId, 60), title: clip(t.title, 300), status: "tested", afiIds: [] });
  }
  const controls = [...rows.values()].sort((a, b) => a.framework.localeCompare(b.framework) || a.controlId.localeCompare(b.controlId));
  // Techniques exercised follow the controls, in delivery order.
  const techniques = (inputs.techniquesExercised ?? []).map((t) => ({
    framework: ATTACK_FRAMEWORK,
    controlId: clip(t.id, 60),
    title: clip(t.name, 300),
    status: "tested" as const,
    afiIds: [],
  }));
  return [...controls, ...techniques].slice(0, 200);
}

// ---------------------------------------------------------------------------
// All deterministic sections
// ---------------------------------------------------------------------------

/** The first draft: every record-based section, an empty summary and the analysis skeleton for evaluators to write. */
export function buildDeterministicSections(inputs: AarInputs): AarSections {
  const replaceNames = nameReplacerFor(inputs);
  const analysis = buildAnalysisSkeleton(inputs);
  return aarSectionsSchema.parse({
    schemaVersion: 1,
    overview: buildOverview(inputs),
    executiveSummary: "",
    analysis,
    decisionLog: buildDecisionLog(inputs, replaceNames),
    clocks: buildClocks(inputs),
    controlMapping: buildControlMapping(analysis, inputs),
    methodology: buildMethodology(inputs),
    roster: buildRoster(inputs),
    requiredRoles: buildRequiredRoles(inputs),
    parkingLot: buildParkingLot(inputs, replaceNames),
  });
}

/** Sections built from the record (origin "system" in the edit log). */
export const SYSTEM_SECTIONS = ["overview", "decisionLog", "clocks", "controlMapping", "methodology", "roster", "requiredRoles", "parkingLot"] as const;
