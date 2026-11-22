// Time box check shared by every mode. Paused time never counts, including a
// pause that is still in progress.

import type { ExerciseRow } from "@/lib/exercise/runtime/types";

export function timeboxReached(ex: Pick<ExerciseRow, "timeboxMin" | "startedAt" | "pausedMsTotal" | "pausedAt">, now: Date): boolean {
  if (!ex.timeboxMin || !ex.startedAt) return false;
  const pausing = ex.pausedAt ? Math.max(0, now.getTime() - ex.pausedAt.getTime()) : 0;
  return now.getTime() >= ex.startedAt.getTime() + ex.timeboxMin * 60_000 + ex.pausedMsTotal + pausing;
}
