// Table-driven state machines for Exercise and Inject.
// Every status change goes through these helpers: a guarded updateMany whose
// WHERE includes the expected pre-state, so concurrent callers collapse to one
// winner. Exercise transitions also bump stateVersion.

import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { ExerciseStatus, InjectStatus } from "./types";

export const EXERCISE_TRANSITIONS: Readonly<Record<ExerciseStatus, readonly ExerciseStatus[]>> = {
  draft: ["lobby", "live", "abandoned"],
  lobby: ["live", "draft", "abandoned"],
  live: ["paused", "ended", "abandoned"],
  paused: ["live", "ended", "abandoned"],
  ended: [],
  abandoned: [],
};

export const INJECT_TRANSITIONS: Readonly<Record<InjectStatus, readonly InjectStatus[]>> = {
  pending: ["held", "open"],
  held: ["open"],
  open: ["closed"],
  closed: [],
};

export function canTransitionExercise(from: ExerciseStatus, to: ExerciseStatus): boolean {
  return EXERCISE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionInject(from: InjectStatus, to: InjectStatus): boolean {
  return INJECT_TRANSITIONS[from]?.includes(to) ?? false;
}

export class TransitionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

/**
 * Move an exercise from one of `from` to `to`. Returns true when this caller
 * won. Throws when the transition is not allowed by the table.
 */
export async function transitionExercise(
  tx: Tx,
  exerciseId: string,
  from: ExerciseStatus | readonly ExerciseStatus[],
  to: ExerciseStatus,
  data: Prisma.ExerciseUpdateManyMutationInput = {},
): Promise<boolean> {
  const fromList = (Array.isArray(from) ? from : [from]) as ExerciseStatus[];
  for (const f of fromList) {
    if (!canTransitionExercise(f, to)) {
      throw new TransitionError(500, `exercise transition ${f} -> ${to} is not allowed`);
    }
  }
  const res = await tx.exercise.updateMany({
    where: { id: exerciseId, status: { in: fromList } },
    data: { ...data, status: to, stateVersion: { increment: 1 } },
  });
  return res.count === 1;
}

export async function transitionInject(
  tx: Tx,
  injectId: string,
  from: InjectStatus,
  to: InjectStatus,
  data: Prisma.InjectUpdateManyMutationInput = {},
): Promise<boolean> {
  if (!canTransitionInject(from, to)) {
    throw new TransitionError(500, `inject transition ${from} -> ${to} is not allowed`);
  }
  const res = await tx.inject.updateMany({
    where: { id: injectId, status: from },
    data: { ...data, status: to },
  });
  return res.count === 1;
}

/** Bump stateVersion without a status change (score, responses, roster). */
export async function bumpVersion(tx: Tx, exerciseId: string): Promise<number> {
  const row = await tx.exercise.update({
    where: { id: exerciseId },
    data: { stateVersion: { increment: 1 } },
    select: { stateVersion: true },
  });
  return row.stateVersion;
}
