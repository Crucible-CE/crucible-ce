// Regulatory clock math. Pure.

/** Deadline from a scenario start: N hours, or N business days skipping weekends (UTC). */
export function clockDeadline(start: Date, hours: number | null, businessDays: number | null): Date | null {
  if (hours) return new Date(start.getTime() + hours * 3_600_000);
  if (businessDays) {
    const d = new Date(start.getTime());
    let left = businessDays;
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) left--;
    }
    return d;
  }
  return null;
}
