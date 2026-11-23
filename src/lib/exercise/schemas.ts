// Request bodies and stored JSON shapes for the exercise lifecycle routes.

import { z } from "zod";
import { EXERCISE_ROLES, MODES } from "@/lib/exercise/runtime/types";

export const ADVANCE_POLICIES = ["facilitator", "all_teams", "votes_in", "timer"] as const;

const id = z.string().trim().min(1).max(64);
const isoDate = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Exercise.plan
// ---------------------------------------------------------------------------

export const DEFAULT_NO_FAULT_STATEMENT =
  "This is a no-fault exercise. We look at plans, processes and capabilities, not at individual performance.";

export const PLAN_MISSION_AREAS = ["Prevention", "Protection", "Mitigation", "Response", "Recovery"] as const;

/** A plan, policy or procedure this exercise tests. */
export const planDocSchema = z.object({
  title: z.string().trim().min(1, "Name every plan.").max(300),
  version: z.string().trim().max(60).default(""),
  /** YYYY-MM-DD or free text as written on the plan. */
  date: z.string().trim().max(40).default(""),
  owner: z.string().trim().max(200).default(""),
  sha256: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "Use a 64 character SHA-256.")
    .nullable()
    .optional(),
});

/** A framework requirement (control) this exercise is meant to satisfy. */
export const planRequirementSchema = z.object({
  framework: z.string().trim().min(1).max(40),
  controlId: z.string().trim().min(1).max(60),
});

/** Editable exercise plan fields (HSEEP plan metadata and lobby settings). */
export const planFieldsSchema = z.object({
  missionAreas: z.array(z.enum(PLAN_MISSION_AREAS)).max(5),
  requirements: z.array(planRequirementSchema).max(50),
  plansExercised: z.array(planDocSchema).max(20),
  /** An account that may sign as sponsor in person (besides drivers and admins). */
  sponsorUserId: z.string().trim().max(64).nullable(),
  sponsor: z.string().trim().max(200),
  scope: z.string().trim().max(2000),
  hazard: z.string().trim().max(1000),
  groundRules: z.string().trim().max(4000),
  /** Assumptions and artificialities. */
  assumptions: z.string().trim().max(4000),
  stopWord: z.string().trim().max(60),
  noFaultStatement: z.string().trim().max(2000),
  /** Guests pick their own team at join. Off: they are placed on the smallest team. */
  guestTeamChoice: z.boolean(),
  /** Real-world start for invites and the calendar file. Not the scenario time. */
  startsAt: isoDate.nullable(),
});
export type PlanFields = z.infer<typeof planFieldsSchema>;

/**
 * Stored Exercise.plan. objectiveKeys maps Objective.id to the template
 * objective key. objectiveTemplateInjects maps Objective.id to the template
 * inject ids the facilitator linked in the lobby; when an objective has an
 * entry there, it replaces the links that come from objectiveKeys.
 */
export const planSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  sponsor: planFieldsSchema.shape.sponsor.default(""),
  scope: planFieldsSchema.shape.scope.default(""),
  hazard: planFieldsSchema.shape.hazard.default(""),
  groundRules: planFieldsSchema.shape.groundRules.default(""),
  assumptions: planFieldsSchema.shape.assumptions.default(""),
  stopWord: planFieldsSchema.shape.stopWord.default(""),
  noFaultStatement: planFieldsSchema.shape.noFaultStatement.default(DEFAULT_NO_FAULT_STATEMENT),
  guestTeamChoice: planFieldsSchema.shape.guestTeamChoice.default(true),
  startsAt: planFieldsSchema.shape.startsAt.default(null),
  missionAreas: planFieldsSchema.shape.missionAreas.default([]),
  requirements: planFieldsSchema.shape.requirements.default([]),
  plansExercised: planFieldsSchema.shape.plansExercised.default([]),
  sponsorUserId: planFieldsSchema.shape.sponsorUserId.default(null),
  objectiveKeys: z.record(z.string(), z.string()).default({}),
  objectiveTemplateInjects: z.record(z.string(), z.array(z.string())).default({}),
});
export type ExercisePlan = z.infer<typeof planSchema>;

/** Template inject ids linked to one objective: the lobby links, else the template keys. */
export function templateInjectsForObjective(
  plan: ExercisePlan,
  objectiveId: string,
  templateInjects: Array<{ id: string; objectiveKeys: string[] }>,
): string[] {
  const explicit = plan.objectiveTemplateInjects[objectiveId];
  if (explicit) return explicit;
  const key = plan.objectiveKeys[objectiveId];
  return key ? templateInjects.filter((t) => t.objectiveKeys.includes(key)).map((t) => t.id) : [];
}

