// POST /api/exercises: create a draft exercise from a template (or, for
// Document TTX, from a source document).
//
//   - teams from template.config.teams
//   - objectives from template.objectives [{key, text, capabilityKeys[]}];
//     capabilityIds resolved from the Capability table by key (the instance's
//     framework first). Objective.injectIds stay empty until injects publish
//     (src/exercises/objectives.ts links them).
//   - regulatory clocks from template.config.regulatoryClocks
//   - config = mode.configSchema.parse(template config + overrides); falls
//     back to the overrides alone when the template's config does not fit
//   - advancePolicy defaults to mode.defaultAdvancePolicy and must be in mode.caps.advance
//   - the creator joins as lead_facilitator
//   - scenarioStartAt defaults to the next date matching template.config.scenarioAnchor
//     {weekday, time} in Instance.timezone; timeboxMin defaults to
//     template.config.targetDurationMin + 15

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { generateJoinCode } from "@/lib/exercise/auth/guest";
import { findMode } from "@/lib/exercise/modes/registry";
import { getExerciseSettings } from "@/lib/exercise/settings";
import type { AdvancePolicy } from "@/lib/exercise/runtime/types";
import { canReadTemplateSecrets } from "./access";
import { ServiceError } from "./errors";
import { ensureCapabilities } from "./seed-capabilities";
import { planSchema, type CreateExerciseInput } from "./schemas";
import { nextAnchorDate } from "./time";

const templateTeamsSchema = z.object({ teams: z.array(z.string().trim().min(1).max(60)).max(10).default([]) }).passthrough();
const templateClocksSchema = z
  .object({
    regulatoryClocks: z
      .array(
        z.object({
          key: z.string().min(1).max(40),
          label: z.string().min(1).max(160),
          durationHours: z.number().positive().optional().nullable(),
          businessDays: z.number().int().positive().optional().nullable(),
        }),
      )
      .max(10)
      .default([]),
  })
  .passthrough();
const templateTimingSchema = z
  .object({
    /** Scenario start: the next date on this weekday at this wall time (Instance.timezone). */
    scenarioAnchor: z
      .object({ weekday: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
      .nullable()
      .optional(),
    targetDurationMin: z.number().int().positive().max(24 * 60).optional(),
  })
  .passthrough();
const templateObjectivesSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(80),
      text: z.string().trim().min(1).max(1000),
      capabilityKeys: z.array(z.string()).max(12).default([]),
    }),
  )
  .max(20);

function safe<T>(schema: z.ZodType<T, unknown>, raw: unknown, fallback: T): T {
  const r = schema.safeParse(raw);
  return r.success ? r.data : fallback;
}

/** Resolve capability keys to Capability ids, preferring the instance framework. */
export async function resolveCapabilityIds(keys: string[], framework: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const rows = await db.capability.findMany({ where: { key: { in: keys }, isActive: true }, select: { id: true, key: true, framework: true } });
  for (const key of keys) {
    const own = rows.find((r) => r.key === key && r.framework === framework);
    const any = rows.find((r) => r.key === key);
    const hit = own ?? any;
    if (hit) out.set(key, hit.id);
  }
  return out;
}

