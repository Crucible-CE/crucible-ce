// Evaluator grades and entry moderation. Every grade in CE is a person's.
// Grades are append-only: a change is a new Grade row with source 'human',
// and the effective grade is the latest one.
//
// Gradable responses: Playbook Exercise entries (against the question's
// rubric) and Crisis Sim written deliverables (against the inject's criteria).

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bumpVersion } from "@/lib/exercise/runtime/transition";
import { ServiceError } from "@/lib/exercise/errors";
import { GRADE_RATINGS, rubricCriteriaSchema } from "@/lib/exercise/modes/document/schema";

export const humanGradeSchema = z.object({
  responseId: z.string().min(1).max(64),
  score: z.number().min(0).max(4),
  rating: z.enum(GRADE_RATINGS),
  rationale: z.string().trim().min(1, "Write a short rationale.").max(2000),
});
export type HumanGradeInput = z.infer<typeof humanGradeSchema>;

export const ENTRY_STATUSES = ["submitted", "confirmed", "denied"] as const;
export const entryStatusSchema = z.object({ status: z.enum(ENTRY_STATUSES) });

/** Response kinds an evaluator grades here, by mode. */
const GRADABLE: Record<string, string> = { document: "entry", crisissim: "deliverable" };

async function gradableResponse(exerciseId: string, responseId: string) {
  const r = await db.response.findUnique({
    where: { id: responseId },
    select: { id: true, exerciseId: true, kind: true, status: true, exercise: { select: { mode: true, status: true } } },
  });
  if (!r || r.exerciseId !== exerciseId || GRADABLE[r.exercise.mode] !== r.kind) {
    throw new ServiceError(404, "Response not found.");
  }
  return r;
}

async function documentEntry(exerciseId: string, responseId: string) {
  const r = await gradableResponse(exerciseId, responseId);
  if (r.kind !== "entry") throw new ServiceError(404, "Entry not found.");
  return r;
}

/** Record an evaluator grade. Returns the new grade id. */
export async function addHumanGrade(exerciseId: string, input: HumanGradeInput, userId: string | null): Promise<{ id: string; attempt: number }> {
  await gradableResponse(exerciseId, input.responseId);
  for (let tries = 0; tries < 3; tries++) {
    const last = await db.grade.findFirst({
      where: { responseId: input.responseId, source: "human" },
      orderBy: { attempt: "desc" },
      select: { attempt: true },
    });
    const attempt = (last?.attempt ?? 0) + 1;
    try {
      const g = await db.grade.create({
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
      return { id: g.id, attempt };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new ServiceError(409, "Another evaluator saved a grade at the same time. Try again.");
}

/** Confirm or deny an entry. Bumps stateVersion. Returns the new version and the old status. */
export async function setEntryStatus(
  exerciseId: string,
  responseId: string,
  status: (typeof ENTRY_STATUSES)[number],
): Promise<{ version: number; from: string }> {
  const r = await documentEntry(exerciseId, responseId);
  if (r.exercise.status === "abandoned") throw new ServiceError(409, "This exercise was abandoned.");
  const version = await db.$transaction(async (tx) => {
    await tx.response.update({ where: { id: responseId }, data: { status } });
    return bumpVersion(tx, exerciseId);
  });
  return { version, from: r.status };
}

/** Entry grades and the rubric text per question, for the control room. */
export async function gradeDetails(exerciseId: string) {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { templateId: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  const rows = await db.grade.findMany({
    where: { response: { exerciseId, kind: "entry" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, responseId: true, source: true, attempt: true, score: true, rating: true, rationale: true, createdAt: true, createdById: true },
  });
  const rubrics = await db.rubric.findMany({
    where: { OR: [{ exerciseId }, ...(ex.templateId ? [{ templateId: ex.templateId }] : [])] },
    select: { questionKey: true, criteria: true, exerciseId: true, capabilityKey: true },
  });
  const criteriaByQuestion: Record<string, Array<{ id: string; text: string }>> = {};
  // Exercise rubrics win over template rubrics.
  for (const r of [...rubrics].sort((a, b) => Number(Boolean(a.exerciseId)) - Number(Boolean(b.exerciseId)))) {
    const c = rubricCriteriaSchema.safeParse(r.criteria);
    if (c.success) criteriaByQuestion[r.questionKey] = c.data.map((x) => ({ id: x.id, text: x.text }));
  }
  return {
    grades: rows.map((g) => ({
      id: g.id,
      responseId: g.responseId,
      source: g.source,
      attempt: g.attempt,
      score: g.score,
      rating: g.rating,
      rationale: g.rationale,
      createdAt: g.createdAt,
    })),
    criteria: criteriaByQuestion,
  };
}