/** Read a stored plan, tolerating old or broken JSON. */
export function readPlan(raw: unknown): ExercisePlan {
  const r = planSchema.safeParse(raw ?? {});
  return r.success ? r.data : planSchema.parse({});
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createExerciseSchema = z
  .object({
    mode: z.enum(MODES),
    title: z.string().trim().min(1, "Enter a title.").max(200),
    templateId: id.optional(),
    sourceDocumentId: id.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    timeboxMin: z.number().int().min(5).max(24 * 60).optional(),
    injectBudget: z.number().int().min(1).max(200).optional(),
    scenarioStartAt: isoDate.optional(),
    advancePolicy: z.enum(ADVANCE_POLICIES).optional(),
    guestJoin: z.boolean().optional(),
    isPractice: z.boolean().optional(),
    plan: planFieldsSchema.partial().optional(),
  })
  .strict();
export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;

// ---------------------------------------------------------------------------
// Lobby edits (PATCH /api/exercises/{id})
// ---------------------------------------------------------------------------

export const teamInputSchema = z.object({ id: id.optional(), name: z.string().trim().min(1, "Name every team.").max(60) });
export const objectiveInputSchema = z.object({
  id: id.optional(),
  text: z.string().trim().min(1, "Write every objective.").max(1000),
  capabilityIds: z.array(id).max(12).default([]),
  /** Template inject ids this objective is tested by. Omit to keep the current links. */
  templateInjectIds: z.array(id).max(100).optional(),
});
export const clockInputSchema = z
  .object({
    id: id.optional(),
    key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
    label: z.string().trim().min(1).max(160),
    durationHours: z.number().int().positive().max(24 * 365).nullable().optional(),
    businessDays: z.number().int().positive().max(365).nullable().optional(),
  })
  .refine((c) => Boolean(c.durationHours) !== Boolean(c.businessDays), { message: "Set hours or business days, not both." });

export const updateExerciseSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(200).optional(),
    plan: planFieldsSchema.partial().optional(),
    timeboxMin: z.number().int().min(5).max(24 * 60).nullable().optional(),
    injectBudget: z.number().int().min(1).max(200).nullable().optional(),
    scenarioStartAt: isoDate.nullable().optional(),
    advancePolicy: z.enum(ADVANCE_POLICIES).optional(),
    guestJoin: z.boolean().optional(),
    isPractice: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    teams: z.array(teamInputSchema).max(10).optional(),
    objectives: z.array(objectiveInputSchema).max(20).optional(),
    clocks: z.array(clockInputSchema).max(10).optional(),
  })
  .strict();
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

export const CONTROL_ACTIONS = [
  "start",
  "open_lobby",
  "close_lobby",
  "advance",
  "release",
  "discard",
  "close",
  "pause",
  "resume",
  "extend",
  "endex",
  "abandon",
  "broadcast",
  "config",
  "clock",
] as const;

/** Exercise config keys a driver may change while the exercise runs. */
export const LIVE_CONFIG_KEYS = [
  "holdAfterClose",
  "revealAfterClose",
  "revealSplit",
  "revealBest",
  "scribeMode",
] as const;

export const CLOCK_ACTIONS = ["trigger", "met", "reset"] as const;

export const controlSchema = z
  .object({
    action: z.enum(CONTROL_ACTIONS),
    injectId: id.optional(),
    edits: z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        content: z.unknown().optional(),
        targetTeamIds: z.array(id).max(10).optional(),
      })
      .optional(),
    addMinutes: z.number().int().min(1).max(120).optional(),
    message: z.string().trim().min(1, "Write a message.").max(1000).optional(),
    teamId: id.nullable().optional(),
    config: z.partialRecord(z.enum(LIVE_CONFIG_KEYS), z.boolean()).optional(),
    clock: z
      .object({
        key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/),
        action: z.enum(CLOCK_ACTIONS),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ControlInput = z.infer<typeof controlSchema>;

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

const rolesSchema = z.array(z.enum(EXERCISE_ROLES)).min(1, "Pick at least one role.").max(EXERCISE_ROLES.length);

export const addParticipantSchema = z
  .object({
    userId: id,
    roles: rolesSchema,
    teamId: id.nullable().optional(),
    isDecisionMaker: z.boolean().optional(),
  })
  .strict();

export const updateParticipantSchema = z
  .object({
    participantId: id,
    roles: rolesSchema.optional(),
    teamId: id.nullable().optional(),
    isDecisionMaker: z.boolean().optional(),
    title: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export const removeParticipantSchema = z.object({ participantId: id }).strict();

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

export const joinSchema = z
  .object({
    code: z.string().trim().min(4).max(32),
    displayName: z.string().max(200).optional(),
    title: z.string().trim().max(120).optional(),
    teamId: id.nullable().optional(),
  })
  .strict();

export const respondSchema = z
  .object({
    injectId: id,
    kind: z.enum(["vote", "answer", "entry", "deliverable"]),
    data: z.unknown(),
  })
  .strict();

export const CHAT_CHANNELS = ["all", "team", "control"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const chatPostSchema = z
  .object({
    body: z.string().trim().min(1, "Write a message.").max(2000),
    channel: z.enum(CHAT_CHANNELS).default("all"),
    teamId: id.nullable().optional(),
  })
  .strict();

export const OBSERVATION_KINDS = ["observation", "strength", "afi"] as const;

export const observationSchema = z
  .object({
    text: z.string().trim().min(1, "Write the observation.").max(4000),
    kind: z.enum(OBSERVATION_KINDS).default("observation"),
    injectId: id.nullable().optional(),
    objectiveId: id.nullable().optional(),
    capabilityId: id.nullable().optional(),
  })
  .strict();

export const observationUpdateSchema = z
  .object({
    id,
    text: observationSchema.shape.text.optional(),
    kind: z.enum(OBSERVATION_KINDS).optional(),
    injectId: id.nullable().optional(),
    objectiveId: id.nullable().optional(),
    capabilityId: id.nullable().optional(),
  })
  .strict();

export const observationDeleteSchema = z.object({ id }).strict();

export const injectNotesSchema = z
  .object({
    controllerNotes: z.string().max(4000).nullable(),
  })
  .strict();

/** Responses per participant per minute (POST /api/play/{id}/respond). */
export const RESPOND_LIMIT = 30;
export const respondLimit = (participantId: string) => ({
  namespace: "respond:participant",
  identifier: participantId,
  windowMs: 60_000,
  max: RESPOND_LIMIT,
});
