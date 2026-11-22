// Roll recurring schedule entries forward once an occurrence has ended.
// Bounded scan, one atomic compare-and-swap per row (claimOne on the old
// nextAt) so a tick never rolls the same occurrence twice, per-row try/catch.
// The entry keeps one row and nextAt moves.
// Exercises are never started automatically.

import { db } from "@/lib/db";
import { claimOne } from "@/lib/db/atomic-claim";
import { registerCron } from "@/lib/exercise/runtime/cron";
import { currentOccurrence, parseRrule } from "./recurrence";

const SCAN_TAKE = 200;

export async function advanceSchedules(now: Date = new Date()): Promise<{ rolled: number; skipped: number }> {
  let rolled = 0;
  let skipped = 0;
  const rows = await db.exerciseSchedule.findMany({
    where: { isActive: true, rrule: { not: null }, nextAt: { lt: now } },
    select: { id: true, rrule: true, nextAt: true, durationMin: true },
    orderBy: { nextAt: "asc" },
    take: SCAN_TAKE,
  });
  for (const s of rows) {
    try {
      if (!s.nextAt || s.nextAt.getTime() + s.durationMin * 60_000 > now.getTime()) continue;
      const rule = parseRrule(s.rrule);
      if (!rule) {
        skipped++;
        continue;
      }
      const next = currentOccurrence(rule, now, s.durationMin);
      if (next.getTime() === s.nextAt.getTime()) continue;
      const won = await claimOne(db.exerciseSchedule.updateMany({ where: { id: s.id, nextAt: s.nextAt }, data: { nextAt: next } }));
      if (won) rolled++;
    } catch (err) {
      skipped++;
      console.error(`[schedule] could not advance ${s.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return { rolled, skipped };
}

/** Called once from src/runtime/boot.ts. */
export function registerScheduleCrons(): void {
  registerCron("schedule:advance", "*/15 * * * *", async () => {
    const r = await advanceSchedules();
    if (r.rolled + r.skipped > 0) console.log(`[cron] schedule: rolled ${r.rolled}, skipped ${r.skipped}`);
  });
}
