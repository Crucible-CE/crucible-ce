// Crisis Sim content and config schemas.
//
// Template storage:
//   ExerciseTemplate.config  -> templateConfigSchema
//   TemplateInject.content   -> templateInjectContentSchema   (public)
//   TemplateInject.secret    -> templateInjectSecretSchema    (hidden scoring)
// Exercise storage:
//   Exercise.config          -> exerciseConfigSchema
//   Inject.content           -> injectContentSchema           (public, per path chosen at plan time)
//   Inject.secret            -> injectSecretSchema
//   ScoreState.cumulative    -> Float. Each team's average vote quality
//                              (abstains count 0) counts once per inject; the
//                              inject delta is the sum of team averages,
//                              rounded to one decimal (round1).
//   TemplateInject.expectedActions -> expectedActionsSchema

import { z } from "zod";
import { cleanTechniqueIds } from "@/lib/exercise/content/mitre";

export const PATH_KEYS = ["optimal", "degrading", "critical"] as const;
export type PathKey = (typeof PATH_KEYS)[number];

export const QUALITY_LEVELS = ["great", "good", "neutral", "bad"] as const;
export type Quality = (typeof QUALITY_LEVELS)[number];

/** Locked: +2 / +1 / 0 / -2. */
export const QUALITY_SCORES: Record<Quality, number> = { great: 2, good: 1, neutral: 0, bad: -2 };

export const DEFAULT_THRESHOLDS = { optimal: 4, degrading: -3 } as const;

export const PATH_LABELS: Record<PathKey, string> = {
  optimal: "On track",
  degrading: "Under strain",
  critical: "Escalating",
};

/** No-fault labels for facilitator screens that may be projected. */
export const QUALITY_DISPLAY: Record<Quality, string> = {
  great: "Intended",
  good: "Defensible",
  neutral: "Neutral",
  bad: "Off plan",
};

/** Round to one decimal, avoiding float drift (0.1 + 0.2). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export const thresholdsSchema = z.object({ optimal: z.number().int(), degrading: z.number().int() });
export type Thresholds = z.infer<typeof thresholdsSchema>;

export const artifactSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(["email", "social_post", "news", "ransom_note", "regulator_letter", "chat", "voicemail", "document", "log_excerpt"]),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(8000),
  from: z.string().max(200).optional(),
  sentAt: z.string().max(60).optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const clockEffectSchema = z.object({
  key: z.string().min(1).max(40),
  action: z.enum(["trigger", "met"]),
});

/**
 * Regulatory clocks an option may start: the SEC materiality determination
 * and ransom payment reports. Every other clock starts when an inject opens
 * (clockTriggers); options otherwise only meet clocks.
 */
export const OPTION_TRIGGER_CLOCKS: readonly string[] = ["sec_8k", "nydfs_ransom_24h", "cisa_ransom_24h"];

const variantSchema = z.object({
  narrativeMd: z.string().trim().min(20).max(8000),
  consequenceText: z.string().trim().max(2000).optional(),
  artifacts: z.array(artifactSchema).max(6).default([]),
});

/** Materiality and ransom questions always appear in the debrief's key decisions. */
export const QUESTION_TYPES = ["standard", "materiality", "ransom"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const DELIVERABLE_KINDS = ["holding_statement", "board_update", "regulator_notice", "customer_notice", "other"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];
export const DELIVERABLE_LABELS: Record<DeliverableKind, string> = {
  holding_statement: "Holding statement",
  board_update: "Board update",
  regulator_notice: "Regulator notice",
  customer_notice: "Customer notice",
  other: "Written response",
};
export const ARTIFACT_KIND_LABELS: Record<Artifact["kind"], string> = {
  email: "Email",
  social_post: "Social post",
  news: "News",
  ransom_note: "Ransom note",
  regulator_letter: "Regulator letter",
  chat: "Chat",
  voicemail: "Voicemail",
  document: "Document",
  log_excerpt: "Log excerpt",
};

const optionPublicSchema = z.object({
  id: z.string().min(1).max(4),
  text: z.string().trim().min(1).max(400),
});

const questionPublicSchema = z.object({
  team: z.string().trim().min(1).max(60),
  stem: z.string().trim().min(10).max(1500),
  options: z.array(optionPublicSchema).min(3).max(4),
  decisionOwner: z.string().trim().max(120).optional(),
  discussionPrompt: z.string().trim().max(800).optional(),
  type: z.enum(QUESTION_TYPES).default("standard"),
  capabilityKeys: z.array(z.string()).max(8).default([]),
});
export type QuestionPublic = z.infer<typeof questionPublicSchema>;

const deliverableSchema = z.object({
  team: z.string().trim().min(1).max(60),
  kind: z.enum(DELIVERABLE_KINDS),
  prompt: z.string().trim().min(10).max(1500),
});

export const templateInjectContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  variants: z.object({ optimal: variantSchema, degrading: variantSchema, critical: variantSchema }),
  questions: z.array(questionPublicSchema).min(1).max(20),
  deliverable: deliverableSchema.optional(),
});
export type TemplateInjectContent = z.infer<typeof templateInjectContentSchema>;

