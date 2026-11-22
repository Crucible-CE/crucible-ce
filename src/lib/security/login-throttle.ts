// =============================================================================
// Login brute-force throttle (credentials sign-in).
// =============================================================================
// Replaces the old hard per-email lock (5 failures -> 15 min locked out, which
// let anyone lock any user out by typing their email five times). Three gates,
// all counting FAILED attempts only, all in Redis sorted sets (one member per
// failure, scored by time):
//
//   1. per client IP      hard cap: LOGIN_IP_MAX failures / 15 min. Applies to
//                         EVERY attempt, trusted device or not.
//   2. per email + IP     progressive delay: after PAIR_FREE failures in the
//                         last hour the next attempt must wait 2^(n-PAIR_FREE)
//                         seconds after the most recent failure, capped at
//                         MAX_DELAY_SEC (15 min).
//   3. per email (any IP) the same progressive delay with a higher free
//                         allowance (EMAIL_FREE), so a botnet spreading guesses
//                         over many IPs still slows down per account.
//
// Gates 2 and 3 are skipped for a TRUSTED DEVICE: a browser holding a valid
// signed device cookie (src/lib/auth/known-device.ts) for the account it is
// signing in to, i.e. one that signed in successfully before. An attacker
// hammering an account cannot lock its owner out; the owner's own browser
// still gets in with the right password. Gate 1 still applies.
//
// Admins can clear gates 2 and 3 for a user (POST /api/admin/users/[id]/unlock
// -> clearLoginThrottleForEmail).
//
// Behind a reverse proxy TRUSTED_PROXY_HOPS must be set (see
// docs/reverse-proxy.md): otherwise every client shares the proxy's IP, so
// gate 1 is one bucket for the whole install and gate 2 degrades to gate 3.
//
// Fail-open without Redis, like every other limiter (rate-limit.ts): bcrypt
// cost 12 still bounds the guess rate.
// =============================================================================

import crypto from "node:crypto";
import { getRedis, rkey } from "@/lib/db/redis";

export const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_MAX = 20;
export const LOGIN_BACKOFF_WINDOW_MS = 60 * 60 * 1000;
export const PAIR_FREE = 5;
export const EMAIL_FREE = 20;
export const MAX_DELAY_SEC = 15 * 60;

export type LoginGate = "ip" | "pair" | "email";

export interface LoginThrottleResult {
  allowed: boolean;
  /** Seconds until the blocking gate opens (0 when allowed). */
  retryAfter: number;
  /** Which gate refused the attempt. */
  gate?: LoginGate;
}

/** Required wait (seconds) after the latest failure, given `failures` in the window. */
export function backoffSeconds(failures: number, free: number, capSec: number = MAX_DELAY_SEC): number {
  if (failures < free) return 0;
  const exp = failures - free;
  if (exp >= 30) return capSec; // 2^30 s is far past any cap
  return Math.min(2 ** exp, capSec);
}

const h = (v: string) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 16);
const normEmail = (email: string) => email.toLowerCase().trim();

const ipKey = (ip: string) => rkey(`rl:login:ip:${h(ip)}`);
const emailKey = (email: string) => rkey(`rl:login:email:${h(normEmail(email))}`);
const pairPrefix = (email: string) => rkey(`rl:login:pair:${h(normEmail(email))}:`);
const pairKey = (email: string, ip: string) => `${pairPrefix(email)}${h(ip)}`;

type Redis = NonNullable<Awaited<ReturnType<typeof getRedis>>>;

async function windowState(client: Redis, key: string, windowMs: number, now: number) {
  await client.zRemRangeByScore(key, "-inf", now - windowMs);
  const count = await client.zCard(key);
  if (count === 0) return { count, oldest: now, newest: now };
  const [oldest] = await client.zRangeWithScores(key, 0, 0);
  const [newest] = await client.zRangeWithScores(key, -1, -1);
  return { count, oldest: oldest?.score ?? now, newest: newest?.score ?? now };
}

