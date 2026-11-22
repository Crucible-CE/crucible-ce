// Ops Room SLA headline (pure, client-safe): the one response-SLA milestone
// that matters most for an incident right now. The loader that computes the
// statuses lives in ./sla-summary (server only).

import type { SlaStatus } from "@/lib/incident/sla";

export type SlaHeadlineState = "breached" | "at_risk" | "on_track" | "met" | "none";

export interface SlaHeadline {
  state: SlaHeadlineState;
  /** Milestone label ("Contain", ...) for an open milestone; null otherwise. */
  label: string | null;
  /** ISO deadline of that milestone (drives the live countdown). */
  deadline: string | null;
  /** Minutes left at compute time (negative = overdue). */
  remainingMinutes: number | null;
}

const NONE: SlaHeadline = { state: "none", label: null, deadline: null, remainingMinutes: null };

/**
 * Most urgent OPEN milestone first: the most overdue breach, else the nearest
 * at-risk deadline, else the nearest on-track deadline. With nothing open: "met"
 * when at least one tracked milestone was completed, else "none".
 */
export function summarizeSla(statuses: SlaStatus[]): SlaHeadline {
  const open = statuses.filter(
    (s) => (s.state === "breached" || s.state === "at_risk" || s.state === "on_track") && s.remainingMinutes !== null,
  );
  const rank = { breached: 0, at_risk: 1, on_track: 2 } as const;
  open.sort((a, b) => {
    const r = rank[a.state as keyof typeof rank] - rank[b.state as keyof typeof rank];
    return r !== 0 ? r : (a.remainingMinutes ?? 0) - (b.remainingMinutes ?? 0);
  });
  const top = open[0];
  if (top) {
    return {
      state: top.state as SlaHeadlineState,
      label: top.label,
      deadline: top.deadline,
      remainingMinutes: top.remainingMinutes,
    };
  }
  if (statuses.some((s) => s.state === "met" || s.state === "met_late")) return { ...NONE, state: "met" };
  return NONE;
}

/** "45m" / "3h 12m" / "2d 4h" for a (possibly negative) minute count; sign dropped. */
export function formatMinutes(minutes: number): string {
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Human line for a headline: "Contain due in 3h 12m" / "Acknowledge overdue 25m". */
export function slaHeadlineText(h: SlaHeadline, remainingMinutes: number | null = h.remainingMinutes): string | null {
  if (h.state === "met") return "SLAs met";
  if (!h.label || remainingMinutes === null) return null;
  if (remainingMinutes < 0) return `${h.label} overdue ${formatMinutes(remainingMinutes)}`;
  return `${h.label} due in ${formatMinutes(remainingMinutes)}`;
}
