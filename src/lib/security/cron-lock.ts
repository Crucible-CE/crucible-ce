// Single-flight lock for cron jobs running inside the custom Node server.
// A cron body that runs longer than its interval (or overlaps with the dev
// socket sidecar's copy of the same cron) must not run twice at once, so each
// body claims a Redis lock first. SET NX EX gives atomic acquisition with a
// TTL safety net so a crashed process never holds the lock forever.
//
// If REDIS_URL is unset, or Redis errors, the lock degrades to a process-local
// Set, which still prevents this process running the same job twice if cron
// timing skews. That is correct for CE, which runs as a single process.

import { createClient, type RedisClientType } from "redis";
import { rkey } from "@/lib/db/redis";

let redisPromise: Promise<RedisClientType> | null = null;
const localLocks = new Set<string>();

function getRedis(): Promise<RedisClientType> | null {
  if (!process.env.REDIS_URL) return null;
  if (!redisPromise) {
    const client: RedisClientType = createClient({ url: process.env.REDIS_URL });
    client.on("error", (err) => {
      console.warn("[cron-lock] Redis client error:", err?.message ?? err);
    });
    redisPromise = client.connect().then(() => client);
  }
  return redisPromise;
}

export async function withCronLock(
  name: string,
  ttlSeconds: number,
  body: () => Promise<void>,
): Promise<void> {
  const key = rkey(`cron:lock:${name}`);
  const redis = getRedis();

  if (redis) {
    try {
      const client = await redis;
      const ok = await client.set(key, String(Date.now()), { NX: true, EX: ttlSeconds });
      if (ok !== "OK") {
        return;
      }
      try {
        await body();
      } finally {
        await client.del(key).catch(() => {});
      }
      return;
    } catch (err) {
      console.warn(
        `[cron-lock] Redis unavailable for "${name}"; using the in-process lock:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (localLocks.has(key)) return;
  localLocks.add(key);
  try {
    await body();
  } finally {
    localLocks.delete(key);
  }
}
