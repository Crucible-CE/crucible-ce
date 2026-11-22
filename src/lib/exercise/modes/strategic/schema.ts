// Strategic TTX schemas. Multi-team crisis exercise with per-team variants.
// Injects come from a template (scripted MSEL, linear or branched). Each
// active team's decision maker (or scribe) submits one answer per inject;
// evaluators grade answers with expected actions as the reference. Grades
// feed capability ratings, never a person score.

import { z } from "zod";
import { cleanTechniqueIds } from "@/lib/exercise/content/mitre";

export const PHASES = ["opening", "main", "resolution"] as const;

export const artifactSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["email", "social_post", "news", "ransom_note", "regulator_letter", "chat", "voicemail", "document", "log_excerpt"]),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  from: z.string().max(200).optional(),
  sentAt: z.string().max(60).optional(),
});

export const teamQuestionSchema = z.object({
  key: z.string().min(1).max(40),
  text: z.string().trim().min(5).max(800),
  framework: z.string().max(60).optional(),
});

export const teamVariantSchema = z.object({
  team: z.string().trim().min(1).max(60),
  status: z.enum(["active", "standby"]).default("active"),
  narrativeMd: z.string().trim().min(1).max(4000),
  questions: z.array(teamQuestionSchema).max(5).default([]),
});

/** Template inject content (public). Team names, not ids. */
export const templateInjectContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  narrativeMd: z.string().trim().min(10).max(8000),
  phase: z.enum(PHASES).default("main"),
  artifacts: z.array(artifactSchema).max(6).default([]),
  teamVariants: z.array(teamVariantSchema).max(10).default([]),
});

export const injectSecretSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** expectedActions[team] = actions a well-prepared team would take. */
  expectedActions: z.record(z.string(), z.array(z.string().max(400)).max(8)).default({}),
  gradingNotes: z.string().max(2000).optional(),
  /** MITRE ATT&CK technique IDs. Unknown IDs are dropped. */
  mitreTags: z.preprocess((v) => cleanTechniqueIds(v), z.array(z.string())),
  capabilityKeys: z.array(z.string()).max(8).default([]),
  /** Regulatory clock changes applied when the inject closes, at its scenario time. */
  clockUpdates: z.array(z.object({ key: z.string().min(1).max(40), action: z.enum(["trigger", "met"]) })).max(6).default([]),
});

/** Exercise inject content (public). Adds team ids resolved at plan time. */
export const injectContentSchema = templateInjectContentSchema.extend({
  teamVariants: z.array(teamVariantSchema.extend({ teamId: z.string().nullable() })).default([]),
  contingency: z.boolean().default(false),
});
export type InjectContent = z.infer<typeof injectContentSchema>;

export const scenarioSchema = z.object({
  title: z.string().max(200).default(""),
  domain: z.string().max(40).default("cyber"),
  crisisType: z.string().max(120).default(""),
  threatActorKey: z.string().max(60).nullable().default(null),
  replayKey: z.string().max(60).nullable().default(null),
  industryKey: z.string().max(60).nullable().default(null),
  orgProfileMd: z.string().max(6000).default(""),
  contextMd: z.string().max(6000).default(""),
  complexity: z.enum(["foundational", "intermediate", "advanced"]).default("intermediate"),
  /** Strategic objectives as plain text, for the prompt. Objective rows stay the record. */
  objectives: z.array(z.string().trim().max(1000)).max(20).default([]),
  /** Outside groups that press on the teams. Empty uses the domain's stakeholder groups. */
  stakeholders: z.array(z.string().trim().max(120)).max(12).default([]),
  /** Business impact axes to weigh. Empty uses the domain's list. */
  impactFocus: z.array(z.string().trim().max(120)).max(12).default([]),
  /** Background organizational pressures, woven in without announcing them. */
  pressures: z.array(z.string().trim().max(200)).max(8).default([]),
});

export const exerciseConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Injects come from the template (scripted MSEL). Older values read as template. */
  source: z.literal("template").catch("template").default("template"),
  scenario: scenarioSchema.default({}),
  /** Minutes per inject when the advance policy is timer. */
  injectMinutes: z.number().int().min(3).max(120).nullable().default(null),
  /** Optional game rule: end early when every active team is effective on two injects in a row. */
  winCondition: z.enum(["none", "dynamic"]).default("none"),
  /** Keep a closed inject up until the facilitator sends the next one, so evaluators can override grades before a branch is taken. */
  holdAfterClose: z.boolean().default(false),
});
export type ExerciseConfig = z.infer<typeof exerciseConfigSchema>;

/** Grade ratings for a team answer. Teams and plans are rated, never people. */
export const ANSWER_RATINGS = ["effective", "partially_effective", "ineffective"] as const;
export type AnswerRating = (typeof ANSWER_RATINGS)[number];
export const ANSWER_RATING_LABELS: Record<AnswerRating, string> = {
  effective: "Effective",
  partially_effective: "Partly effective",
  ineffective: "Not effective",
};

export const answerInputSchema = z.object({
  text: z.string().trim().min(1).max(6000),
  /** Optional per-question answers keyed by question key. */
  byQuestion: z.record(z.string(), z.string().max(3000)).optional(),
});

export interface AnswerPayload {
  text: string;
  byQuestion?: Record<string, string>;
  byParticipantId: string;
  byRoles: string[];
}

const clockPresetSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,40}$/),
    label: z.string().trim().min(1).max(160),
    durationHours: z.number().int().positive().max(24 * 365).optional(),
    businessDays: z.number().int().positive().max(365).optional(),
  })
  .refine((c) => Boolean(c.durationHours) !== Boolean(c.businessDays), { message: "Set hours or business days, not both." });

/**
 * ExerciseTemplate.config for a Strategic TTX template. createExercise reads
 * teams, scenarioAnchor, targetDurationMin and regulatoryClocks, the player
 * brief reads executiveBriefMd, and the rest is mode config.
 */
export const templateConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  source: z.literal("template").catch("template").default("template"),
  scenario: scenarioSchema.default({}),
  winCondition: z.enum(["none", "dynamic"]).default("none"),
  teams: z.array(z.string().trim().min(1).max(60)).min(2).max(10),
  scenarioAnchor: z
    .object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
    .nullable()
    .default(null),
  targetDurationMin: z.number().int().min(15).max(24 * 60),
  regulatoryClocks: z.array(clockPresetSchema).max(10).default([]),
  executiveBriefMd: z.string().trim().max(6000).default(""),
});

export const templateObjectivesSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(80),
      text: z.string().trim().min(1).max(1000),
      capabilityKeys: z.array(z.string()).max(12).default([]),
    }),
  )
  .max(20);
