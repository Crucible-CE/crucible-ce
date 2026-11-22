// =============================================================================
// Crucible CE — Distributed Rate Limiter
// =============================================================================
// Redis-backed sliding-window rate limiter. Used by:
//   - NextAuth credentials authorize() — login brute-force defense
//   - Public auth endpoints: register, forgot-password, resend-verification,
//     reset-password, verify-email
//
// Design
// ------
// Each limit is identified by a namespace + key (e.g. "login:ip" + ip-hash).
// The window is a Redis sorted set where each request is a member scored by
// its arrival timestamp. On each check we:
//   1. ZREMRANGEBYSCORE key -inf (now - windowMs)   — drop old entries
//   2. ZCARD key                                    — count within window
//   3. If count >= max: reject (do NOT add, so tripping the limit does not
//      extend it — this is the key property that prevents lockout spiral).
//   4. Otherwise: ZADD key now:<random> now; EXPIRE key windowMs*2
//
// Fail-open policy
// ----------------
// If Redis is unavailable, the limiter logs a warning and returns
// `{ allowed: true, count: 0, retryAfter: 0 }`. Rationale:
//   - Login still has bcrypt cost 12 (~250ms/attempt) slowing brute force.
//   - Failing closed means an outage locks every user out of the platform.
//   - Fail-open during outages is a documented and auditable trade-off.
// Every fail-open event logs a console warning so a Redis outage is
// *visible* rather than a silent removal of every rate limit.
// =============================================================================

import crypto from "node:crypto";
import { getRedis, rkey } from "@/lib/db/redis";
import { getClientIp } from "@/lib/security/client-ip";

export interface RateLimitOptions {
  /** Unique namespace for this limit (e.g. "login:ip", "register:ip"). */
  namespace: string;
  /** Caller-supplied identifier (IP, email, token ID). Hashed before use. */
  identifier: string;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed within the window. */
  max: number;
}

export interface RateLimitResult {
  /** True if the request is permitted. */
  allowed: boolean;
  /** Current count within the window (after this call, if allowed). */
  count: number;
  /** Seconds until the window resets if rejected. 0 if allowed. */
  retryAfter: number;
  /** True when the limiter is unavailable and we've failed open. */
  failOpen: boolean;
}

/**
 * Hash an identifier so raw IPs / emails do not appear in Redis keys or logs.
 * 12 hex chars is ample uniqueness for rate-limit buckets and keeps keys tidy.
 */
function hashIdentifier(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

function buildKey(namespace: string, identifier: string): string {
  return rkey(`rl:${namespace}:${hashIdentifier(identifier)}`);
}

/**
 * Read the current state of the sliding window without recording a hit.
 * Intended for the login flow, where we only want to count failed attempts —
 * peek first, bcrypt-compare, then {@link recordRateLimitHit} on failure.
 */
export async function peekRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const { namespace, identifier, windowMs, max } = opts;

  const client = await getRedis();
  if (!client) {
    console.warn(`[rate-limit] Redis unavailable; failing open for namespace=${namespace}`);
    return { allowed: true, count: 0, retryAfter: 0, failOpen: true };
  }

  const key = buildKey(namespace, identifier);
  const now = Date.now();
  const cutoff = now - windowMs;

  try {
    await client.zRemRangeByScore(key, "-inf", cutoff);
    const count = await client.zCard(key);

    if (count >= max) {
      const oldest = await client.zRangeWithScores(key, 0, 0);
      const oldestTs = oldest[0]?.score ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
      return { allowed: false, count, retryAfter, failOpen: false };
    }

    return { allowed: true, count, retryAfter: 0, failOpen: false };
  } catch (err) {
    console.warn(
      `[rate-limit] Redis error on namespace=${namespace}: ${err instanceof Error ? err.message : err}`,
    );
    return { allowed: true, count: 0, retryAfter: 0, failOpen: true };
  }
}

/**
 * Record a hit against the sliding window. Does not check the limit —
 * intended to be paired with {@link peekRateLimit} for login-style flows.
 * Always resolves; swallows Redis errors.
 */
