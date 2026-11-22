// Contingency injects for Strategic TTX. The controller sends an extra inject
// to some or all teams between scripted injects (a fog of war event, a
// regulator call). It never breaks the main sequence:
//   - it publishes only when no inject is open or held (else 409);
//   - it carries content.contingency = true, so planInject does not count it
//     against the inject budget and template branching skips over it;
//   - publishing mirrors advanceExercise: claim the next seq with a pending
//     row (unique on exerciseId+seq), then one transaction that moves the row
//     pending -> open and sets Exercise.currentInjectId with a CAS on the
//     value read before. A concurrent advance or contingency loses the CAS
//     and its pending row is deleted.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyChanged, type Actor } from "@/lib/exercise/runtime/engine";
import { loadSnapshot } from "@/lib/exercise/runtime/snapshot";
import { transitionInject } from "@/lib/exercise/runtime/transition";
import { scheduleInjectTimer } from "@/lib/exercise/runtime/timers";
import { ServiceError } from "@/lib/exercise/errors";
import { artifactSchema, exerciseConfigSchema, injectContentSchema, type InjectContent } from "@/lib/exercise/modes/strategic/schema";

const id = z.string().trim().min(1).max(64);

export const contingencyInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the inject a title.").max(200),
    narrativeMd: z.string().trim().min(10, "Write what happens.").max(8000),
    artifacts: z
      .array(artifactSchema.omit({ id: true }).extend({ id: z.string().max(40).optional() }))
      .max(4)
      .default([]),
    targetTeamIds: z.array(id).min(1, "Pick at least one team.").max(10),
    /** Questions every targeted team answers. None makes it awareness only. */
    questions: z.array(z.string().trim().min(5, "Each question needs a few words.").max(800)).max(3).default([]),
  })
  .strict();
export type ContingencyInput = z.infer<typeof contingencyInputSchema>;

export const CONTINGENCY_BUSY = "Close or release the current inject first.";

class RaceAbort extends Error {}

/** Content for a contingency inject. Pure. */
export function contingencyContent(input: ContingencyInput, teams: Array<{ id: string; name: string }>): InjectContent {
  const byId = new Map(teams.map((t) => [t.id, t.name]));
  const questions = input.questions.map((text, i) => ({ key: `q${i + 1}`, text }));
  const active = questions.length > 0;
  return injectContentSchema.parse({
    schemaVersion: 1,
    narrativeMd: input.narrativeMd,
    phase: "main",
    artifacts: input.artifacts.map((a, i) => ({ ...a, id: `c${i + 1}` })),
    teamVariants: [...new Set(input.targetTeamIds)].map((teamId) => ({
      team: byId.get(teamId) ?? "Team",
      teamId,
      status: active ? "active" : "standby",
      narrativeMd: active ? "Answer as a team." : "For your awareness. No answer is needed.",
      questions,
    })),
    contingency: true,
  });
}

/** Publish a contingency inject. Drivers only (the route checks). */
export async function publishContingency(exerciseId: string, input: ContingencyInput, actor: Actor): Promise<{ injectId: string }> {
  const { snapshot } = await loadSnapshot(db, exerciseId);
  const ex = snapshot.exercise;
  if (ex.mode !== "strategic") throw new ServiceError(400, "Contingency injects are for Strategic TTX.");
  if (ex.status !== "live") throw new ServiceError(409, "The exercise is not live. Resume or start it first.");
  if (snapshot.injects.some((i) => i.status === "open" || i.status === "held")) throw new ServiceError(409, CONTINGENCY_BUSY);
  // An advance that is still generating would lose its work to this publish.
  const preparing = await db.inject.count({ where: { exerciseId, status: "pending", createdAt: { gt: new Date(Date.now() - 5 * 60_000) } } });
  if (preparing > 0) throw new ServiceError(409, "The next inject is being prepared. Wait for it, then try again.");
  const teamIds = new Set(snapshot.teams.map((t) => t.id));
  if (!input.targetTeamIds.every((t) => teamIds.has(t))) throw new ServiceError(400, "A selected team is not part of this exercise.");

  const content = contingencyContent(input, snapshot.teams);
  const targetTeamIds = content.teamVariants.map((v) => v.teamId).filter((x): x is string => Boolean(x));
  const config = exerciseConfigSchema.safeParse(ex.config ?? {});
  const budgetMs = ex.advancePolicy === "timer" && config.success && config.data.injectMinutes ? config.data.injectMinutes * 60_000 : null;
  const lastTimed = [...snapshot.injects].reverse().find((i) => i.scenarioTime);
  const scenarioTime = lastTimed?.scenarioTime ?? ex.scenarioStartAt ?? null;

  // Claim the next seq. A concurrent advance holding the same seq wins this one.
  const last = await db.inject.findFirst({ where: { exerciseId }, orderBy: { seq: "desc" }, select: { seq: true } });
  const seq = (last?.seq ?? 0) + 1;
  let pendingId: string;
  try {
    const row = await db.inject.create({
      data: { exerciseId, seq, status: "pending", source: "contingency", title: input.title },
      select: { id: true },
    });
    pendingId = row.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ServiceError(409, CONTINGENCY_BUSY);
    throw e;
  }

  const now = new Date();
  const closesAt = budgetMs ? new Date(now.getTime() + budgetMs) : null;
  const version = await db
    .$transaction(
      async (tx) => {
        await tx.inject.update({
          where: { id: pendingId },
          data: {
            title: input.title,
            source: "contingency",
            scenarioTime,
            targetTeamIds,
            content: content as unknown as Prisma.InputJsonValue,
            secret: { schemaVersion: 1, expectedActions: {} } as Prisma.InputJsonValue,
            budgetMs,
          },
        });
        const busy = await tx.inject.count({ where: { exerciseId, id: { not: pendingId }, status: { in: ["open", "held"] } } });
        if (busy > 0) throw new RaceAbort();
        const moved = await transitionInject(tx, pendingId, "pending", "open", { openedAt: now, closesAt });
        if (!moved) throw new RaceAbort();
        const res = await tx.exercise.updateMany({
          where: { id: exerciseId, status: "live", currentInjectId: ex.currentInjectId },
          data: { currentInjectId: pendingId, stateVersion: { increment: 1 } },
        });
        if (res.count !== 1) throw new RaceAbort();
        await tx.exerciseEvent.create({
          data: {
            exerciseId,
            type: "inject_released",
            injectId: pendingId,
            actorUserId: actor.userId ?? null,
            actorParticipantId: actor.participantId ?? null,
            data: { seq, title: input.title, source: "contingency", scenarioTime: scenarioTime?.toISOString() ?? null, teams: targetTeamIds.length },
          },
        });
        const row = await tx.exercise.findUniqueOrThrow({ where: { id: exerciseId }, select: { stateVersion: true } });
        return row.stateVersion;
      },
      { timeout: 20_000, maxWait: 10_000 },
    )
    .catch(async (e) => {
      if (e instanceof RaceAbort || (e as { code?: string }).code === "P2025") {
        await db.inject.deleteMany({ where: { id: pendingId, status: "pending" } }).catch(() => undefined);
        throw new ServiceError(409, CONTINGENCY_BUSY);
      }
      await db.inject.deleteMany({ where: { id: pendingId, status: "pending" } }).catch(() => undefined);
      throw e;
    });

  if (closesAt) scheduleInjectTimer(exerciseId, pendingId, closesAt);
  notifyChanged(exerciseId, version);
  return { injectId: pendingId };
}
