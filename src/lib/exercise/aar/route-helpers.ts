// Shared lookups for the AAR routes (finalize, sign, amend, export).
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";

/** The AAR with this id in this exercise, or the latest version when aarId is empty. */
export async function aarInExercise(exerciseId: string, aarId: string | null | undefined): Promise<{ id: string; version: number; status: string }> {
  const aar = aarId
    ? await db.afterActionReport.findFirst({ where: { id: aarId, exerciseId }, select: { id: true, version: true, status: true } })
    : await db.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true } });
  if (!aar) throw new ServiceError(404, "Report not found. Draft the after-action report first.");
  return aar;
}

export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "exercise";
}