export async function recordRateLimitHit(opts: RateLimitOptions): Promise<void> {
  const { namespace, identifier, windowMs } = opts;

  const client = await getRedis();
  if (!client) return;

  const key = buildKey(namespace, identifier);
  const now = Date.now();

  try {
    const member = `${now}:${crypto.randomBytes(6).toString("hex")}`;
    await client.zAdd(key, { score: now, value: member });
    await client.pExpire(key, windowMs * 2);
  } catch (err) {
    console.warn(
      `[rate-limit] Redis error recording hit on namespace=${namespace}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Check-and-record. Use for flows where every request counts (registration,
 * password-reset request, OTP send). For login-style flows where only
 * failures should count, use {@link peekRateLimit} + {@link recordRateLimitHit}.
 *
 * @returns RateLimitResult. Always resolves; never throws. Fails open on Redis
 *          errors or when REDIS_URL is unset.
 */
export async function checkRateLimit(opts: RateLimitOptions): Promise<RateLimitResult> {
  const peek = await peekRateLimit(opts);
  if (!peek.allowed || peek.failOpen) return peek;
  await recordRateLimitHit(opts);
  return { ...peek, count: peek.count + 1 };
}

/**
 * Derive a stable IP identifier from common proxy headers. Falls back to
 * "unknown" which collapses all unknown-origin traffic into a single bucket.
 * Safe to call with undefined — NextAuth may invoke authorize() without a
 * Request in non-HTTP contexts.
 */
export function ipFromRequest(
  req: Request | { headers: Headers } | undefined | null,
): string {
  // Lenient client-IP derivation (trusted XFF token, then x-real-ip). Collapses
  // to the shared "unknown" bucket when no trustworthy IP is available — which
  // only makes throttling stricter, never a bypass. See client-ip.ts.
  return getClientIp(req, "lenient") ?? "unknown";
}

export interface RateLimitReservation extends RateLimitResult {
  /** Give the reserved slot back (e.g. the attempt turned out to be a success). */
  release: () => Promise<void>;
}

/**
 * Reserve-first sliding window: ADD this attempt, then count. Over the limit
 * -> remove it again and refuse. Unlike peek-then-record, N concurrent
 * attempts can't all slip through between the check and the write (they may
 * all be refused, never all admitted). Used where every attempt is a guess
 * (second-factor codes, step-up). Fails open without Redis like the others;
 * callers that must hold without Redis add a database-backed cap.
 */
export async function reserveRateLimit(opts: RateLimitOptions): Promise<RateLimitReservation> {
  const noop = async () => {};
  const client = await getRedis();
  if (!client) return { allowed: true, count: 0, retryAfter: 0, failOpen: true, release: noop };
  const key = buildKey(opts.namespace, opts.identifier);
  const now = Date.now();
  const member = `${now}:${crypto.randomBytes(6).toString("hex")}`;
  try {
    await client.zRemRangeByScore(key, "-inf", now - opts.windowMs);
    await client.zAdd(key, { score: now, value: member });
    await client.pExpire(key, opts.windowMs * 2);
    const count = await client.zCard(key);
    const release = async () => {
      try {
        await client.zRem(key, member);
      } catch {
        // best-effort
      }
    };
    if (count > opts.max) {
      await release();
      const oldest = await client.zRangeWithScores(key, 0, 0);
      const retryAfter = Math.max(1, Math.ceil(((oldest[0]?.score ?? now) + opts.windowMs - now) / 1000));
      return { allowed: false, count: count - 1, retryAfter, failOpen: false, release: noop };
    }
    return { allowed: true, count, retryAfter: 0, failOpen: false, release };
  } catch (err) {
    console.warn(`[rate-limit] Redis error on namespace=${opts.namespace}: ${err instanceof Error ? err.message : err}`);
    return { allowed: true, count: 0, retryAfter: 0, failOpen: true, release: noop };
  }
}
