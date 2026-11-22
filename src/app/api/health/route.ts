import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/db/redis";

const REDIS_PING_TIMEOUT_MS = 1000;

interface RedisProbe {
  /** REDIS_URL is set. */
  configured: boolean;
  /** Reachable (or not configured, since Redis is optional). */
  ok: boolean;
}

async function pingRedis(): Promise<RedisProbe> {
  if (!process.env.REDIS_URL) {
    // Redis is optional (rate limits fall back to in-process state); report
    // ok so installs without Redis don't see permanent 503s.
    return { configured: false, ok: true };
  }

  // The SHARED app client (lib/db/redis): a health probe must not open (and
  // tear down) a fresh connection per request — that's a cheap DoS lever.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = await getRedis();
    if (!client) return { configured: true, ok: false };
    await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("redis ping timeout")), REDIS_PING_TIMEOUT_MS);
      }),
    ]);
    return { configured: true, ok: true };
  } catch (err) {
    // Logged server-side only; the response never carries raw error text.
    console.error("[health] Redis ping failed:", err instanceof Error ? err.message : err);
    return { configured: true, ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const [dbResult, redisResult] = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,
    pingRedis(),
  ]);

  const dbOk = dbResult.status === "fulfilled";
  const redis: RedisProbe =
    redisResult.status === "fulfilled"
      ? redisResult.value
      : { configured: Boolean(process.env.REDIS_URL), ok: false };

  if (!dbOk) {
    console.error(
      "[health] Database connectivity check failed",
      (dbResult as PromiseRejectedResult).reason,
    );
  }
  if (!redis.ok) {
    console.error("[health] Redis connectivity check failed", redis);
  }

  // The container healthcheck gates whether the app counts as up, so it must
  // reflect only HARD dependencies. The database is hard: without it the app
  // cannot serve. Redis is SOFT (rate limiting falls back to in-process state)
  // so a Redis blip must NOT fail the healthcheck and trigger a restart loop.
  // Its status is still surfaced in the body as "degraded".
  const httpStatus = dbOk ? 200 : 503;
  const status = !dbOk ? "error" : redis.ok ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      database: dbOk ? "connected" : "disconnected",
      redis: redis.ok ? (redis.configured ? "connected" : "not-configured") : "disconnected",
    },
    { status: httpStatus },
  );
}
