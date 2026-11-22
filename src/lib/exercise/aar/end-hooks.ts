// After-action work at ENDEX: draft v1 of the report from the record, so the
// facilitator opens a report with the factual sections filled. Registered by
// runEndHooks (src/lib/exercise/runtime/hooks.ts) in whichever process ends the
// exercise. Must not import next/headers or @/lib/auth.

import { onExerciseEnded } from "@/lib/exercise/runtime/hooks";
import { createAarAtEndex } from "./service";

const KEY = Symbol.for("crucible.ce.exercise.afterActionHooks");

export function registerAfterActionEndHooks(): void {
  const g = globalThis as typeof globalThis & { [KEY]?: boolean };
  if (g[KEY]) return;
  g[KEY] = true;
  onExerciseEnded(async (exerciseId) => {
    await createAarAtEndex(exerciseId);
  });
}