/** A join code nobody else uses. */
export async function freshJoinCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = generateJoinCode();
    const taken = await db.exercise.findUnique({ where: { joinCode: code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new ServiceError(500, "Could not make a join code.");
}

export async function createExercise(input: CreateExerciseInput, user: SessionUser): Promise<{ id: string }> {
  const mode = findMode(input.mode);
  if (!mode) throw new ServiceError(400, "This exercise type is not available yet.");

  let template: { id: string; mode: string; status: string; config: unknown; objectives: unknown } | null = null;
  if (input.templateId) {
    template = await db.exerciseTemplate.findUnique({
      where: { id: input.templateId },
      select: { id: true, mode: true, status: true, config: true, objectives: true },
    });
    if (!template) throw new ServiceError(404, "Template not found.");
    if (template.mode !== input.mode) throw new ServiceError(400, "That template is for a different exercise type.");
    if (template.status !== "published") throw new ServiceError(409, "Publish the template before you use it.");
    // The creator becomes lead facilitator and reads every inject: a player in a run of this template may not.
    if (!(await canReadTemplateSecrets(user.id, template.id))) {
      throw new ServiceError(403, "You are playing in an exercise that uses this template.");
    }
  } else if (input.mode === "document") {
    if (!input.sourceDocumentId) throw new ServiceError(400, "Pick a template or a document.");
  } else {
    throw new ServiceError(400, "Pick a template.");
  }
  if (input.sourceDocumentId) {
    const doc = await db.sourceDocument.findUnique({ where: { id: input.sourceDocumentId }, select: { id: true } });
    if (!doc) throw new ServiceError(404, "Document not found.");
  }

  // Config: template values the mode understands, then the caller's overrides.
  const overrides: Record<string, unknown> = { ...(input.config ?? {}) };
  const templateConfig = template?.config && typeof template.config === "object" ? (template.config as Record<string, unknown>) : {};
  const merged = mode.configSchema.safeParse({ ...templateConfig, ...overrides });
  const config = merged.success ? merged.data : mode.configSchema.parse(overrides);

  // A Document TTX template brings its source document and pacing when the
  // caller leaves them out (the generic new exercise page and Studio Launch).
  let sourceDocumentId = input.sourceDocumentId ?? null;
  let templatePolicy: AdvancePolicy | null = null;
  if (template && input.mode === "document") {
    const c = templateConfig as { sourceDocumentId?: unknown; paced?: unknown; moduleMinutes?: unknown };
    if (!sourceDocumentId && typeof c.sourceDocumentId === "string") {
      const linked = await db.sourceDocument.findUnique({ where: { id: c.sourceDocumentId }, select: { id: true } });
      sourceDocumentId = linked?.id ?? null;
    }
    if (c.paced === "timer" && typeof c.moduleMinutes === "number" && c.moduleMinutes > 0) templatePolicy = "timer";
  }

  const advancePolicy: AdvancePolicy = input.advancePolicy ?? templatePolicy ?? mode.defaultAdvancePolicy;
  if (!mode.caps.advance.includes(advancePolicy)) {
    throw new ServiceError(400, "That advance policy is not used by this exercise type.");
  }

  const teamNames = mode.caps.teams ? [...new Set(safe(templateTeamsSchema, templateConfig, { teams: [] }).teams)] : [];
  const clocks = safe(templateClocksSchema, templateConfig, { regulatoryClocks: [] }).regulatoryClocks;
  const objectives = safe(templateObjectivesSchema, template?.objectives ?? [], []);

  await ensureCapabilities();
  const instance = await getExerciseSettings();
  const timing = safe(templateTimingSchema, templateConfig, {});
  const scenarioStartAt = input.scenarioStartAt
    ? new Date(input.scenarioStartAt)
    : timing.scenarioAnchor
      ? nextAnchorDate(new Date(), timing.scenarioAnchor, instance?.timezone ?? "UTC")
      : null;
  // The template run time plus a quarter hour for the brief and wrap up.
  const timeboxMin = input.timeboxMin ?? (timing.targetDurationMin ? Math.min(24 * 60, timing.targetDurationMin + 15) : null);
  const capIds = await resolveCapabilityIds(
    [...new Set(objectives.flatMap((o) => o.capabilityKeys))],
    instance?.capabilityFramework ?? "nist-csf",
  );

  const joinCode = await freshJoinCode();
  const userRow = await db.user.findUnique({ where: { id: user.id }, select: { name: true, jobTitle: true, email: true } });
  const displayName = (userRow?.name || user.name || userRow?.email || "Facilitator").slice(0, 40);

  const id = await db.$transaction(async (tx) => {
    const ex = await tx.exercise.create({
      data: {
        mode: input.mode,
        title: input.title,
        status: "draft",
        config: config as Prisma.InputJsonValue,
        templateId: template?.id ?? null,
        sourceDocumentId,
        scenarioStartAt,
        timeboxMin,
        injectBudget: input.injectBudget ?? null,
        advancePolicy,
        isPractice: input.isPractice ?? false,
        guestJoin: input.guestJoin ?? false,
        joinCode,
        createdById: user.id,
      },
      select: { id: true },
    });

    await Promise.all(
      teamNames.map((name, i) => tx.team.create({ data: { exerciseId: ex.id, name, seq: i + 1 } })),
    );

    const objectiveKeys: Record<string, string> = {};
    for (const [i, o] of objectives.entries()) {
      const row = await tx.objective.create({
        data: {
          exerciseId: ex.id,
          seq: i + 1,
          text: o.text,
          capabilityIds: o.capabilityKeys.map((k) => capIds.get(k)).filter((x): x is string => Boolean(x)),
          injectIds: [],
        },
        select: { id: true },
      });
      objectiveKeys[row.id] = o.key;
    }

    if (clocks.length > 0) {
      await tx.regulatoryClock.createMany({
        data: clocks.map((c) => ({
          exerciseId: ex.id,
          key: c.key,
          label: c.label,
          durationHours: c.durationHours ? Math.round(c.durationHours) : null,
          businessDays: c.businessDays ?? null,
        })),
      });
    }

    const plan = planSchema.parse({ ...(input.plan ?? {}), objectiveKeys });
    await tx.exercise.update({ where: { id: ex.id }, data: { plan: plan as Prisma.InputJsonValue } });

    await tx.participant.create({
      data: {
        exerciseId: ex.id,
        userId: user.id,
        displayName,
        title: userRow?.jobTitle ?? null,
        roles: ["lead_facilitator"],
        joinedAt: new Date(),
      },
    });
    await tx.exerciseEvent.create({
      data: { exerciseId: ex.id, type: "created", actorUserId: user.id, data: { templateId: template?.id ?? null } },
    });
    return ex.id;
  });

  return { id };
}
