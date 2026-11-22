// Delivery-engine tunables (env, read at call time).

function intEnv(name: string, fallback: number, min = 0): number {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

/**
 * Minutes to wait before each retry of a failed attempt. Default "1,5,15":
 * attempt 1 fails -> retry in 1 min, attempt 2 -> 5 min, attempt 3 -> 15 min,
 * attempt 4 is the last. DELIVERY_RETRY_BACKOFF_MINUTES=0 disables retries.
 */
export function retryBackoffMinutes(): number[] {
  const raw = process.env.DELIVERY_RETRY_BACKOFF_MINUTES;
  if (raw === undefined || raw.trim() === "") return [1, 5, 15];
  return raw
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 10);
}

/** When attempt `attempt` (1-based) failed: next retry time, or null if exhausted. */
export function nextRetryAt(attempt: number, now: Date): Date | null {
  const backoff = retryBackoffMinutes();
  const minutes = backoff[attempt - 1];
  if (minutes === undefined) return null;
  return new Date(now.getTime() + minutes * 60_000);
}

/**
 * Anti toll-fraud: max sends to ONE phone number per rolling hour, counted per
 * channel (SMS and voice separately). Escalations and critical-severity pages
 * are exempt (they fall under the per-number ceiling below instead).
 */
export function recipientHourlyLimit(): number {
  return intEnv("DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR", 10, 1);
}

/** Anti toll-fraud: max sends for the whole organization per rolling hour, per channel. */
export function orgHourlyLimit(): number {
  return intEnv("DELIVERY_RATE_LIMIT_PER_ORG_HOUR", 100, 1);
}

/**
 * Abuse ceiling: max sends to ONE phone number per rolling hour, per channel,
 * that applies to EVERY page (escalations and critical pages included).
 * Deliberately high: it only stops number pumping.
 */
export function numberCeilingHourlyLimit(): number {
  return intEnv("DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR", 60, 1);
}

/** Max attempts for a rate-limited send that keeps being re-queued for its window. */
export const MAX_RATE_LIMITED_ATTEMPTS = 20;

/** A "pending" delivery row older than this is treated as crashed mid-send. */
export const PENDING_STALE_MINUTES = 2;

/** An open page with no delivery rows at its current level for this long is re-fanned out. */
export const REFANOUT_AFTER_MINUTES = 2;

/** Hard ceiling on any single provider send (guards slow/hung plugins). */
export const PROVIDER_SEND_TIMEOUT_MS = 20_000;

/** Phone channels counted by the toll-fraud limits. */
export const METERED_CHANNELS = ["sms", "voice"] as const;
