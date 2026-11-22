// Post-ENDEX hooks. The after-action pipeline registers here.
//
// An exercise can end in any process: an API route in the Next.js process, or
// a timer or cron in the process that boots the runtime (server.ts in
// production, the socket sidecar in development). runEndHooks therefore loads
// the feature hooks itself the first time it runs, so every process that ends
// an exercise runs the same hooks without depending on bootRuntime().

import type { EndReason } from "./types";

type EndHook = (exerciseId: string, reason: EndReason) => Promise<void>;

const KEY = Symbol.for("crucible.ce.exercise.endHooks");

function hooks(): EndHook[] {
  const g = globalThis as typeof globalThis & { [KEY]?: EndHook[] };
  if (!g[KEY]) g[KEY] = [];
  return g[KEY];
}

export function onExerciseEnded(hook: EndHook): void {
  hooks().push(hook);
}

/** Register the feature end hooks in this process. Idempotent. */
export async function loadFeatureEndHooks(): Promise<void> {
  const { registerAfterActionEndHooks } = await import("@/lib/exercise/aar/end-hooks");
  registerAfterActionEndHooks();
}

export async function runEndHooks(exerciseId: string, reason: EndReason): Promise<void> {
  try {
    await loadFeatureEndHooks();
  } catch (err) {
    console.error("[runtime] could not load end hooks:", err);
  }
  for (const hook of hooks()) {
    try {
      await hook(exerciseId, reason);
    } catch (err) {
      console.error(`[runtime] end hook failed for ${exerciseId}:`, err);
    }
  }
}
