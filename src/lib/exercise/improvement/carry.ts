// Carry an open AFI to the next exercise: store it as a suggested objective in
// ExerciseSettings.policy.suggestedObjectives. Exercise planners pick from that list.

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { lockExerciseSettings } from "@/lib/exercise/settings";
import { readPolicy, type SuggestedObjective } from "@/lib/exercise/program/policy";
import { listAfis, parseSections } from "./afis";

const MAX_SUGGESTED = 200;

export async function carryAfiToNextExercise(aarId: string, afiId: string): Promise<SuggestedObjective> {
  return db.$transaction(async (tx) => {
    const aar = await tx.afterActionReport.findUnique({ where: { id: aarId }, select: { id: true, exerciseId: true, sections: true } });
    if (!aar) throw new ServiceError(404, "Report not found.");
    const sections = parseSections(aar.sections);
    const afi = sections ? listAfis(sections).find((f) => f.id === afiId) : undefined;
    if (!afi) throw new ServiceError(404, "That area for improvement is not in this report.");
    const inst = await lockExerciseSettings(tx);
    if (!inst) throw new ServiceError(409, "Setup has not run.");
    const policy = readPolicy(inst.policy);
    const existing = policy.suggestedObjectives.find((s) => s.afiId === afiId && s.sourceAarId === aarId);
    if (existing) return existing;
    if (policy.suggestedObjectives.length >= MAX_SUGGESTED) throw new ServiceError(409, "The suggestion list is full. Remove some first.");
    const text = (afi.recommendation.trim() || afi.title.trim()).slice(0, 1000);
    const item: SuggestedObjective = {
      id: randomUUID().slice(0, 12),
      text,
      capabilityKey: afi.capabilityKey,
      sourceExerciseId: aar.exerciseId,
      sourceAarId: aarId,
      afiId,
      createdAt: new Date().toISOString(),
    };
    const raw = (inst.policy && typeof inst.policy === "object" && !Array.isArray(inst.policy) ? inst.policy : {}) as Record<string, unknown>;
    await tx.exerciseSettings.update({
      where: { organizationId: inst.organizationId },
      data: { policy: { ...raw, suggestedObjectives: [...policy.suggestedObjectives, item] } as Prisma.InputJsonValue },
    });
    return item;
  });
}

export async function removeSuggestedObjective(id: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const inst = await lockExerciseSettings(tx);
    if (!inst) return;
    const policy = readPolicy(inst.policy);
    const raw = (inst.policy && typeof inst.policy === "object" && !Array.isArray(inst.policy) ? inst.policy : {}) as Record<string, unknown>;
    await tx.exerciseSettings.update({
      where: { organizationId: inst.organizationId },
      data: { policy: { ...raw, suggestedObjectives: policy.suggestedObjectives.filter((s) => s.id !== id) } as Prisma.InputJsonValue },
    });
  });
}
