// Durable job queue on the Job table (outbox pattern).
//
//   await db.$transaction(async (tx) => {
//     ...state change...
//     await enqueueJob(tx, { kind: "grade_response", key: `grade:${responseId}:1`, payload: { responseId } });
//   });
//   kickWorker();   // after commit, to run it now instead of on the next poll
//
// Idempotent on `key`: enqueueing the same key twice keeps the first job.
// Handlers must be idempotent too: a job can run more than once if a worker
// dies after the handler finished but before the job was marked done.

import type { Job, Prisma } from "@prisma/client";
import type { DbClient } from "@/lib/db";

export interface EnqueueInput {
  kind: string;
  /** Idempotency key, unique across all jobs. */
  key: string;
  /** JSON-serializable payload. */
  payload?: Prisma.InputJsonValue | Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}

/** Insert the job unless one with the same key exists. Resolves true when a row was created. */
export async function enqueueJob(client: DbClient, input: EnqueueInput): Promise<boolean> {
  if (!input.kind || input.kind.length > 100) throw new Error("job kind is required (max 100 chars)");
  if (!input.key || input.key.length > 500) throw new Error("job key is required (max 500 chars)");
  const res = await client.job.createMany({
    data: [
      {
        kind: input.kind,
        key: input.key,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        runAfter: input.runAfter ?? new Date(),
        maxAttempts: Math.max(1, Math.min(input.maxAttempts ?? 3, 20)),
      },
    ],
    skipDuplicates: true,
  });
  return res.count === 1;
}

export type JobHandler = (payload: unknown, job: Job) => Promise<void>;

const KEY = Symbol.for("crucible.ce.exercise.jobHandlers");
type Holder = { [KEY]?: Map<string, JobHandler> };

function handlers(): Map<string, JobHandler> {
  const g = globalThis as Holder;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY];
}

/** Register the handler for a job kind. Replaces any previous handler for that kind. */
export function registerJobHandler(kind: string, handler: JobHandler): void {
  handlers().set(kind, handler);
}

export function getJobHandler(kind: string): JobHandler | undefined {
  return handlers().get(kind);
}

/** Test hook. */
export function clearJobHandlers(): void {
  handlers().clear();
}

/** Wake the worker now (after enqueueing). A no-op when no worker runs in this process. */
export function kickWorker(): void {
  const kick = (globalThis as { __ceExKickWorker?: () => void }).__ceExKickWorker;
  kick?.();
}
