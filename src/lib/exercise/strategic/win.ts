// Optional game rule for Strategic TTX: end the exercise early when every
// active team was rated effective on the last two closed injects (contingency
// injects do not count). The effective grade is the latest evaluator grade.
// Runs after a grade is written. ENDEX by the facilitator or the time box stays authoritative; this only ends early.

import { db } from "@/lib/db";
import { endExercise } from "@/lib/exercise/runtime/engine";
import { loadSnapshot } from "@/lib/exercise/runtime/snapshot";
import type { ExerciseSnapshot } from "@/lib/exercise/runtime/types";
import { activeTeamIds, effectiveGrade } from "@/lib/exercise/modes/strategic/rules";
import { exerciseConfigSchema, injectContentSchema } from "@/lib/exercise/modes/strategic/schema";

/** How many closed injects in a row must be effective for every active team. */
export const WIN_STREAK = 2;

export interface WinResponse {
  id: string;
  injectId: string;
  teamId: string | null;
  kind: string;
}

export interface WinGrade {
  responseId: string;
  source: string;
  rating: string | null;
  createdAt: Date;
}

function isContingency(content: unknown): boolean {
  return injectContentSchema.safeParse(content).data?.contingency ?? false;
}

/** Pure check. True when every active team on the last WIN_STREAK closed injects is effective. */
export function winConditionMet(snapshot: Pick<ExerciseSnapshot, "teams" | "injects">, responses: WinResponse[], grades: WinGrade[]): boolean {
  const closed = snapshot.injects
    .filter((i) => i.status === "closed" && !isContingency(i.content))
    .sort((a, b) => a.seq - b.seq)
    .slice(-WIN_STREAK);
  if (closed.length < WIN_STREAK) return false;
  for (const inject of closed) {
    const active = activeTeamIds(snapshot, inject);
    if (active.length === 0) return false;
    for (const teamId of active) {
      const answer = responses.find((r) => r.injectId === inject.id && r.teamId === teamId && r.kind === "answer");
      if (!answer) return false;
      const eff = effectiveGrade(grades.filter((g) => g.responseId === answer.id));
      if (eff?.rating !== "effective") return false;
    }
  }
  return true;
}

/**
 * Check the rule for one exercise and end it when met. Only when the
 * exercise is live and its config says winCondition 'dynamic'. Returns true
 * when this call ended the exercise.
 */
export async function checkWinCondition(exerciseId: string): Promise<boolean> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { mode: true, status: true, config: true } });
  if (!ex || ex.mode !== "strategic" || ex.status !== "live") return false;
  const config = exerciseConfigSchema.safeParse(ex.config ?? {});
  if (!config.success || config.data.winCondition !== "dynamic") return false;

  const { snapshot } = await loadSnapshot(db, exerciseId);
  const closedIds = snapshot.injects.filter((i) => i.status === "closed").map((i) => i.id);
  if (closedIds.length < WIN_STREAK) return false;
  const responses = await db.response.findMany({
    where: { exerciseId, injectId: { in: closedIds }, kind: "answer" },
    select: { id: true, injectId: true, teamId: true, kind: true, grades: { select: { responseId: true, source: true, rating: true, createdAt: true } } },
  });
  const grades = responses.flatMap((r) => r.grades);
  if (!winConditionMet(snapshot, responses, grades)) return false;
  return endExercise(exerciseId, "win_condition", {});
}