/** "HH:MM", 24 hour. */
const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");

/** Weekday (0 Sunday to 6 Saturday) and time of day at scenario minute 0. */
export const scenarioAnchorSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  time: timeOfDaySchema,
});
export type ScenarioAnchor = z.infer<typeof scenarioAnchorSchema>;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Weekday and time for a scenario minute offset from the anchor, for example "Tuesday 13:00". */
export function anchoredTime(anchor: ScenarioAnchor, offsetMin: number): { weekday: string; time: string; label: string } {
  const [h, m] = anchor.time.split(":").map(Number);
  const total = anchor.weekday * 1440 + h * 60 + m + Math.max(0, Math.round(offsetMin));
  const day = Math.floor(total / 1440) % 7;
  const mins = total % 1440;
  const time = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return { weekday: WEEKDAYS[day], time, label: `${WEEKDAYS[day]} ${time}` };
}

/** TemplateInject.expectedActions: 2 to 4 observable actions per team. */
export const expectedActionsSchema = z
  .array(
    z.object({
      team: z.string().trim().min(1).max(60),
      actions: z.array(z.string().trim().min(1).max(300)).max(6),
    }),
  )
  .max(10)
  .default([]);
export type ExpectedActions = z.infer<typeof expectedActionsSchema>;

const qualityByPathSchema = z.object({
  optimal: z.enum(QUALITY_LEVELS),
  degrading: z.enum(QUALITY_LEVELS),
  critical: z.enum(QUALITY_LEVELS),
});

/** MITRE ATT&CK technique IDs an inject exercises. Hidden from players. Unknown IDs are dropped. */
export const attackTagsSchema = z.preprocess((v) => cleanTechniqueIds(v), z.array(z.string()));

export const templateInjectSecretSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** quality[team][optionId] = per-path rating */
  quality: z.record(z.string(), z.record(z.string(), qualityByPathSchema)),
  /** Shown at the start of the next inject when a team's majority picked this option. */
  followUps: z.record(z.string(), z.record(z.string(), z.string().max(600))).default({}),
  /** Regulatory clock effects when a team's majority picked this option. */
  clockEffects: z.record(z.string(), z.record(z.string(), z.array(clockEffectSchema))).default({}),
  /** Rubric criteria for the written deliverable, if any. */
  deliverableCriteria: z.array(z.string().max(300)).max(8).default([]),
  /** rationales[team][optionId]: one line on why the option is rated as it is. Shown only in the debrief. */
  rationales: z.record(z.string(), z.record(z.string(), z.string().max(400))).default({}),
  /** Clock keys that start when this inject opens, on every path. */
  clockTriggers: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Clock keys that start when this inject opens on one path only. */
  clockTriggersByPath: z
    .object({
      optimal: z.array(z.string().min(1).max(40)).max(10).optional(),
      degrading: z.array(z.string().min(1).max(40)).max(10).optional(),
      critical: z.array(z.string().min(1).max(40)).max(10).optional(),
    })
    .default({}),
  attackTechniques: attackTagsSchema,
});
export type TemplateInjectSecret = z.infer<typeof templateInjectSecretSchema>;

