// @vitest-environment node
// Job queue + worker against Postgres (ttx_test).
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { clearJobHandlers, enqueueJob, registerJobHandler } from "./queue";
import { backoffMs, claimNextJob, reclaimExpiredJobs, runDueJobs, runJob } from "./worker";

describe.skipIf(!hasTestDb)("jobs (integration)", () => {
  beforeEach(async () => {
    await truncate("Job");
    clearJobHandlers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterAll(async () => {
    clearJobHandlers();
    await db.$disconnect();
  });

  it("enqueue is idempotent on key, inside a transaction too", async () => {
    expect(await enqueueJob(db, { kind: "k", key: "a", payload: { n: 1 } })).toBe(true);
    expect(await enqueueJob(db, { kind: "k", key: "a", payload: { n: 2 } })).toBe(false);
    await db.$transaction(async (tx) => {
      expect(await enqueueJob(tx, { kind: "k", key: "b" })).toBe(true);
      expect(await enqueueJob(tx, { kind: "k", key: "b" })).toBe(false);
    });
    const jobs = await db.job.findMany({ orderBy: { key: "asc" } });
    expect(jobs.map((j) => [j.key, j.payload])).toEqual([
      ["a", { n: 1 }],
      ["b", {}],
    ]);
  });

  it("a rolled-back transaction enqueues nothing (outbox)", async () => {
    await db
      .$transaction(async (tx) => {
        await enqueueJob(tx, { kind: "k", key: "rolled" });
        throw new Error("rollback");
      })
      .catch(() => {});
    expect(await db.job.count()).toBe(0);
  });

  it("runs a job through its handler and marks it done", async () => {
    const seen: unknown[] = [];
    registerJobHandler("echo", async (payload) => {
      seen.push(payload);
    });
    await enqueueJob(db, { kind: "echo", key: "e1", payload: { hello: "world" } });
    expect(await runDueJobs()).toBe(1);
    expect(seen).toEqual([{ hello: "world" }]);
    expect(await db.job.findUniqueOrThrow({ where: { key: "e1" } })).toMatchObject({ status: "done", attempts: 1, lockedUntil: null });
  });

  it("does not run jobs before runAfter", async () => {
    registerJobHandler("later", async () => {});
    await enqueueJob(db, { kind: "later", key: "l1", runAfter: new Date(Date.now() + 60_000) });
    expect(await runDueJobs()).toBe(0);
  });

  it("a failure requeues with backoff, then fails after maxAttempts", async () => {
    registerJobHandler("flaky", async () => {
      throw new Error("nope");
    });
    await enqueueJob(db, { kind: "flaky", key: "f1", maxAttempts: 2 });
    expect(await runDueJobs()).toBe(1);
    let job = await db.job.findUniqueOrThrow({ where: { key: "f1" } });
    expect(job).toMatchObject({ status: "queued", attempts: 1, lastError: "Error: nope" });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + backoffMs(1) - 2_000);
    await db.job.update({ where: { key: "f1" }, data: { runAfter: new Date() } });
    expect(await runDueJobs()).toBe(1);
    job = await db.job.findUniqueOrThrow({ where: { key: "f1" } });
    expect(job).toMatchObject({ status: "failed", attempts: 2 });
  });

  it("a job with no handler fails outright", async () => {
    await enqueueJob(db, { kind: "unknown", key: "u1" });
    await runDueJobs();
    expect(await db.job.findUniqueOrThrow({ where: { key: "u1" } })).toMatchObject({ status: "failed" });
  });

  it("concurrent claimers never claim the same job (FOR UPDATE SKIP LOCKED)", async () => {
    for (let i = 0; i < 12; i++) await enqueueJob(db, { kind: "c", key: `c${i}` });
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimNextJob()));
    const ids = claims.filter((j) => j !== null).map((j) => j!.id);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it("job lease survives a crash: an expired lease is reclaimed and rerun", async () => {
    const runs: number[] = [];
    registerJobHandler("crashy", async (_p, job) => {
      runs.push(job.attempts);
    });
    await enqueueJob(db, { kind: "crashy", key: "cr1", maxAttempts: 3 });
    // Worker A claims with a tiny lease and "crashes" (never finishes).
    const claimed = await claimNextJob(1);
    expect(claimed?.status).toBe("running");
    await new Promise((r) => setTimeout(r, 20));
    expect(await reclaimExpiredJobs()).toBe(1);
    expect(await db.job.findUniqueOrThrow({ where: { key: "cr1" } })).toMatchObject({ status: "queued", attempts: 1 });
    // Worker B picks it up and finishes it.
    expect(await runDueJobs()).toBe(1);
    expect(runs).toEqual([2]);
    // The crashed lease cannot mark it done or failed any more.
    await runJob(claimed!);
    expect(await db.job.findUniqueOrThrow({ where: { key: "cr1" } })).toMatchObject({ status: "done", attempts: 2 });
  });

  it("an expired lease with no attempts left is failed, not rerun", async () => {
    await enqueueJob(db, { kind: "x", key: "x1", maxAttempts: 1 });
    await claimNextJob(1);
    await new Promise((r) => setTimeout(r, 20));
    await reclaimExpiredJobs();
    expect(await db.job.findUniqueOrThrow({ where: { key: "x1" } })).toMatchObject({ status: "failed" });
  });
});
