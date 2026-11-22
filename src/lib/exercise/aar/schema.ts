// After-action report content, HSEEP structure. Stored in
// AfterActionReport.sections and signed (canonical JSON) at finalize.
//
// Every section records its origin (system or human) in AfterActionReport.editLog.
// The record sections fill from the exercise; people write the narrative.
// No person scores: ratings are per objective and capability (P/S/M/U).

import { z } from "zod";

export const RATINGS = ["P", "S", "M", "U"] as const;
export type Rating = (typeof RATINGS)[number];

export const RATING_LABELS: Record<Rating, string> = {
  P: "Performed without challenges",
  S: "Performed with some challenges",
  M: "Performed with major challenges",
  U: "Unable to be performed",
};

/**
 * Stored CapabilityRating.rating for "Not evaluated": the evaluator records
 * that the objective was not exercised or not observed, with a reason. It is
 * not a P/S/M/U rating and never means the task failed.
 */
export const NOT_EVALUATED = "N" as const;
export const NOT_EVALUATED_LABEL = "Not evaluated";

/** Approval text every signer agrees to. Part of the signed content. */
export const APPROVAL_STATEMENT = "I reviewed this report and approve it and its improvement plan as the record of this exercise.";

/** The plain statement every CE report prints in place of an AI disclosure. */
export const NO_AI_STATEMENT = "No AI was used to write this report.";

export const referenceSchema = z.object({
  type: z.enum(["doc_section", "control", "inject"]),
  ref: z.string().max(120),
  label: z.string().max(300).optional(),
});

