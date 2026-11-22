// Second-factor attempt limits shared by the sign-in second step and the
// "confirm it's you" step-up. Every attempt is RESERVED before the factor is
// checked (no check-then-act window) and refunded only when it succeeds:
//
//   database  per user, MFA_DB_FAILURE_CAP per window (service.ts). Holds
//             without Redis. Skipped for a browser with a valid known-device
//             cookie, so someone who knows the password can't lock the owner
//             out of their own browser.
//   Redis     per user + client IP (or user + known device), and per client
//             IP. Reserve-first (rate-limit.ts reserveRateLimit); fails open
//             without Redis, which is why the database cap exists.
//
// The sign-in path also reserves an attempt on the pending ticket itself
// (login.ts), so one password entry buys at most MFA_TICKET_MAX_ATTEMPTS
// guesses whatever else is down.

import { reserveRateLimit, type RateLimitOptions } from "@/lib/security/rate-limit";
import { refundMfaFailureSlot, reserveMfaFailureSlot } from "./service";

const WINDOW_MS = 15 * 60 * 1000;

const LIMITS = {
  login: { perUser: 10, perIp: 30 },
  reauth: { perUser: 5, perIp: 20 },
} as const;

export type AttemptScope = keyof typeof LIMITS;

export type AttemptReservation = { allowed: false } | { allowed: true; finish: (success: boolean) => Promise<void> };

export async function reserveFactorAttempt(input: {
  scope: AttemptScope;
  userId: string;
  ip: string;
  /** A verified known-device cookie value, or null. */
  deviceKey: string | null;
}): Promise<AttemptReservation> {
  const lim = LIMITS[input.scope];
  const usesDbCap = !input.deviceKey;
  if (usesDbCap && !(await reserveMfaFailureSlot(input.userId))) return { allowed: false };

  const opts: RateLimitOptions[] = [
    input.deviceKey
      ? { namespace: `mfa-${input.scope}:user-device`, identifier: `${input.userId}|${input.deviceKey}`, windowMs: WINDOW_MS, max: lim.perUser }
      : { namespace: `mfa-${input.scope}:user-ip`, identifier: `${input.userId}|${input.ip}`, windowMs: WINDOW_MS, max: lim.perUser },
    { namespace: `mfa-${input.scope}:ip`, identifier: input.ip, windowMs: WINDOW_MS, max: lim.perIp },
  ];
  const reservations = await Promise.all(opts.map((o) => reserveRateLimit(o)));
  const refund = async () => {
    await Promise.all(reservations.map((r) => r.release()));
    if (usesDbCap) await refundMfaFailureSlot(input.userId);
  };
  if (reservations.some((r) => !r.allowed)) {
    await refund();
    return { allowed: false };
  }
  return {
    allowed: true,
    finish: async (success) => {
      if (success) await refund();
    },
  };
}
