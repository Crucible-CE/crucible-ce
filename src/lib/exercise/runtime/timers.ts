// Inject deadlines. Closes are driven by an in-process setTimeout for the
// nearest deadline of each exercise, with a one-minute cron sweep as the
// backstop (process restarts, missed timers). Both call closeInject, which is
// idempotent, so a double fire is harmless.

import { db } from "@/lib/db";

type Timer = { injectId: string; handle: ReturnType<typeof setTimeout> };

const KEY = Symbol.for("crucible.ce.exercise.injectTimers");

function timers(): Map<string, Timer> {
  const g = globalThis as typeof globalThis & { [KEY]?: Map<string, Timer> };
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

// setTimeout caps at ~24.8 days; deadlines past that are left to the sweep.
const MAX_DELAY_MS = 2_000_000_000;

export function scheduleInjectTimer(exerciseId: string, injectId: string, closesAt: Date): void {
  clearExerciseTimer(exerciseId);
  const delay = Math.max(0, closesAt.getTime() - Date.now());
  if (delay > MAX_DELAY_MS) return;
  const handle = setTimeout(() => {
    timers().delete(exerciseId);
    void fireTimer(exerciseId, injectId);
  }, delay + 250);
  if (typeof handle === "object" && "unref" in handle) handle.unref();
  timers().set(exerciseId, { injectId, handle });
}

export function clearExerciseTimer(exerciseId: string, injectId?: string): void {
  const t = timers().get(exerciseId);
  if (!t) return;
  if (injectId && t.injectId !== injectId) return;
  clearTimeout(t.handle);
  timers().delete(exerciseId);
}

async function fireTimer(exerciseId: string, injectId: string): Promise<void> {
  try {
    const { closeInject } = await import("./engine");
    const inj = await db.inject.findFirst({
      where: { id: injectId, exerciseId, status: "open" },
      select: { closesAt: true, exercise: { select: { status: true } } },
    });
    if (!inj || inj.exercise.status !== "live" || !inj.closesAt) return;
    if (inj.closesAt.getTime() > Date.now()) {
      // Deadline moved (extend, resume). Re-arm.
      scheduleInjectTimer(exerciseId, injectId, inj.closesAt);
      return;
    }
    await closeInject(exerciseId, injectId, "timer", {});
  } catch (err) {
    console.error(`[timers] close failed for ${exerciseId}/${injectId}:`, err);
  }
}

/** Cron backstop: close overdue injects and end exercises past their time box. */
export async function sweepDeadlines(now = new Date()): Promise<{ closed: number; ended: number }> {
  const { closeInject, endExercise } = await import("./engine");
  let closed = 0;
  let ended = 0;

  const overdue = await db.inject.findMany({
    where: { status: "open", closesAt: { lte: now }, exercise: { status: "live" } },
    select: { id: true, exerciseId: true },
    take: 200,
  });
  for (const inj of overdue) {
    const res = await closeInject(inj.exerciseId, inj.id, "timer", {}).catch((err) => {
      console.error(`[timers] sweep close failed for ${inj.exerciseId}/${inj.id}:`, err);
      return null;
    });
    if (res?.closed) closed++;
  }

  const live = await db.exercise.findMany({
    where: { status: "live", timeboxMin: { not: null }, startedAt: { not: null } },
    select: { id: true, timeboxMin: true, startedAt: true, pausedMsTotal: true },
  });
  for (const ex of live) {
    const endAt = ex.startedAt!.getTime() + ex.timeboxMin! * 60_000 + ex.pausedMsTotal;
    if (endAt <= now.getTime()) {
      const ok = await endExercise(ex.id, "timebox", {}).catch((err) => {
        console.error(`[timers] sweep end failed for ${ex.id}:`, err);
        return false;
      });
      if (ok) ended++;
    }
  }
  return { closed, ended };
}

/** Re-arm timers for open injects after a restart. */
export async function rearmTimers(): Promise<void> {
  const open = await db.inject.findMany({
    where: { status: "open", closesAt: { not: null }, exercise: { status: "live" } },
    select: { id: true, exerciseId: true, closesAt: true },
  });
  for (const inj of open) scheduleInjectTimer(inj.exerciseId, inj.id, inj.closesAt!);
}