export const templateConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  teams: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
  pathThresholds: thresholdsSchema.default(DEFAULT_THRESHOLDS),
  targetDurationMin: z.number().int().min(10).max(240).default(60),
  executiveBriefMd: z.string().max(6000).optional(),
  capabilityKeys: z.array(z.string()).max(12).default([]),
  regulatoryClocks: z
    .array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(120),
        durationHours: z.number().int().positive().optional(),
        businessDays: z.number().int().positive().optional(),
      }),
    )
    .max(10)
    .default([]),
  /** Library picks the scenario is written against. Reference only; players never see them. */
  threatActorKey: z.string().max(60).optional(),
  replayKey: z.string().max(60).optional(),
  industryKey: z.string().max(60).optional(),
  /** Fictional organization the scenario is written for. */
  orgName: z.string().max(120).optional(),
  /** Practice templates launch practice runs (no AAR, no improvement plan items). */
  practice: z.boolean().optional(),
  /** Weekday and time at scenario minute 0. Exercise.scenarioStartAt defaults from it. */
  scenarioAnchor: scenarioAnchorSchema.optional(),
  /** Exercise default for hold after close. Practice templates set false. */
  holdAfterClose: z.boolean().optional(),
});
export type TemplateConfig = z.infer<typeof templateConfigSchema>;

/** ExerciseTemplate.objectives. */
export const templateObjectiveSchema = z.object({
  key: z.string().trim().min(1).max(40),
  text: z.string().trim().min(3).max(500),
  capabilityKeys: z.array(z.string().max(60)).max(8).default([]),
});
export const templateObjectivesSchema = z.array(templateObjectiveSchema).max(12);
export type TemplateObjective = z.infer<typeof templateObjectiveSchema>;

const exerciseConfigObject = z.object({
  schemaVersion: z.literal(1).default(1),
  pathThresholds: thresholdsSchema.default(DEFAULT_THRESHOLDS),
  targetDurationMin: z.number().int().min(10).max(240).default(60),
  /** Keep the closed inject on screen until the facilitator releases the next. Practice templates set false. */
  holdAfterClose: z.boolean().default(true),
  /** After close, show players their own team's vote split and decision. */
  revealSplit: z.boolean().default(true),
  /** After close, also show players the intended best option. Otherwise it waits for the debrief. */
  revealBest: z.boolean().default(false),
  /** Include per-person metrics in reports. Off by default (no-fault). */
  individualMetrics: z.boolean().default(false),
  initialPath: z.enum(PATH_KEYS).default("optimal"),
});

/** Older configs used revealAfterClose; it is read as revealSplit. */
export const exerciseConfigSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  if (r.revealSplit === undefined && typeof r.revealAfterClose === "boolean") return { ...r, revealSplit: r.revealAfterClose };
  return r;
}, exerciseConfigObject);
export type ExerciseConfig = z.infer<typeof exerciseConfigSchema>;

export const injectContentSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  path: z.enum(PATH_KEYS),
  narrativeMd: z.string(),
  consequenceText: z.string().optional(),
  followUps: z.array(z.object({ team: z.string(), text: z.string() })).default([]),
  artifacts: z.array(artifactSchema).default([]),
  questions: z.array(
    questionPublicSchema.extend({ teamId: z.string().nullable() }),
  ),
  deliverable: deliverableSchema.extend({ teamId: z.string().nullable() }).optional(),
});
export type InjectContent = z.infer<typeof injectContentSchema>;

export const injectSecretSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  quality: templateInjectSecretSchema.shape.quality,
  followUps: templateInjectSecretSchema.shape.followUps,
  clockEffects: templateInjectSecretSchema.shape.clockEffects,
  deliverableCriteria: z.array(z.string()).default([]),
  rationales: templateInjectSecretSchema.shape.rationales,
  /** Clocks that start when this inject opens, resolved for the path it was played on. */
  clockTriggers: z.array(z.string()).default([]),
  attackTechniques: attackTagsSchema,
});
export type InjectSecret = z.infer<typeof injectSecretSchema>;

export const voteInputSchema = z.object({
  optionId: z.string().min(1).max(4),
  comment: z.string().trim().max(500).optional(),
});

export const deliverableInputSchema = z.object({
  text: z.string().trim().min(1).max(6000),
});

export interface VotePayload {
  optionId: string | null;
  /** Set at close: the voter was the team's decision maker. */
  decider?: boolean;
  comment?: string;
  abstain?: boolean;
  pathAtVote: PathKey;
  quality?: Quality;
  delta?: number;
}

export function pathFor(score: number, t: Thresholds): PathKey {
  if (score >= t.optimal) return "optimal";
  // Critical is strictly below the degrading threshold.
  if (score < t.degrading) return "critical";
  return "degrading";
}
