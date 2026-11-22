// Mode registry. The only file outside src/modes/<mode> that imports a mode.

import { MODES as MODE_KEYS, type ExerciseMode, type Mode } from "@/lib/exercise/runtime/types";
import { crisisSimMode } from "./crisissim";
import { documentMode } from "./document";
import { strategicMode } from "./strategic";
import { PATH_LABELS as CRISIS_PATH_LABELS } from "./crisissim/schema";

const MODES: Partial<Record<Mode, ExerciseMode>> = {
  crisissim: crisisSimMode as ExerciseMode,
  document: documentMode as ExerciseMode,
  strategic: strategicMode as ExerciseMode,
};

/** Public names, also for modes not registered yet. */
export const MODE_LABELS: Record<Mode, string> = {
  crisissim: "Crisis Sim",
  document: "Playbook Exercise",
  strategic: "Strategic TTX",
};

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODE_KEYS as readonly string[]).includes(value);
}

export function getMode(mode: Mode): ExerciseMode {
  const m = MODES[mode];
  if (!m) throw new Error(`Unknown exercise mode: ${mode}`);
  return m;
}

/** The registered mode, or null when it is not available in this build. */
export function findMode(mode: string): ExerciseMode | null {
  return isMode(mode) ? (MODES[mode] ?? null) : null;
}

export function listModes(): ExerciseMode[] {
  return Object.values(MODES).filter((m): m is ExerciseMode => Boolean(m));
}

/** Player-facing label for a path key (Crisis Sim paths). Null when the mode has no paths. */
export function modePathLabel(mode: Mode, key: string): string | null {
  if (mode === "crisissim") return (CRISIS_PATH_LABELS as Record<string, string>)[key] ?? null;
  return null;
}
