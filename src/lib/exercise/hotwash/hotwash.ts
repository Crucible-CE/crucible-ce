// Hotwash: strengths and areas for improvement per objective, plus a parking
// lot, captured right after ENDEX. Control reads; drivers write. Authors edit
// and delete their own items; the exercise owner and admins can change any.

import { z } from "zod";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";

export const HOTWASH_KINDS = ["strength", "afi", "parking_lot"] as const;
export type HotwashKind = (typeof HOTWASH_KINDS)[number];

export const hotwashCreateSchema = z.object({
  kind: z.enum(HOTWASH_KINDS),
  objectiveId: z.string().max(40).nullable().optional(),
  text: z.string().trim().min(1, "Write something first.").max(2000, "Use 2000 characters or fewer."),
});
export const hotwashUpdateSchema = z.object({
  kind: z.enum(HOTWASH_KINDS).optional(),
  objectiveId: z.string().max(40).nullable().optional(),
  text: z.string().trim().min(1, "Write something first.").max(2000, "Use 2000 characters or fewer.").optional(),
});

export interface HotwashItemView {
  id: string;
  kind: HotwashKind;
  objectiveId: string | null;
  text: string;
  author: string | null;
  byParticipantId: string | null;
  createdAt: string;
}

export async function assertEnded(exerciseId: string): Promise<{ isPractice: boolean }> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true, isPractice: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex.status !== "ended") throw new ServiceError(409, "The hotwash opens after ENDEX.");
  return { isPractice: ex.isPractice };
}

/** Hotwash writes stop once the latest report is final. */
async function assertHotwashOpen(exerciseId: string): Promise<void> {
  await assertEnded(exerciseId);
  const latest = await db.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { status: true } });
  if (latest?.status === "final") throw new ServiceError(409, "The report is final. Amend it to change the hotwash.");
}

export async function listHotwash(exerciseId: string): Promise<HotwashItemView[]> {
  const rows = await db.hotwashItem.findMany({
    where: { exerciseId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 1000,
    include: { by: { select: { displayName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as HotwashKind,
    objectiveId: r.objectiveId,
    text: r.text,
    author: r.by?.displayName ?? null,
    byParticipantId: r.byParticipantId,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function checkObjective(exerciseId: string, kind: HotwashKind, objectiveId: string | null | undefined): Promise<string | null> {
  if (kind === "parking_lot") return null;
  if (!objectiveId) return null;
  const o = await db.objective.findFirst({ where: { id: objectiveId, exerciseId }, select: { id: true } });
  if (!o) throw new ServiceError(400, "That objective is not part of this exercise.");
  return o.id;
}

export async function addHotwashItem(
  exerciseId: string,
  byParticipantId: string | null,
  input: z.infer<typeof hotwashCreateSchema>,
): Promise<string> {
  await assertHotwashOpen(exerciseId);
  const objectiveId = await checkObjective(exerciseId, input.kind, input.objectiveId);
  const row = await db.hotwashItem.create({
    data: { exerciseId, kind: input.kind, objectiveId, text: input.text, byParticipantId },
    select: { id: true },
  });
  return row.id;
}

async function editable(exerciseId: string, id: string, participantId: string | null, canModerate: boolean) {
  const row = await db.hotwashItem.findFirst({ where: { id, exerciseId } });
  if (!row) throw new ServiceError(404, "Hotwash item not found.");
  const own = Boolean(participantId && row.byParticipantId === participantId);
  if (!own && !canModerate) throw new ServiceError(403, "You can change only your own items.");
  return row;
}

export async function updateHotwashItem(
  exerciseId: string,
  id: string,
  actor: { participantId: string | null; canModerate: boolean },
  input: z.infer<typeof hotwashUpdateSchema>,
): Promise<{ before: { kind: string; text: string; objectiveId: string | null } }> {
  await assertHotwashOpen(exerciseId);
  const row = await editable(exerciseId, id, actor.participantId, actor.canModerate);
  const kind = (input.kind ?? row.kind) as HotwashKind;
  const objectiveId = await checkObjective(exerciseId, kind, input.objectiveId !== undefined ? input.objectiveId : row.objectiveId);
  await db.hotwashItem.update({
    where: { id: row.id },
    data: { kind, objectiveId, ...(input.text !== undefined ? { text: input.text } : {}) },
  });
  return { before: { kind: row.kind, text: row.text, objectiveId: row.objectiveId } };
}

export async function deleteHotwashItem(
  exerciseId: string,
  id: string,
  actor: { participantId: string | null; canModerate: boolean },
): Promise<{ kind: string; text: string; objectiveId: string | null }> {
  await assertHotwashOpen(exerciseId);
  const row = await editable(exerciseId, id, actor.participantId, actor.canModerate);
  await db.hotwashItem.delete({ where: { id: row.id } });
  return { kind: row.kind, text: row.text, objectiveId: row.objectiveId };
}
