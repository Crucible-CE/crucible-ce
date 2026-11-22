// Job worker. One per process (single-node install).
//
//   claim     UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)
//             sets status=running, attempts+1, lockedUntil=now()+lease
//   success   status=done          (only if this lease still owns the job)
//   failure   status=queued with backoff, or failed after maxAttempts
//   reclaim   running jobs whose lease passed go back to queued (or failed)
//
// Completion is guarded on (id, status=running, attempts): a job reclaimed
// and re-claimed by another lease cannot be finished by the stale one.

import type { Job } from "@prisma/client";
import { db } from "@/lib/db";
import { getJobHandler } from "./queue";

export { kickWorker } from "./queue";

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_POLL_MS = 2_000;
const RECLAIM_EVERY_MS = 30_000;
const MAX_ERROR_CHARS = 2_000;

/** Backoff before attempt n+1: 10 s, 20 s, 40 s ... capped at 10 min. */
export function backoffMs(attempts: number): number {
  return Math.min(10 * 60 * 1000, 10_000 * 2 ** Math.max(0, attempts - 1));
}

/** Claim the next due job, or null. */
export async function claimNextJob(leaseMs: number = DEFAULT_LEASE_MS): Promise<Job | null> {
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job"
       SET "status" = 'running',
           "lockedUntil" = now() + (${leaseMs}::int * interval '1 millisecond'),
           "attempts" = "attempts" + 1,
           "updatedAt" = now()
     WHERE "id" = (
       SELECT "id" FROM "Job"
        WHERE "status" = 'queued' AND "runAfter" <= now()
        ORDER BY "runAfter"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
     RETURNING *`;
  return rows[0] ?? null;
}

/** Return expired leases to the queue (or fail them when out of attempts). Returns rows touched. */
export async function reclaimExpiredJobs(): Promise<number> {
  const failed = await db.$executeRaw`
    UPDATE "Job"
       SET "status" = 'failed', "lockedUntil" = NULL, "updatedAt" = now(),
           "lastError" = COALESCE("lastError", '') || ' [lease expired]'
     WHERE "status" = 'running' AND "lockedUntil" < now() AND "attempts" >= "maxAttempts"`;
  const requeued = await db.$executeRaw`
    UPDATE "Job"
       SET "status" = 'queued', "lockedUntil" = NULL, "runAfter" = now(), "updatedAt" = now()
     WHERE "status" = 'running' AND "lockedUntil" < now() AND "attempts" < "maxAttempts"`;
  return failed + requeued;
}

async function markDone(job: Job): Promise<void> {
  await db.job.updateMany({
    where: { id: job.id, status: "running", attempts: job.attempts },
    data: { status: "done", lockedUntil: null, lastError: null },
  });
}

async function markFailed(job: Job, err: unknown): Promise<void> {
  const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, MAX_ERROR_CHARS);
  const outOfAttempts = job.attempts >= job.maxAttempts;
  await db.job.updateMany({
    where: { id: job.id, status: "running", attempts: job.attempts },
    data: outOfAttempts
      ? { status: "failed", lockedUntil: null, lastError: message }
      : { status: "queued", lockedUntil: null, lastError: message, runAfter: new Date(Date.now() + backoffMs(job.attempts)) },
  });
}

/** Run one claimed job through its handler. */
export async function runJob(job: Job): Promise<"done" | "failed"> {
  const handler = getJobHandler(job.kind);
  if (!handler) {
    // No handler means it can never succeed here: fail it outright.
    await db.job.updateMany({
      where: { id: job.id, status: "running", attempts: job.attempts },
      data: { status: "failed", lockedUntil: null, lastError: `No handler registered for job kind "${job.kind}"` },
    });
    console.error(`[jobs] no handler for kind ${job.kind} (job ${job.id})`);
    return "failed";
  }
  // Heartbeat: keep the lease while the handler runs, so a long job (template
  // generation) is never reclaimed and run twice. A dead process stops
  // beating and its job comes back after one lease.
  const heartbeat = setInterval(() => {
    void db.job
      .updateMany({
        where: { id: job.id, status: "running", attempts: job.attempts },
        data: { lockedUntil: new Date(Date.now() + HEARTBEAT_LEASE_MS) },
      })
      .catch(() => undefined);
  }, HEARTBEAT_EVERY_MS);
  if (typeof heartbeat === "object" && "unref" in heartbeat) heartbeat.unref();
  try {
    await handler(job.payload, job);
    await markDone(job);
    return "done";
  } catch (err) {
    console.error(`[jobs] ${job.kind} ${job.id} attempt ${job.attempts} failed:`, err instanceof Error ? err.message : err);
    await markFailed(job, err);
    return "failed";
  } finally {
    clearInterval(heartbeat);
  }
}

const HEARTBEAT_EVERY_MS = 60_000;
const HEARTBEAT_LEASE_MS = 3 * 60_000;
export const DEFAULT_CONCURRENCY = 4;

/**
 * Claim and run jobs until none is due, up to `concurrency` at a time.
 * Returns how many ran. For tests and the poll loop.
 */
export async function runDueJobs(opts: { leaseMs?: number; max?: number; concurrency?: number } = {}): Promise<number> {
  const max = opts.max ?? 100;
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  let ran = 0;
  const lane = async () => {
    while (ran < max) {
      const job = await claimNextJob(opts.leaseMs);
      if (!job) return;
      ran++;
      await runJob(job);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return ran;
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

interface WorkerState {
  running: boolean;
  busy: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  lastReclaim: number;
  pollMs: number;
  leaseMs: number;
  inFlight: number;
}

const g = globalThis as typeof globalThis & { __ceExJobWorker?: WorkerState; __ceExKickWorker?: () => void };

async function tick(state: WorkerState): Promise<void> {
  if (!state.running) return;
  if (state.busy) {
    state.again = true;
    return;
  }
  state.busy = true;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  try {
    if (Date.now() - state.lastReclaim >= RECLAIM_EVERY_MS) {
      state.lastReclaim = Date.now();
      const n = await reclaimExpiredJobs();
      if (n > 0) console.warn(`[jobs] reclaimed ${n} job(s) with an expired lease`);
    }
    // Dispatch without waiting for jobs to finish: claim while slots are free.
    // A finishing job frees its slot and kicks the next tick.
    do {
      state.again = false;
      while (state.running && state.inFlight < DEFAULT_CONCURRENCY) {
        const job = await claimNextJob(state.leaseMs);
        if (!job) break;
        state.inFlight++;
        void runJob(job).finally(() => {
          state.inFlight--;
          if (state.running) void tick(state);
        });
      }
    } while (state.again && state.running);
  } catch (err) {
    console.error("[jobs] worker tick failed:", err instanceof Error ? err.message : err);
  } finally {
    state.busy = false;
    if (state.running) state.timer = setTimeout(() => void tick(state), state.pollMs);
  }
}

/** Start the poll loop (idempotent). */
export function startJobWorker(opts: { pollMs?: number; leaseMs?: number } = {}): void {
  if (g.__ceExJobWorker?.running) return;
  const state: WorkerState = {
    running: true,
    busy: false,
    again: false,
    timer: null,
    lastReclaim: 0,
    pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
    leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
    inFlight: 0,
  };
  g.__ceExJobWorker = state;
  g.__ceExKickWorker = () => void tick(state);
  void tick(state);
}

/** Stop polling. Resolves once an in-flight tick has finished. */
export async function stopJobWorker(): Promise<void> {
  const state = g.__ceExJobWorker;
  if (!state) return;
  state.running = false;
  if (state.timer) clearTimeout(state.timer);
  delete g.__ceExKickWorker;
  for (let i = 0; i < 300 && (state.busy || state.inFlight > 0); i++) await new Promise((r) => setTimeout(r, 100));
}
