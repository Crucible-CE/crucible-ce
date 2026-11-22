// Evaluator ratings and grade details for Strategic TTX. Grades are
// append-only: a change is a new Grade with source 'human', and the
// effective grade is the latest one.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bumpVersion } from "@/lib/exercise/runtime/transition";
import { ServiceError } from "@/lib/exercise/errors";
import { ANSWER_RATINGS } from "@/lib/exercise/modes/strategic/schema";

export const humanGradeSchema = z
  .object({
    responseId: z.string().trim().min(1).max(64),
    score: z.number().min(0).max(4),
    rating: z.enum(ANSWER_RATINGS),
    rationale: z.string().trim().min(1, "Write a short rationale.").max(2000),
  })
  .strict();
export type HumanGradeInput = z.infer<typeof humanGradeSchema>;

async function strategicAnswer(exerciseId: string, responseId: string) {
  const r = await db.response.findUnique({
    where: { id: responseId },
    select: { id: true, exerciseId: true, kind: true, exercise: { select: { mode: true, status: true } } },
  });
  if (!r || r.exerciseId !== exerciseId || r.kind !== "answer" || r.exercise.mode !== "strategic") {
    throw new ServiceError(404, "Answer not found.");
  }
  if (r.exercise.status === "abandoned") throw new ServiceError(409, "This exercise was abandoned.");
  return r;
}

/** Record an evaluator grade. Bumps stateVersion. */
export async function addHumanGrade(
  exerciseId: string,
  input: HumanGradeInput,
  userId: string | null,
): Promise<{ id: string; attempt: number; version: number }> {
  await strategicAnswer(exerciseId, input.responseId);
  for (let tries = 0; tries < 3; tries++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.grade.findFirst({
          where: { responseId: input.responseId, source: "human" },
          orderBy: { attempt: "desc" },
          select: { attempt: true },
        });
        const attempt = (last?.attempt ?? 0) + 1;
        const g = await tx.grade.create({
          data: {
            responseId: input.responseId,
            source: "human",
            attempt,
            score: Math.round(input.score * 2) / 2,
            rating: input.rating,
            rationale: input.rationale,
            details: {} as Prisma.InputJsonValue,
            createdById: userId,
          },
          select: { id: true },
        });
        const version = await bumpVersion(tx, exerciseId);
        return { id: g.id, attempt, version };
      });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new ServiceError(409, "Another evaluator saved a grade at the same time. Try again.");
}

/** Every grade on the exercise's answers. Control only (the route checks). */
export async function gradeDetails(exerciseId: string) {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { mode: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex.mode !== "strategic") throw new ServiceError(400, "This exercise is not a Strategic TTX.");
  const rows = await db.grade.findMany({
    where: { response: { exerciseId, kind: "answer" } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      responseId: true,
      source: true,
      attempt: true,
      score: true,
      rating: true,
      rationale: true,
      createdAt: true,
      response: { select: { injectId: true, teamId: true } },
    },
  });
  return {
    grades: rows.map((g) => ({
      id: g.id,
      responseId: g.responseId,
      injectId: g.response.injectId,
      teamId: g.response.teamId,
      source: g.source,
      attempt: g.attempt,
      score: g.score,
      rating: g.rating,
      rationale: g.rationale,
      createdAt: g.createdAt,
    })),
  };
}
