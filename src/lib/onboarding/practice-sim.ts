// Onboarding "Run the practice Crisis Sim": launches the library practice sim
// (seed-crisissim-practice) as a practice run (isPractice) for the member alone.
// They are lead facilitator and the Response Team's decision maker, so they
// start it, decide each inject and call ENDEX themselves. Practice runs never
// get an after-action report or work items (lib/exercise/aar).
//
// Idempotent: an unfinished practice run of the member's is reused.

import { db } from "@/lib/db";
import { createExercise } from "@/lib/exercise/create";
import { ensureExerciseLibrary } from "@/lib/exercise/library";
import { PRACTICE_TEMPLATE_ID } from "@/lib/exercise/templates/crisissim-seed-data";
import { ServiceError } from "@/lib/exercise/errors";
import type { SessionUser } from "@/lib/exercise/auth/session";

const FINISHED = ["ended", "abandoned"];

export async function launchPracticeSim(user: SessionUser): Promise<{ id: string; created: boolean }> {
  const open = await db.exercise.findFirst({
    where: { isPractice: true, templateId: PRACTICE_TEMPLATE_ID, createdById: user.id, status: { notIn: FINISHED } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (open) return { id: open.id, created: false };

  await ensureExerciseLibrary();
  const template = await db.exerciseTemplate.findUnique({ where: { id: PRACTICE_TEMPLATE_ID }, select: { title: true } });
  if (!template) throw new ServiceError(404, "The practice sim is not in the library.");

  const { id } = await createExercise({ mode: "crisissim", title: template.title, templateId: PRACTICE_TEMPLATE_ID, isPractice: true }, user);

  // Solo: the creator also plays for the only team and makes its decisions.
  const team = await db.team.findFirst({ where: { exerciseId: id }, orderBy: { seq: "asc" }, select: { id: true } });
  await db.participant.updateMany({
    where: { exerciseId: id, userId: user.id, removedAt: null },
    data: { roles: ["lead_facilitator", "player"], teamId: team?.id ?? null, isDecisionMaker: team !== null },
  });
  return { id, created: true };
}
