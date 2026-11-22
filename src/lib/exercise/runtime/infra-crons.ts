// Housekeeping crons for exercises (not exercise logic).
import { db } from "@/lib/db";
import { registerCron } from "./cron";
import { reclaimExpiredJobs } from "./jobs/worker";

export function registerInfraCrons(): void {
  // Expired guest sessions. Rate limits live in Redis and expire on their own.
  registerCron("infra:sweep", "*/10 * * * *", async () => {
    const guests = await db.guestSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (guests.count > 0) console.log(`[cron] swept ${guests.count} guest session(s)`);
  });
  // Backstop for job leases (the worker also reclaims every 30 s).
  registerCron("infra:jobs-reclaim", "* * * * *", async () => {
    await reclaimExpiredJobs();
  });
}
