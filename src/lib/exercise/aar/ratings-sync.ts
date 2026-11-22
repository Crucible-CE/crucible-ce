// Keep the draft report's ratings in step with the evaluator record. Every
// evaluator rating (or "Not evaluated") lands on the latest draft right away,
// so the report a signer reviews shows exactly what the evaluators recorded.
//
//   await syncRatingsIntoAar(exerciseId);

import type { Prisma } from "@prisma/client";
import { db, type DbClient } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { applyRatings } from "./draft";
import { appendEditLog, readEditLog, readSections } from "./edit";
import type { AarRating } from "./inputs";
import { lockAar } from "./store";

/** CapabilityRating rows as AarRating (P/S/M/U, and N from evaluators). */
export async function ratingRows(exerciseId: string, client: DbClient = db): Promise<AarRating[]> {
  const rows = await client.capabilityRating.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } });
  return rows
    .filter((r) => r.source === "evaluator" && ["P", "S", "M", "U", "N"].includes(r.rating))
    .map((r) => ({
      id: r.id,
      objectiveId: r.objectiveId,
      capabilityKey: null,
      rating: r.rating as AarRating["rating"],
      source: "evaluator",
      rationale: r.rationale,
      createdAt: r.createdAt.toISOString(),
    }));
}

/**
 * Why ratings cannot change now, or null. A final report is locked; a report
 * in review is frozen for signing.
 */
export async function ratingsClosedReason(exerciseId: string, client: DbClient = db): Promise<string | null> {
  const latest = await client.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { status: true } });
  if (latest?.status === "final") return "The report is final. Amend it to change ratings.";
  if (latest?.status === "review") return "The report is in review. Move it back to draft to change ratings.";
  return null;
}

export async function assertRatingsOpen(exerciseId: string, client: DbClient = db): Promise<void> {
  const reason = await ratingsClosedReason(exerciseId, client);
  if (reason) throw new ServiceError(409, reason);
}

/** Write evaluator ratings onto the latest draft. Returns true when the sections changed. */
export async function syncRatingsIntoAar(exerciseId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const latest = await tx.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { id: true } });
    if (!latest) return false;
    const aar = await lockAar(tx, latest.id);
    if (!aar || aar.status !== "draft") return false;
    return applyRatingsToRow(tx, aar, exerciseId);
  });
}

/** Apply the record's ratings to one locked AAR row. Shared with the move to review. */
export async function applyRatingsToRow(
  tx: Prisma.TransactionClient,
  aar: { id: string; sections: unknown; editLog: unknown },
  exerciseId: string,
): Promise<boolean> {
  const sections = readSections(aar.sections);
  if (!sections) return false;
  const analysis = applyRatings(sections.analysis, { ratings: await ratingRows(exerciseId, tx) });
  const key = (list: typeof analysis) => JSON.stringify(list.map((a) => [a.rating, a.ratingSource, a.notEvaluated, a.ratingSource === "evaluator" ? a.ratingRationale : ""]));
  if (key(analysis) === key(sections.analysis)) return false;
  const log = appendEditLog(readEditLog(aar.editLog), { section: "analysis", path: "analysis.rating", origin: "system", byUserId: null, note: "Evaluator ratings refreshed" });
  await tx.afterActionReport.update({
    where: { id: aar.id },
    data: { sections: { ...sections, analysis } as unknown as Prisma.InputJsonValue, editLog: log as unknown as Prisma.InputJsonValue },
  });
  return true;
}
