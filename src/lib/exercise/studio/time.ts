// Scenario time labels for Studio nodes. Pure.

import { anchoredTime } from "@/lib/exercise/modes/crisissim/schema";

/** "T+0", "T+45m", "T+6h 10m", "T+1d 2h". */
export function formatOffset(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m === 0) return "T+0";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  const parts = [d ? `${d}d` : "", h ? `${h}h` : "", r && !d ? `${r}m` : ""].filter(Boolean);
  return `T+${parts.join(" ") || "0"}`;
}

/** "Day 1, Tuesday 05:20" from the template anchor, or null when no anchor is set. */
export function absoluteTime(anchor: { weekday: number; time: string } | null | undefined, offsetMin: number): string | null {
  if (!anchor || !/^\d\d:\d\d$/.test(anchor.time)) return null;
  const [h, mm] = anchor.time.split(":").map(Number);
  const start = h * 60 + mm;
  const day = Math.floor((start + Math.max(0, Math.round(offsetMin))) / 1440) + 1;
  return `Day ${day}, ${anchoredTime(anchor, offsetMin).label}`;
}