function backoffGate(
  state: { count: number; newest: number },
  free: number,
  now: number,
): number {
  const wait = backoffSeconds(state.count, free);
  if (wait === 0) return 0;
  const remainingMs = state.newest + wait * 1000 - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Decide whether a sign-in attempt may proceed. Never throws; fails open
 * (allowed) when Redis is unavailable.
 */
export async function checkLoginThrottle(input: {
  email: string;
  ip: string;
  trustedDevice: boolean;
  now?: number;
}): Promise<LoginThrottleResult> {
  const client = await getRedis();
  if (!client) return { allowed: true, retryAfter: 0 };
  const now = input.now ?? Date.now();
  try {
    const ip = await windowState(client, ipKey(input.ip), LOGIN_IP_WINDOW_MS, now);
    if (ip.count >= LOGIN_IP_MAX) {
      return {
        allowed: false,
        gate: "ip",
        retryAfter: Math.max(1, Math.ceil((ip.oldest + LOGIN_IP_WINDOW_MS - now) / 1000)),
      };
    }
    if (input.trustedDevice) return { allowed: true, retryAfter: 0 };

    const pair = await windowState(client, pairKey(input.email, input.ip), LOGIN_BACKOFF_WINDOW_MS, now);
    const pairWait = backoffGate(pair, PAIR_FREE, now);
    if (pairWait > 0) return { allowed: false, gate: "pair", retryAfter: pairWait };

    const email = await windowState(client, emailKey(input.email), LOGIN_BACKOFF_WINDOW_MS, now);
    const emailWait = backoffGate(email, EMAIL_FREE, now);
    if (emailWait > 0) return { allowed: false, gate: "email", retryAfter: emailWait };

    return { allowed: true, retryAfter: 0 };
  } catch (err) {
    console.warn(`[login-throttle] Redis error; failing open: ${err instanceof Error ? err.message : err}`);
    return { allowed: true, retryAfter: 0 };
  }
}

async function addHit(client: Redis, key: string, windowMs: number, now: number): Promise<void> {
  await client.zAdd(key, { score: now, value: `${now}:${crypto.randomBytes(6).toString("hex")}` });
  await client.pExpire(key, windowMs * 2);
}

/** Count one failed attempt against all three gates. Never throws. */
export async function recordLoginFailure(input: { email: string; ip: string; now?: number }): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  const now = input.now ?? Date.now();
  try {
    await Promise.all([
      addHit(client, ipKey(input.ip), LOGIN_IP_WINDOW_MS, now),
      addHit(client, pairKey(input.email, input.ip), LOGIN_BACKOFF_WINDOW_MS, now),
      addHit(client, emailKey(input.email), LOGIN_BACKOFF_WINDOW_MS, now),
    ]);
  } catch (err) {
    console.warn(`[login-throttle] Redis error recording failure: ${err instanceof Error ? err.message : err}`);
  }
}

/** After a successful sign-in: forget this browser-IP's own failures. Never throws. */
export async function clearLoginPair(input: { email: string; ip: string }): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  try {
    await client.del(pairKey(input.email, input.ip));
  } catch {
    // best-effort
  }
}

/**
 * Admin unlock: drop every email-keyed gate (per-email and all per-email+IP
 * pairs) for one address. The per-IP gate is not touched — it protects the
 * whole install. Returns the number of keys removed, or null without Redis.
 */
export async function clearLoginThrottleForEmail(email: string): Promise<number | null> {
  const client = await getRedis();
  if (!client) return null;
  try {
    const keys = [emailKey(email)];
    for await (const batch of client.scanIterator({ MATCH: `${pairPrefix(email)}*`, COUNT: 200 })) {
      // redis v4 yields single keys, v5 yields arrays of keys.
      if (Array.isArray(batch)) keys.push(...batch);
      else keys.push(batch as string);
    }
    return await client.del(keys);
  } catch (err) {
    console.warn(`[login-throttle] Redis error clearing throttle: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