export const evidenceSchema = z.object({
  kind: z.enum(["entry", "answer", "vote", "observation", "event"]),
  /** Row id (Response, Observation, ExerciseEvent). */
  sourceId: z.string().max(60),
  quote: z.string().max(1200).optional(),
  at: z.string().max(40).optional(),
  speakerRole: z.string().max(120).optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const strengthSchema = z.object({
  id: z.string().max(40),
  text: z.string().max(2000),
  evidence: z.array(evidenceSchema).max(10).default([]),
});

// ---------------------------------------------------------------------------
// Findings review
// ---------------------------------------------------------------------------

/**
 * Every area for improvement starts as proposed. A facilitator accepts it
 * (it appears in the report) or rejects it with a reason (it stays out of the
 * report and goes in the appendix). An accepted finding then gets an action
 * item or a "No action needed" reason. Only "Create action item" creates work.
 */
export const FINDING_STATUSES = ["proposed", "accepted", "rejected"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = { proposed: "Proposed", accepted: "Accepted", rejected: "Rejected" };

/** Where a proposed finding came from. */
export const FINDING_SOURCE_KINDS = ["hotwash", "evaluator", "feedback", "grade", "written"] as const;
export type FindingSourceKind = (typeof FINDING_SOURCE_KINDS)[number];
export const FINDING_SOURCE_LABELS: Record<FindingSourceKind, string> = {
  hotwash: "Hotwash",
  evaluator: "Evaluator",
  feedback: "Feedback",
  grade: "Grade",
  written: "Written",
};

export const REJECT_PRESETS = [
  { key: "artificiality", label: "Exercise artificiality" },
  { key: "no_evidence", label: "Not supported by evidence" },
  { key: "duplicate", label: "Duplicate" },
  { key: "out_of_scope", label: "Out of scope" },
  { key: "other", label: "Other" },
] as const;
export const NO_ACTION_PRESETS = [
  { key: "already_fixed", label: "Already fixed" },
  { key: "accepted_risk", label: "Accepted risk" },
  { key: "tracked_elsewhere", label: "Tracked elsewhere" },
  { key: "out_of_scope", label: "Out of scope" },
  { key: "other", label: "Other" },
] as const;

export const findingSourceSchema = z.object({
  kind: z.enum(FINDING_SOURCE_KINDS),
  /** HotwashItem, Observation, Feedback or Response id. Null for a finding written in the report. */
  sourceId: z.string().max(60).nullable().default(null),
});
export type FindingSource = z.infer<typeof findingSourceSchema>;

export const findingDecisionSchema = z.object({
  kind: z.enum(["action", "no_action", "rejected"]),
  preset: z.string().max(40).nullable().default(null),
  /** Free text. Required for "Other". */
  reason: z.string().max(1000).default(""),
  /** Where it is tracked, for "Tracked elsewhere". */
  reference: z.string().max(300).default(""),
  byUserId: z.string().max(40).nullable().default(null),
  byName: z.string().max(120).default(""),
  at: z.string().max(40).default(""),
});
export type FindingDecision = z.infer<typeof findingDecisionSchema>;

/** Who accepted or rejected the finding, and when. */
export const findingReviewSchema = z.object({
  byUserId: z.string().max(40).nullable().default(null),
  byName: z.string().max(120).default(""),
  at: z.string().max(40).default(""),
});

/**
 * AFIs stored before the findings review have no status. One resolved by
 * resolveAfi maps to accepted with an action (actionItemId) or to rejected
 * (rejectedReason). Any other is proposed. Pure.
 */
export function upgradeLegacyAfi(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const r = v as Record<string, unknown>;
  if (r.status !== undefined) return v;
  const rejected = typeof r.rejectedReason === "string" && r.rejectedReason.trim() ? r.rejectedReason.trim() : null;
  const action = typeof r.actionItemId === "string" && r.actionItemId ? r.actionItemId : null;
  return {
    ...r,
    status: rejected ? "rejected" : action ? "accepted" : "proposed",
    decision: rejected ? { kind: "rejected", preset: null, reason: rejected.slice(0, 1000) } : action ? { kind: "action" } : null,
    sources: Array.isArray(r.sources) ? r.sources : [{ kind: "written", sourceId: null }],
  };
}

const afiObjectSchema = z.object({
  id: z.string().max(40),
  /** Short statement of the area for improvement. */
  title: z.string().max(300),
  observation: z.string().max(3000),
  analysis: z.string().max(3000),
  recommendation: z.string().max(2000),
  capabilityKey: z.string().max(60).nullable().default(null),
  references: z.array(referenceSchema).max(10).default([]),
  evidence: z.array(evidenceSchema).max(10).default([]),
  /** Set when the finding has an improvement plan row. */
  actionItemId: z.string().max(40).nullable().default(null),
  /** The rejection reason as text, kept for readers of older reports. */
  rejectedReason: z.string().max(1000).nullable().default(null),
  status: z.enum(FINDING_STATUSES).default("proposed"),
  decision: findingDecisionSchema.nullable().default(null),
  review: findingReviewSchema.nullable().default(null),
  sources: z.array(findingSourceSchema).max(20).default([]),
  /** Ids of findings merged into this one. */
  mergedFrom: z.array(z.string().max(40)).max(20).default([]),
});

export const afiSchema = z.preprocess(upgradeLegacyAfi, afiObjectSchema);
export type Afi = z.infer<typeof afiObjectSchema>;

export const objectiveAnalysisSchema = z.object({
  objectiveId: z.string().max(40),
  objectiveText: z.string().max(1000),
  capabilityKeys: z.array(z.string().max(60)).max(8).default([]),
  rating: z.enum(RATINGS).nullable().default(null),
  ratingSource: z.enum(["evaluator"]).nullable().default(null),
  ratingRationale: z.string().max(2000).default(""),
  /** The evaluator recorded "Not evaluated" (rating stays null; the reason is ratingRationale). */
  notEvaluated: z.boolean().default(false),
  strengths: z.array(strengthSchema).max(12).default([]),
  afis: z.array(afiSchema).max(40).default([]),
});
export type ObjectiveAnalysis = z.infer<typeof objectiveAnalysisSchema>;

export const decisionSchema = z.object({
  injectId: z.string().max(40),
  seq: z.number().int(),
  scenarioTime: z.string().max(40).nullable(),
  team: z.string().max(80).nullable(),
  /** Role that owns the decision (never a person's name in AAR text). */
  owner: z.string().max(120).nullable(),
  question: z.string().max(1500).nullable(),
  decision: z.string().max(1500).nullable(),
  /** Recommendation split, for example {"a": 3, "b": 1}. */
  split: z.record(z.string(), z.number()).default({}),
  kind: z.enum(["decision", "materiality", "answer", "entry"]).default("decision"),
});

export const clockOutcomeSchema = z.object({
  key: z.string().max(40),
  label: z.string().max(200),
  status: z.enum(["pending", "running", "met", "missed", "not_applicable"]),
  triggeredAt: z.string().max(40).nullable(),
  deadlineAt: z.string().max(40).nullable(),
  metAt: z.string().max(40).nullable(),
  /** Plain sentence, for example "Filed within 4 business days of the materiality determination." */
  statement: z.string().max(600),
});

/** Framework label on control mapping rows that are ATT&CK techniques exercised. */
export const ATTACK_FRAMEWORK = "MITRE ATT&CK";

/** Result column text for a control mapping row. */
export function controlResultLabel(c: { framework: string; status: "tested" | "gap" }): string {
  if (c.status === "gap") return "Gap found";
  return c.framework === ATTACK_FRAMEWORK ? "Technique exercised" : "Tested";
}

export const controlMappingSchema = z.object({
  framework: z.string().max(40),
  controlId: z.string().max(60),
  title: z.string().max(300),
  /** tested: exercised with no AFI. gap: an AFI maps to it. */
  status: z.enum(["tested", "gap"]),
  afiIds: z.array(z.string().max(40)).max(20).default([]),
});

export const rosterEntrySchema = z.object({
  participantId: z.string().max(40),
  name: z.string().max(120),
  title: z.string().max(200).nullable(),
  organization: z.string().max(200).nullable(),
  team: z.string().max(80).nullable(),
  roles: z.array(z.string().max(40)).max(6),
  guest: z.boolean(),
  joinedAt: z.string().max(40).nullable(),
  leftAt: z.string().max(40).nullable(),
  /** Facilitator-confirmed: attended | partial | absent, or null when not confirmed. */
  attendance: z.enum(["attended", "partial", "absent"]).nullable().default(null),
  /** Took part without a device (added after ENDEX). */
  noDevice: z.boolean().default(false),
});

export const planExercisedSchema = z.object({
  title: z.string().max(300),
  version: z.string().max(60).default(""),
  date: z.string().max(40).default(""),
  owner: z.string().max(200).default(""),
  sha256: z.string().max(64).nullable().default(null),
});

export const requirementSchema = z.object({
  framework: z.string().max(40),
  controlId: z.string().max(60),
  title: z.string().max(300).default(""),
});

export const aarSectionsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  overview: z.object({
    name: z.string().max(300),
    mode: z.string().max(40),
    startedAt: z.string().max(40).nullable(),
    endedAt: z.string().max(40).nullable(),
    durationMin: z.number().nullable(),
    timezone: z.string().max(80),
    scope: z.string().max(3000).default(""),
    missionAreas: z.array(z.string().max(80)).max(6).default([]),
    hazard: z.string().max(1000).default(""),
    scenarioSummary: z.string().max(6000).default(""),
    sponsor: z.string().max(200).default(""),
    participatingOrganizations: z.array(z.string().max(200)).max(30).default([]),
    pointsOfContact: z.array(z.string().max(300)).max(10).default([]),
    sourceDocument: z.object({ title: z.string(), kind: z.string(), sha256: z.string() }).nullable().default(null),
    /** Plans, policies and procedures this exercise tested. */
    plansExercised: z.array(planExercisedSchema).max(20).default([]),
    /** Framework requirements this exercise is meant to satisfy. */
    requirements: z.array(requirementSchema).max(50).default([]),
  }),
  executiveSummary: z.string().max(6000).default(""),
  analysis: z.array(objectiveAnalysisSchema).max(20).default([]),
  decisionLog: z.array(decisionSchema).max(300).default([]),
  clocks: z.array(clockOutcomeSchema).max(20).default([]),
  controlMapping: z.array(controlMappingSchema).max(200).default([]),
  methodology: z.object({
    text: z.string().max(3000),
  }),
  roster: z.array(rosterEntrySchema).max(500).default([]),
  requiredRoles: z.array(z.object({ role: z.string().max(80), present: z.boolean() })).max(20).default([]),
  parkingLot: z.array(z.string().max(1000)).max(50).default([]),
  /** Findings with no objective yet (feedback, hotwash items with no objective). Accepting one places it under an objective. */
  unassignedFindings: z.array(afiSchema).max(100).default([]),
});
export type AarSections = z.infer<typeof aarSectionsSchema>;

/** Section keys for the edit log and per-section origin badges. */
export const AAR_SECTION_KEYS = [
  "overview",
  "executiveSummary",
  "analysis",
  "decisionLog",
  "clocks",
  "controlMapping",
  "methodology",
  "roster",
  "requiredRoles",
  "parkingLot",
  "unassignedFindings",
] as const;
export type AarSectionKey = (typeof AAR_SECTION_KEYS)[number];

export const editLogEntrySchema = z.object({
  section: z.enum(AAR_SECTION_KEYS),
  /** Dotted path inside the section when the edit is narrower, for example analysis.2.afis.1. */
  path: z.string().max(120).optional(),
  origin: z.enum(["human", "system"]),
  byUserId: z.string().max(40).nullable(),
  at: z.string().max(40),
  note: z.string().max(300).optional(),
});
export type EditLogEntry = z.infer<typeof editLogEntrySchema>;
