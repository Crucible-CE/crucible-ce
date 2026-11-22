// Side-effect module: registers the nightly readiness snapshot at boot.
// Imported from src/lib/exercise/runtime/jobs/handler-modules.ts. Runs under
// the CE cron lock (registerCron), so two processes never write it at once.
import { registerCron } from "@/lib/exercise/runtime/cron";
import { takeReadinessSnapshot } from "./snapshot";

const g = globalThis as typeof globalThis & { __ceReadinessCron?: boolean };

if (!g.__ceReadinessCron) {
  g.__ceReadinessCron = true;
  registerCron("readiness:snapshot", "30 2 * * *", async () => {
    const row = await takeReadinessSnapshot();
    if (row) console.log(`[cron] readiness snapshot ${row.day.toISOString().slice(0, 10)}: ${row.score}`);
  });
}

export {};
