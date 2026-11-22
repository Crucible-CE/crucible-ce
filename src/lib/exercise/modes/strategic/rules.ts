// Pure Strategic TTX rules shared by the mode, the grader and the win check.

import type { ExerciseSnapshot, InjectRow } from "@/lib/exercise/runtime/types";
import { teamTargeted } from "@/lib/exercise/modes/shared/project-base";
import { injectContentSchema, type InjectContent } from "./schema";

export function readContent(i: Pick<InjectRow, "content">): InjectContent | null {
  const r = injectContentSchema.safeParse(i.content);
  return r.success ? r.data : null;
}

/** Teams that must answer: those with an active variant (all targeted teams when there are no variants). */
export function activeTeamIds(s: Pick<ExerciseSnapshot, "teams">, inject: InjectRow): string[] {
  const content = readContent(inject);
  if (content?.contingency && content.teamVariants.length === 0) return [];
  const variants = content?.teamVariants ?? [];
  if (variants.length > 0) {
    return variants.filter((v) => v.status === "active" && v.teamId).map((v) => v.teamId as string);
  }
  return s.teams.filter((t) => teamTargeted(inject, t.id)).map((t) => t.id);
}

/** The latest evaluator grade. */
export function effectiveGrade<G extends { source: string; createdAt: Date }>(grades: G[]): G | null {
  const sorted = [...grades].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return [...sorted].reverse().find((g) => g.source === "human") ?? sorted.at(-1) ?? null;
}
