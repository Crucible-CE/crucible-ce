import { INCIDENT_STATUSES, statusRank } from "./status";

export type StageState = "done" | "active" | "skipped" | "upcoming";

export interface StatusHistoryEntry {
  action: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Per-stage state for the lifecycle bar. A stage is "done" only if the
 * incident actually passed through it (from/to of status_changed events);
 * earlier stages it never entered are "skipped". With no status history at
 * all (legacy rows) the lifecycle is assumed linear.
 */
export function deriveStageStates(
  current: string,
  history: readonly StatusHistoryEntry[],
): { stage: (typeof INCIDENT_STATUSES)[number]; state: StageState }[] {
  const currentIdx = statusRank(current);
  const visited = new Set<string>(["open", current]);
  let hasHistory = false;
  for (const e of history) {
    if (e.action !== "status_changed") continue;
    const from = e.metadata?.from;
    const to = e.metadata?.to;
    if (typeof from !== "string" || typeof to !== "string") continue;
    hasHistory = true;
    visited.add(from);
    visited.add(to);
  }
  return INCIDENT_STATUSES.map((stage, i) => {
    if (i === currentIdx) return { stage, state: "active" as const };
    if (i > currentIdx) return { stage, state: "upcoming" as const };
    return {
      stage,
      state: !hasHistory || visited.has(stage) ? ("done" as const) : ("skipped" as const),
    };
  });
}
