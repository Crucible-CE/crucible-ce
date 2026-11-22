// Keep the draft report's roster and required-role presence in step with
// facilitator-confirmed attendance. Sections a person edited stay as they are.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildRequiredRoles, buildRoster } from "./draft";
import { appendEditLog, isHumanEdited, readEditLog, readSections } from "./edit";
import { gatherAarInputs } from "./inputs";
import { lockAar } from "./store";

/** Rebuild roster and required roles on the latest draft. Returns true when the report changed. */
export async function syncRosterIntoAar(exerciseId: string): Promise<boolean> {
  const latest = await db.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { id: true, status: true } });
  if (!latest || latest.status !== "draft") return false;
  const inputs = await gatherAarInputs(exerciseId);
  return db.$transaction(async (tx) => {
    const aar = await lockAar(tx, latest.id);
    if (!aar || aar.status !== "draft") return false;
    const sections = readSections(aar.sections);
    if (!sections) return false;
    let log = readEditLog(aar.editLog);
    const next = { ...sections };
    let changed = false;
    if (!isHumanEdited(log, "roster")) {
      const roster = buildRoster(inputs);
      if (JSON.stringify(roster) !== JSON.stringify(sections.roster)) {
        next.roster = roster;
        log = appendEditLog(log, { section: "roster", path: "roster.attendance", origin: "system", byUserId: null, note: "Attendance confirmed" });
        changed = true;
      }
    }
    if (!isHumanEdited(log, "requiredRoles")) {
      const required = buildRequiredRoles(inputs);
      if (JSON.stringify(required) !== JSON.stringify(sections.requiredRoles)) {
        next.requiredRoles = required;
        log = appendEditLog(log, { section: "requiredRoles", path: "requiredRoles.present", origin: "system", byUserId: null, note: "Attendance confirmed" });
        changed = true;
      }
    }
    if (!changed) return false;
    await tx.afterActionReport.update({
      where: { id: aar.id },
      data: { sections: next as unknown as Prisma.InputJsonValue, editLog: log as unknown as Prisma.InputJsonValue },
    });
    return true;
  });
}
