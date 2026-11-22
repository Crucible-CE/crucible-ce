// Duration/elapsed-time formatting helpers, shared by regulatory-clock and
// incident-age displays. Pure functions of (from, to) — no Date.now() reads
// baked in, so callers can drive them from a ticking clock (see use-now.ts).
//

function toMs(v: Date | string): number {
  return v instanceof Date ? v.getTime() : new Date(v).getTime();
}

/** Hours between two instants (to - from), as a float. Negative if `to` precedes `from`. */
export function hoursBetween(from: Date | string, to: Date | string): number {
  return (toMs(to) - toMs(from)) / 3_600_000;
}

/**
 * "12h 30m left" / "OVERDUE" for a regulatory-style countdown, given the
 * deadline (in hours from the anchor) and hours already elapsed.
 */
export function formatRemaining(deadlineHours: number, elapsedHours: number): string {
  if (elapsedHours > deadlineHours) return "OVERDUE";
  const remaining = Math.max(deadlineHours - elapsedHours, 0);
  const h = Math.floor(remaining);
  const m = Math.round((remaining % 1) * 60);
  return `${h}h ${m}m left`;
}

/** "2d 3h" / "3h 12m" elapsed between two instants (ms epoch or Date/string). */
export function formatElapsed(fromMs: number | Date | string, nowMs: number | Date | string): string {
  const from = typeof fromMs === "number" ? fromMs : toMs(fromMs);
  const now = typeof nowMs === "number" ? nowMs : toMs(nowMs);
  const ms = Math.max(now - from, 0);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}
