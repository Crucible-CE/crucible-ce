// AfterActionReport row access shared by the AAR services: latest version,
// row lock for read-modify-write of sections, and editability checks.

import type { AfterActionReport } from "@prisma/client";
import { db, type DbClient, type Tx } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";

export async function latestAar(exerciseId: string, client: DbClient = db): Promise<AfterActionReport | null> {
  return client.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" } });
}

/** Lock the row for this transaction and return it. */
export async function lockAar(tx: Tx, aarId: string): Promise<AfterActionReport | null> {
  await tx.$queryRaw`SELECT id FROM "AfterActionReport" WHERE id = ${aarId} FOR UPDATE`;
  return tx.afterActionReport.findUnique({ where: { id: aarId } });
}

/** Is this the newest version of the exercise's report? */
export async function isLatest(tx: DbClient, aar: Pick<AfterActionReport, "exerciseId" | "version">): Promise<boolean> {
  const newer = await tx.afterActionReport.count({ where: { exerciseId: aar.exerciseId, version: { gt: aar.version } } });
  return newer === 0;
}

/** Only the latest version, in draft or review, may change. Throws ServiceError(409). */
export async function assertEditable(tx: DbClient, aar: AfterActionReport | null): Promise<AfterActionReport> {
  if (!aar) throw new ServiceError(404, "After-action report not found.");
  if (aar.status === "final") throw new ServiceError(409, "This report is final. Start an amendment to change it.");
  if (aar.status !== "draft" && aar.status !== "review") throw new ServiceError(409, "This report cannot be edited.");
  if (!(await isLatest(tx, aar))) throw new ServiceError(409, "Only the latest version can be edited.");
  return aar;
}

export const REVIEW_FROZEN_MESSAGE = "The report is in review. Move it back to draft to change it.";

/**
 * Content changes (section edits, accepted proposals, AI regeneration, rating
 * confirmations) need the latest version in draft. Review freezes the content
 * that signers approve. Throws ServiceError(409).
 */
export async function assertDraft(tx: DbClient, aar: AfterActionReport | null): Promise<AfterActionReport> {
  const a = await assertEditable(tx, aar);
  if (a.status !== "draft") throw new ServiceError(409, REVIEW_FROZEN_MESSAGE);
  return a;
}
