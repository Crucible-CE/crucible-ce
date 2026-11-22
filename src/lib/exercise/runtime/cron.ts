// Cron registry for exercise work. Every tick runs inside the CE cron lock
// (Redis SET NX, or a process-local lock without Redis), so a tick that
// overlaps the next one is skipped instead of running twice.
//
//   registerCron("timers-sweep", "* * * * *", async () => { ... });
//
// Crons registered before startCrons() are scheduled when it runs; later
// registrations are scheduled immediately.

import cron, { type ScheduledTask } from "node-cron";
import { withCronLock } from "@/lib/security/cron-lock";

export type CronFn = () => Promise<void>;

interface CronEntry {
  name: string;
  schedule: string;
  fn: CronFn;
  task: ScheduledTask | null;
}

interface CronState {
  started: boolean;
  entries: Map<string, CronEntry>;
}

const g = globalThis as typeof globalThis & { __ceExCrons?: CronState };

function state(): CronState {
  if (!g.__ceExCrons) g.__ceExCrons = { started: false, entries: new Map() };
  return g.__ceExCrons;
}

/** Lock lifetime: long enough for a slow tick, short enough to recover from a crash. */
const LOCK_TTL_SECONDS = 300;

/** Run one tick under the cron lock. Resolves true when the body ran. Errors are logged, never thrown. */
export async function runCronTick(name: string, fn: CronFn): Promise<boolean> {
  try {
    let ran = false;
    await withCronLock(`exercise:${name}`, LOCK_TTL_SECONDS, async () => {
      ran = true;
      await fn();
    });
    return ran;
  } catch (err) {
    console.error(`[cron] ${name} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

function schedule(entry: CronEntry): void {
  entry.task = cron.schedule(entry.schedule, () => {
    void runCronTick(entry.name, entry.fn);
  });
}

export function registerCron(name: string, scheduleExpr: string, fn: CronFn): void {
  if (!cron.validate(scheduleExpr)) throw new Error(`Invalid cron schedule for ${name}: ${scheduleExpr}`);
  const s = state();
  const existing = s.entries.get(name);
  if (existing?.task) void existing.task.stop();
  const entry: CronEntry = { name, schedule: scheduleExpr, fn, task: null };
  s.entries.set(name, entry);
  if (s.started) schedule(entry);
}

export function startCrons(): number {
  const s = state();
  if (s.started) return s.entries.size;
  s.started = true;
  for (const entry of s.entries.values()) schedule(entry);
  return s.entries.size;
}

export function stopCrons(): void {
  const s = state();
  for (const entry of s.entries.values()) {
    if (entry.task) void entry.task.stop();
    entry.task = null;
  }
  s.started = false;
}
