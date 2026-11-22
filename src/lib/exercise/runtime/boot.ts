// Runtime boot hook, called by server.ts (and the dev socket sidecar) at start.
// Registers the socket room authorizer, exercise crons, job handlers and
// re-arms inject timers. Must not import next/headers or @/lib/auth (server.ts
// runs outside a request context).

import { db } from "@/lib/db";
import { setRoomAuthorizer, type RoomGrant } from "@/lib/exercise/socket/emit";
import { registerCron } from "@/lib/exercise/runtime/cron";
import { CONTROL_ROLES, type ExerciseRole } from "./types";
import { managesAllExercises } from "@/lib/exercise/auth/rbac";
import { rearmTimers, sweepDeadlines } from "./timers";
import { registerRuntimeJobs } from "./jobs/handlers";
import { ensureExerciseLibrary } from "@/lib/exercise/library";
import { registerScheduleCrons } from "@/lib/exercise/schedule/advance";
import { loadFeatureEndHooks } from "./hooks";

let booted = false;

export async function bootRuntime(): Promise<void> {
  if (booted) return;
  booted = true;

  setRoomAuthorizer(async (principal, exerciseId): Promise<RoomGrant | null> => {
    if (principal.kind === "guest") {
      const p = await db.participant.findFirst({
        where: { id: principal.participantId, exerciseId, removedAt: null },
        select: { id: true, teamId: true },
      });
      if (!p) return null;
      return { all: true, control: false, teamIds: p.teamId ? [p.teamId] : [], participantId: p.id };
    }
    const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { createdById: true } });
    if (!ex) return null;
    const p = await db.participant.findFirst({
      where: { exerciseId, userId: principal.userId, removedAt: null },
      select: { id: true, teamId: true, roles: true },
    });
    const owner = ex.createdById === principal.userId;
    const admin = managesAllExercises(principal.role);
    if (!p && !owner && !admin) return null;
    const control = owner || admin || Boolean(p?.roles.some((r) => CONTROL_ROLES.includes(r as ExerciseRole)));
    // Control sees every team room so team-scoped events reach the facilitator.
    const teamIds = control
      ? (await db.team.findMany({ where: { exerciseId }, select: { id: true } })).map((t) => t.id)
      : p?.teamId
        ? [p.teamId]
        : [];
    return { all: true, control, teamIds, participantId: p?.id ?? null };
  });

  registerCron("exercise-deadlines", "* * * * *", async () => {
    await sweepDeadlines();
  });
  registerScheduleCrons();
  await loadFeatureEndHooks();

  await registerRuntimeJobs();

  await rearmTimers().catch((err) => console.error("[runtime] rearm timers failed:", err));
  // Library templates and capabilities. No-op before first-run setup.
  void ensureExerciseLibrary();
}
