// Edit lock for after-action reports. Only the latest version is editable, and
// only while it is draft or review. A final version is locked; changes go into
// an amendment (a new version). Section routes call assertAarEditable
// before writing sections.

import { db, type DbClient } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";

export interface AarLockRow {
  id: string;
  exerciseId: string;
  version: number;
  status: string;
  sections: unknown;
  editLog: unknown;
}

export const AAR_LOCKED_MESSAGE = "This report is final. Amend it to make changes.";
export const AAR_STALE_MESSAGE = "A newer version of this report exists. Edit the latest version.";

/** Load the AAR and refuse when it is final or not the latest version. */
export async function assertAarEditable(aarId: string, client: DbClient = db): Promise<AarLockRow> {
  const aar = await client.afterActionReport.findUnique({
    where: { id: aarId },
    select: { id: true, exerciseId: true, version: true, status: true, sections: true, editLog: true },
  });
  if (!aar) throw new ServiceError(404, "Report not found.");
  if (aar.status === "final") throw new ServiceError(409, AAR_LOCKED_MESSAGE);
  const newer = await client.afterActionReport.findFirst({
    where: { exerciseId: aar.exerciseId, version: { gt: aar.version } },
    select: { id: true },
  });
  if (newer) throw new ServiceError(409, AAR_STALE_MESSAGE);
  return aar;
}

/** Lock the AAR row for the rest of the transaction (SELECT ... FOR UPDATE). */
export async function lockAarRow(tx: DbClient, aarId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "AfterActionReport" WHERE id = ${aarId} FOR UPDATE`;
}
