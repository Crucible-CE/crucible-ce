// Evaluator ratings (P/S/M/U, or "Not evaluated" with a reason) per objective.
// Append-only CapabilityRating rows with source "evaluator"; the latest
// evaluator rating for an objective wins. "Not evaluated" is stored as "N".
// Ratings describe capabilities, not people. Ratings lock while the latest report is
// in review or final, and every new rating is written onto the draft report.

import { z } from "zod";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { NOT_EVALUATED, RATINGS, type Rating } from "@/lib/exercise/aar/schema";
import { assertRatingsOpen, syncRatingsIntoAar } from "@/lib/exercise/aar/ratings-sync";
import type { ParticipantRow, Viewer } from "@/lib/exercise/runtime/types";
import { assertEnded } from "./hotwash";

export const ratingInputSchema = z.object({
  objectiveId: z.string().min(1).max(40),
  /** P/S/M/U, or not_evaluated (the reason goes in rationale). */
  rating: z.enum([...RATINGS, "not_evaluated"]),
  rationale: z.string().trim().min(1, "Give a short rationale.").max(2000, "Use 2000 characters or fewer."),
  capabilityId: z.string().max(40).nullable().optional(),
});
export type RatingInput = z.infer<typeof ratingInputSchema>;

/** Evaluators and the lead facilitator rate; the exercise owner and admins can too. */
export function canRate(viewer: Viewer, participant: ParticipantRow | null, isOwnerOrAdmin: boolean): boolean {
  if (isOwnerOrAdmin) return true;
  if (!viewer.isControl || !participant) return false;
  return participant.roles.includes("evaluator") || participant.roles.includes("lead_facilitator");
}

export type StoredRating = Rating | typeof NOT_EVALUATED;

export interface RatingView {
  id: string;
  rating: StoredRating;
  rationale: string | null;
  capabilityId: string | null;
  capabilityName: string | null;
  by: string | null;
  source: "evaluator";
  createdAt: string;
}

export interface ObjectiveRatings {
  objectiveId: string;
  seq: number;
  text: string;
  capabilityIds: string[];
  current: RatingView | null;
  history: RatingView[];
}

/** Latest evaluator rating wins. Pure. */
export function effectiveRating<T extends { source: string; createdAt: Date | string }>(rows: T[]): T | null {
  const ev = rows.filter((r) => r.source === "evaluator");
  if (!ev.length) return null;
  return ev.reduce((a, b) => (new Date(b.createdAt).getTime() >= new Date(a.createdAt).getTime() ? b : a));
}

export async function listRatings(exerciseId: string): Promise<{ objectives: ObjectiveRatings[]; capabilities: Array<{ id: string; key: string; name: string }> }> {
  const [objectives, rows] = await Promise.all([
    db.objective.findMany({ where: { exerciseId }, orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true, capabilityIds: true } }),
    db.capabilityRating.findMany({
      where: { exerciseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { capability: { select: { name: true } } },
    }),
  ]);
  const userIds = [...new Set(rows.map((r) => r.byUserId).filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  const capIds = [...new Set(objectives.flatMap((o) => o.capabilityIds))];
  const capabilities = capIds.length
    ? await db.capability.findMany({ where: { id: { in: capIds } }, orderBy: [{ framework: "asc" }, { seq: "asc" }], select: { id: true, key: true, name: true } })
    : [];
  const view = (r: (typeof rows)[number]): RatingView => ({
    id: r.id,
    rating: r.rating as StoredRating,
    rationale: r.rationale,
    capabilityId: r.capabilityId,
    capabilityName: r.capability?.name ?? null,
    by: r.byUserId ? (names.get(r.byUserId) ?? null) : null,
    source: "evaluator",
    createdAt: r.createdAt.toISOString(),
  });
  return {
    objectives: objectives.map((o) => {
      const mine = rows.filter((r) => r.objectiveId === o.id);
      const cur = effectiveRating(mine);
      return {
        objectiveId: o.id,
        seq: o.seq,
        text: o.text,
        capabilityIds: o.capabilityIds,
        current: cur ? view(cur) : null,
        history: mine.filter((r) => r.source === "evaluator").map(view).reverse(),
      };
    }),
    capabilities,
  };
}

export async function addRating(exerciseId: string, byUserId: string, input: RatingInput): Promise<string> {
  await assertEnded(exerciseId);
  await assertRatingsOpen(exerciseId);
  const o = await db.objective.findFirst({ where: { id: input.objectiveId, exerciseId }, select: { id: true } });
  if (!o) throw new ServiceError(400, "That objective is not part of this exercise.");
  if (input.capabilityId) {
    const c = await db.capability.findUnique({ where: { id: input.capabilityId }, select: { id: true } });
    if (!c) throw new ServiceError(400, "That capability does not exist.");
  }
  const row = await db.capabilityRating.create({
    data: {
      exerciseId,
      objectiveId: o.id,
      capabilityId: input.capabilityId ?? null,
      rating: input.rating === "not_evaluated" ? NOT_EVALUATED : input.rating,
      source: "evaluator",
      rationale: input.rationale,
      byUserId,
    },
    select: { id: true },
  });
  await syncRatingsIntoAar(exerciseId);
  return row.id;
}
