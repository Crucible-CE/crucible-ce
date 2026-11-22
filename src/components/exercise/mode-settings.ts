// Mode settings the lobby shows, per mode. The lobby renders a setting only
// when the exercise config carries that key, so a mode that drops or renames a
// key simply loses the control. Saved through PATCH /api/exercises/{id}
// {config}; the server validates with the mode's config schema.

import type { ExerciseInfo } from "./types";

export type ModeSetting =
  | { key: string; kind: "switch"; label: string; hint?: string }
  | { key: string; kind: "select"; label: string; hint?: string; options: Array<{ value: string; label: string }> }
  /** Numeric value or null ("" option). */
  | { key: string; kind: "number-select"; label: string; hint?: string; options: Array<{ value: string; label: string }> };

const CRISIS_SIM: ModeSetting[] = [
  { key: "holdAfterClose", kind: "switch", label: "Hold after close", hint: "The closed update stays up until you send the next one." },
  { key: "revealSplit", kind: "switch", label: "Show the vote split after close", hint: "Players see how their own team voted." },
  { key: "revealBest", kind: "switch", label: "Show the intended option after close", hint: "Off shows it only in the debrief." },
  { key: "individualMetrics", kind: "switch", label: "Individual metrics", hint: "Off keeps reports no-fault." },
  {
    key: "initialPath",
    kind: "select",
    label: "Starting path",
    options: [
      { value: "optimal", label: "On track" },
      { value: "degrading", label: "Under strain" },
      { value: "critical", label: "Escalating" },
    ],
  },
];

const DOCUMENT: ModeSetting[] = [
  { key: "scribeMode", kind: "switch", label: "Scribe mode", hint: "A scribe records the room. Players need no device." },
  {
    key: "moduleMinutes",
    kind: "number-select",
    label: "Minutes per module",
    hint: "Used when the advance policy is timer.",
    options: [
      { value: "", label: "Not timed" },
      ...[10, 15, 20, 25, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} minutes` })),
    ],
  },
];

const STRATEGIC: ModeSetting[] = [
  { key: "holdAfterClose", kind: "switch", label: "Hold after close", hint: "The closed update stays up until you send the next one." },
];

export const MODE_SETTINGS: Record<ExerciseInfo["mode"], ModeSetting[]> = {
  crisissim: CRISIS_SIM,
  document: DOCUMENT,
  strategic: STRATEGIC,
};

/** The settings to show for an exercise: known for the mode and present in its config. */
export function settingsFor(mode: ExerciseInfo["mode"], config: unknown): ModeSetting[] {
  const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  return (MODE_SETTINGS[mode] ?? []).filter((s) => {
    if (!(s.key in c)) return false;
    const v = c[s.key];
    switch (s.kind) {
      case "switch":
        return typeof v === "boolean";
      case "select":
        return typeof v === "string";
      case "number-select":
        return v === null || typeof v === "number";
    }
  });
}
