// Document TTX schemas. A source document (playbook, BCP/DR plan, crisis
// comms plan, threat briefing, SOP, policy) becomes modules. Each module is an
// inject: scenario update, key issues, discussion questions mapped to
// objectives and to document sections. Participants and scribes post entries;
// evaluators grade entries tied to a question against its rubric.
//
// Template storage (authored from a document):
//   ExerciseTemplate.config -> templateConfigSchema
//   TemplateInject.content  -> moduleContentSchema
//   TemplateInject.secret   -> moduleSecretSchema
//   Rubric rows keyed by question key (never sent to players)

import { z } from "zod";

export const ENTRY_TYPES = ["discussion", "finding", "gap", "action", "note"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Entry types graded against a question rubric when they cite a question. */
export const GRADED_ENTRY_TYPES: readonly EntryType[] = ["discussion", "finding", "action"];

export const QUESTION_CATEGORIES = [
  "preparation",
  "detection",
  "containment",
  "eradication",
  "recovery",
  "communication",
  "decision_making",
  "coordination",
] as const;

export const questionSchema = z.object({
  key: z.string().min(1).max(40),
  text: z.string().trim().min(5).max(1000),
  category: z.enum(QUESTION_CATEGORIES).catch("decision_making"),
  capabilityKeys: z.array(z.string()).max(6).default([]),
  objectiveKeys: z.array(z.string()).max(6).default([]),
  docSectionRefs: z.array(z.string()).max(6).default([]),
});

export const moduleContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  scenarioUpdate: z.string().trim().min(10).max(6000),
  rationale: z.string().trim().max(1500).optional(),
  keyIssues: z.array(z.string().trim().min(1).max(400)).max(8).default([]),
  /** Verbatim span from the source document the module is built on. */
  sourceExcerpt: z.string().max(3000).optional(),
  docSectionRefs: z.array(z.string()).max(8).default([]),
  questions: z.array(questionSchema).min(1).max(8),
});
export type ModuleContent = z.infer<typeof moduleContentSchema>;

/**
 * A module while it is being written. Same shape as moduleContentSchema with
 * the length minimums lifted, so a half-written module saves. Publishing runs
 * validateDocumentTemplate, which asks for the missing text.
 */
export const moduleDraftContentSchema = moduleContentSchema.extend({
  scenarioUpdate: z.string().trim().max(6000),
  questions: z.array(questionSchema.extend({ text: z.string().trim().max(1000) })).max(8),
});

export const moduleSecretSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  expectedActions: z.array(z.string().max(500)).max(10).default([]),
});
export type ModuleSecret = z.infer<typeof moduleSecretSchema>;

export const templateConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sourceDocumentId: z.string().nullable().default(null),
  sourceDocumentSha: z.string().nullable().default(null),
  teams: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  moduleMinutes: z.number().int().min(5).max(120).nullable().default(null),
  /** How modules advance when an exercise is launched from this template. */
  paced: z.enum(["facilitator", "timer"]).default("facilitator"),
  regulatoryClocks: z
    .array(z.object({ key: z.string(), label: z.string(), durationHours: z.number().optional(), businessDays: z.number().optional() }))
    .default([]),
});

export const exerciseConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Only scribes and the control room post entries. Players need no device. */
  scribeMode: z.boolean().default(false),
  /** Timed modules. Null means the facilitator advances. */
  moduleMinutes: z.number().int().min(5).max(120).nullable().default(null),
});
export type ExerciseConfig = z.infer<typeof exerciseConfigSchema>;

export const entryInputSchema = z.object({
  type: z.enum(ENTRY_TYPES),
  text: z.string().trim().min(1).max(4000),
  questionKey: z.string().max(40).nullable().optional(),
  severity: z.enum(["low", "medium", "high"]).nullable().optional(),
  docSectionRef: z.string().max(40).nullable().optional(),
  /** Scribe entries can name the speaker's role, never required. */
  speakerRole: z.string().trim().max(80).nullable().optional(),
});
export type EntryInput = z.infer<typeof entryInputSchema>;

export interface EntryPayload extends EntryInput {
  byRoles: string[];
}

// ---------------------------------------------------------------------------
// Template objectives and rubrics
// ---------------------------------------------------------------------------

export const templateObjectiveSchema = z.object({
  key: z.string().min(1).max(40),
  text: z.string().trim().min(1).max(1000),
  capabilityKeys: z.array(z.string().max(40)).max(12).default([]),
});
export const templateObjectivesSchema = z.array(templateObjectiveSchema).max(20);
export type TemplateObjective = z.infer<typeof templateObjectiveSchema>;

/** A framework control a criterion maps to (src/content/frameworks). */
export const controlRefSchema = z.object({
  framework: z.string().min(1).max(40),
  controlId: z.string().min(1).max(40),
});

export const rubricCriterionSchema = z.object({
  id: z.string().min(1).max(20),
  text: z.string().trim().min(3).max(400),
  controlRefs: z.array(controlRefSchema).max(4).default([]),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

/** Rubric.criteria for a Document TTX question. Never sent to players. */
export const rubricCriteriaSchema = z.array(rubricCriterionSchema).min(1).max(6);

export const RUBRIC_MAX_SCORE = 4;

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

export const GRADE_RATINGS = ["met", "partially_met", "not_met"] as const;
export type GradeRating = (typeof GRADE_RATINGS)[number];

export const GRADE_RATING_LABELS: Record<GradeRating, string> = {
  met: "Met",
  partially_met: "Partially met",
  not_met: "Not met",
};

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  discussion: "Discussion",
  finding: "Finding",
  gap: "Gap",
  action: "Action",
  note: "Note",
};

export const QUESTION_CATEGORY_LABELS: Record<(typeof QUESTION_CATEGORIES)[number], string> = {
  preparation: "Preparation",
  detection: "Detection",
  containment: "Containment",
  eradication: "Eradication",
  recovery: "Recovery",
  communication: "Communication",
  decision_making: "Decision making",
  coordination: "Coordination",
};
