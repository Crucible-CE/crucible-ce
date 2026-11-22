// =============================================================================
// Crucible CE — Shared Redis Client Singleton
// =============================================================================
// Used by the rate limiter (src/lib/security/rate-limit.ts) and the health
// probe. Connection is lazy: the first caller that resolves `getRedis()`
// triggers the connect.
//
// Availability contract
// ---------------------
// - If REDIS_URL is unset, getRedis() resolves to `null`. Callers must treat
//   `null` as "no Redis state available" and apply a documented fallback
//   (in-process state for rate limits).
// - If the initial connect fails or times out, we cache the null and do NOT
//   retry for REDIS_RETRY_COOLDOWN_MS. This prevents every request during
//   a Redis outage from stacking up blocked connect attempts and exhausting
//   the event loop.
// - Once connected, the client manages its own reconnects per the
//   `reconnectStrategy` option. We never throw on a mid-flight disconnect.
// =============================================================================

import type { createClient as CreateClient } from "redis";

type RedisClient = ReturnType<typeof CreateClient>;

const globalForRedis = globalThis as unknown as {
  __crucibleCe_redis: RedisClient | null | undefined;
  __crucibleCe_redis_connecting: Promise<RedisClient | null> | undefined;
  __crucibleCe_redis_cooldownUntil: number | undefined;
};

const CONNECT_TIMEOUT_MS = 3000;
const RETRY_COOLDOWN_MS = 30_000;

// Namespace every key by NODE_ENV so a dev run pointed at the same Redis can't
// bleed rate-limit / lock state into production.
export const REDIS_PREFIX = process.env.NODE_ENV ?? "dev";
export function rkey(key: string): string {
  return `${REDIS_PREFIX}:${key}`;
}

export async function getRedis(): Promise<RedisClient | null> {
  if (!process.env.REDIS_URL) return null;

  const existing = globalForRedis.__crucibleCe_redis;
  if (existing && existing.isReady) return existing;

  // If a recent attempt failed, don't hammer Redis — return null until cooldown.
  if (
    globalForRedis.__crucibleCe_redis_cooldownUntil &&
    Date.now() < globalForRedis.__crucibleCe_redis_cooldownUntil
  ) {
    return null;
  }

  if (globalForRedis.__crucibleCe_redis_connecting) {
    return globalForRedis.__crucibleCe_redis_connecting;
  }

  globalForRedis.__crucibleCe_redis_connecting = (async () => {
    try {
      const { createClient } = await import("redis");
      const client = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: CONNECT_TIMEOUT_MS,
          reconnectStrategy: (retries) => (retries > 10 ? false : Math.min(retries * 200, 3000)),
        },
      });
      client.on("error", (err) => {
        console.warn("[redis] client error:", err instanceof Error ? err.message : err);
      });

      const timeoutSymbol = Symbol("redis-connect-timeout");
      const result = await Promise.race([
        client.connect().then(() => "ok" as const),
        new Promise<typeof timeoutSymbol>((resolve) =>
          setTimeout(() => resolve(timeoutSymbol), CONNECT_TIMEOUT_MS),
        ),
      ]);

      if (result !== "ok") {
        console.warn(`[redis] connect timed out after ${CONNECT_TIMEOUT_MS}ms`);
        client.disconnect().catch(() => {});
        globalForRedis.__crucibleCe_redis = null;
        globalForRedis.__crucibleCe_redis_cooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
        return null;
      }

      globalForRedis.__crucibleCe_redis = client;
      globalForRedis.__crucibleCe_redis_cooldownUntil = undefined;
      return client;
    } catch (err) {
      console.warn("[redis] connect failed:", err instanceof Error ? err.message : err);
      globalForRedis.__crucibleCe_redis = null;
      globalForRedis.__crucibleCe_redis_cooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
      return null;
    } finally {
      globalForRedis.__crucibleCe_redis_connecting = undefined;
    }
  })();

  return globalForRedis.__crucibleCe_redis_connecting;
}
