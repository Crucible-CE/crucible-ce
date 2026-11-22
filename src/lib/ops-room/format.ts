// Tiny relative-time formatter shared by the Ops Room readiness line and the
// onboarding checklist ("2 days ago"). Pure: the caller passes `now`.

export function formatAgo(at: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Whole days between two instants (floor). */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
