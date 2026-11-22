// Two-step sign-in. Step 1 is the existing credentials provider (password +
// login throttle). When the account has MFA, step 1 does NOT return a user:
// it creates a pending ticket (MfaLoginTicket), sets the signed
// crucible_mfa_pending cookie and throws MfaRequiredError, so NextAuth issues
// no session. Step 2 is the "mfa" credentials provider (authorizeMfa below):
// it checks the ticket and one factor (TOTP code, recovery code or a WebAuthn
// assertion) and only then returns the user, so the session is created after
// MFA. The known-device cookie only relaxes the PASSWORD throttle; it never
// skips this step.
//
// Factor attempts are limited, each RESERVED atomically before the factor is
// checked: per ticket (MFA_TICKET_MAX_ATTEMPTS, in the database; then the
// password must be entered again, which runs the login throttle again), and
// through attempts.ts (a database cap per user that holds without Redis, plus
// Redis windows per user + IP / known device and per IP). At most
// MAX_LIVE_TICKETS pending sign-ins exist per user. Each failure also counts
// as a failed login in the login throttle. Successes and failures go to the
// activity log.

import { CredentialsSignin } from "next-auth";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { isHttpsRequest, readKnownDeviceCookie, setKnownDeviceCookie, verifyKnownDevice } from "@/lib/auth/known-device";
import { deriveActivityIp, recordActivity } from "@/lib/security/activity-log";
import { clearLoginPair, recordLoginFailure } from "@/lib/security/login-throttle";
import { ipFromRequest } from "@/lib/security/rate-limit";
import { reserveFactorAttempt } from "./attempts";
import {
  MFA_PENDING_COOKIE,
  MFA_PENDING_PATH,
  MFA_PENDING_TTL_SEC,
  MFA_REAUTH_COOKIE,
  MFA_REAUTH_PATH,
  MFA_REAUTH_TTL_SEC,
  parsePendingCookie,
  readCookie,
  signPendingCookie,
  signReauthCookie,
  verifyPendingCookie,
} from "./cookies";
import { consumeRecoveryCode, loadFactors, verifyUserTotp } from "./service";
import { verifyAuthentication } from "./webauthn";

export class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}
class MfaInvalidError extends CredentialsSignin {
  code = "mfa_invalid";
}
class MfaExpiredError extends CredentialsSignin {
  code = "mfa_expired";
}
class MfaRateLimitedError extends CredentialsSignin {
  code = "mfa_rate_limited";
}

/** Second-factor attempts one pending sign-in allows (the column is MfaLoginTicket.failedAttempts). */
export const MFA_TICKET_MAX_ATTEMPTS = 5;
/** Pending sign-ins kept per user; opening another drops the oldest. */
export const MAX_LIVE_TICKETS = 3;

interface LoginUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  organizationId: string;
  role: string;
}

/** What authorize() returns to NextAuth (shared by both providers). */
export function sessionUser(user: LoginUser, req: Request | undefined) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    organizationId: user.organizationId,
    role: user.role,
    // events.signIn receives no request: stash the derived IP fields here;
    // the event handler reads and strips them.
    _loginIp: deriveActivityIp(req),
  };
}

async function setPendingCookie(value: string, req: Request | undefined, maxAge: number): Promise<void> {
  try {
    const { cookies } = await import("next/headers");
    (await cookies()).set(MFA_PENDING_COOKIE, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttpsRequest(req),
      path: MFA_PENDING_PATH,
      maxAge,
    });
  } catch {
    // Not in a request scope (tests).
  }
}

/**
 * A completed sign-in (password, plus the second factor when MFA is on) counts
 * as a fresh "confirm it's you": set the same 5-minute step-up grant the
 * Security settings ask for, so enrolling right after signing in (e.g. from
 * the require-MFA page) doesn't ask for the password again. Best-effort.
 */
export async function grantReauthOnSignIn(user: { id: string; tokenVersion: number }, req: Request | undefined): Promise<void> {
  const expSec = Math.floor(Date.now() / 1000) + MFA_REAUTH_TTL_SEC;
  const value = signReauthCookie(user, expSec);
  if (!value) return;
  try {
    const { cookies } = await import("next/headers");
    (await cookies()).set(MFA_REAUTH_COOKIE, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttpsRequest(req),
      path: MFA_REAUTH_PATH,
      maxAge: MFA_REAUTH_TTL_SEC,
    });
  } catch {
    // Not in a request scope (tests).
  }
}

/**
 * Password accepted for an account with MFA: open a pending ticket and set
 * its cookie. The caller then throws MfaRequiredError.
 */
export async function startMfaLogin(user: { id: string; tokenVersion: number }, req: Request | undefined): Promise<void> {
  const now = Date.now();
  await db.mfaLoginTicket.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  // Cap live tickets per user: keep the newest MAX_LIVE_TICKETS - 1, then add one.
  const live = await db.mfaLoginTicket.findMany({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const stale = live.slice(MAX_LIVE_TICKETS - 1).map((t) => t.id);
  if (stale.length > 0) await db.mfaLoginTicket.deleteMany({ where: { id: { in: stale } } });
  const expSec = Math.floor(now / 1000) + MFA_PENDING_TTL_SEC;
  const ticket = await db.mfaLoginTicket.create({
    data: { userId: user.id, tokenVersion: user.tokenVersion, expiresAt: new Date(expSec * 1000) },
    select: { id: true, userId: true, tokenVersion: true },
  });
  const value = signPendingCookie(ticket, expSec);
  if (!value) throw new Error("AUTH_SECRET (or NEXTAUTH_SECRET) is required for two-factor sign-in");
  await setPendingCookie(value, req, MFA_PENDING_TTL_SEC);
}

const pendingUserSelect = {
  id: true,
  email: true,
  name: true,
  image: true,
  organizationId: true,
  role: true,
  isActive: true,
  emailVerified: true,
  tokenVersion: true,
} as const;

/**
 * The live pending sign-in a request carries, or null (no / forged / expired /
 * used / burned ticket, or the account changed since the password step).
 */
export async function loadPendingLogin(req: Request | { headers: Headers } | undefined) {
  const raw = readCookie(req, MFA_PENDING_COOKIE);
  const parsed = parsePendingCookie(raw);
  if (!parsed) return null;
  const ticket = await db.mfaLoginTicket.findUnique({
    where: { id: parsed.ticketId },
    select: { id: true, userId: true, tokenVersion: true, expiresAt: true, consumedAt: true, failedAttempts: true, user: { select: pendingUserSelect } },
  });
  if (!ticket || ticket.consumedAt || ticket.expiresAt.getTime() <= Date.now()) return null;
  if (ticket.failedAttempts >= MFA_TICKET_MAX_ATTEMPTS) return null;
  if (!verifyPendingCookie(raw, ticket)) return null;
  const u = ticket.user;
  if (!u.isActive || !u.emailVerified || u.tokenVersion !== ticket.tokenVersion) return null;
  return { ticket, user: u };
}

type Method = "totp" | "recovery" | "webauthn";

function parseInput(credentials: Partial<Record<string, unknown>> | undefined): { method: Method; code: string; response: AuthenticationResponseJSON | null } | null {
  const method = credentials?.method;
  if (method !== "totp" && method !== "recovery" && method !== "webauthn") return null;
  if (method === "webauthn") {
    const raw = credentials?.response;
    if (typeof raw !== "string" || raw.length > 16_384) return null;
    try {
      return { method, code: "", response: JSON.parse(raw) as AuthenticationResponseJSON };
    } catch {
      return null;
    }
  }
  const code = credentials?.code;
  if (typeof code !== "string" || code.length > 64) return null;
  return { method, code, response: null };
}

/** The "mfa" credentials provider's authorize(). Exported for tests. */
export async function authorizeMfa(credentials: Partial<Record<string, unknown>> | undefined, req: Request | undefined) {
  const input = parseInput(credentials);
  if (!input) throw new MfaInvalidError();
  const pending = await loadPendingLogin(req);
  if (!pending) throw new MfaExpiredError();
  const { ticket, user } = pending;
  const ip = ipFromRequest(req);
  const fail = (reason: string) =>
    void recordActivity({ action: "mfa.failure", userId: user.id, organizationId: user.organizationId, req, metadata: { method: input.method, reason } });

  // 1. Reserve an attempt on the ticket itself, atomically, BEFORE checking
  //    anything: concurrent requests can't share a slot.
  const reserved = await db.mfaLoginTicket.updateMany({
    where: { id: ticket.id, consumedAt: null, expiresAt: { gt: new Date() }, failedAttempts: { lt: MFA_TICKET_MAX_ATTEMPTS } },
    data: { failedAttempts: { increment: 1 } },
  });
  if (reserved.count !== 1) {
    await setPendingCookie("", req, 0);
    throw new MfaExpiredError();
  }

  // 2. Per-user (database, holds without Redis) and per user+IP / per-IP
  //    (Redis) caps, reserve-first. A known device skips the per-user cap.
  const account = await db.user.findUnique({ where: { id: user.id }, select: { id: true, passwordHash: true } });
  const deviceCookie = readKnownDeviceCookie(req);
  const deviceKey = account && verifyKnownDevice(deviceCookie, account) ? deviceCookie : null;
  const attempt = await reserveFactorAttempt({ scope: "login", userId: user.id, ip, deviceKey });
  if (!attempt.allowed) {
    fail("rate_limited");
    throw new MfaRateLimitedError();
  }

  // 3. The factor.
  let ok = false;
  let reason = "invalid_code";
  let recoveryRemaining: number | null = null;
  if (input.method === "totp") {
    ok = await verifyUserTotp(user.id, input.code);
  } else if (input.method === "recovery") {
    const r = await consumeRecoveryCode(user.id, input.code);
    ok = r.ok;
    recoveryRemaining = r.remaining;
    if (!ok) reason = "invalid_recovery_code";
  } else if (input.response) {
    const r = await verifyAuthentication(user.id, input.response, "login", ticket.id);
    ok = r.ok;
    if (!r.ok) reason = `webauthn_${r.reason}`;
  }
  await attempt.finish(ok);

  if (!ok) {
    await recordLoginFailure({ email: user.email, ip });
    fail(reason);
    const after = await db.mfaLoginTicket.findUnique({ where: { id: ticket.id }, select: { failedAttempts: true } });
    if (!after || after.failedAttempts >= MFA_TICKET_MAX_ATTEMPTS) {
      await setPendingCookie("", req, 0);
      throw new MfaExpiredError();
    }
    throw new MfaInvalidError();
  }

  // Single use: only one request can flip consumedAt.
  const consumed = await db.mfaLoginTicket.updateMany({
    where: { id: ticket.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (consumed.count !== 1) throw new MfaExpiredError();

  await setPendingCookie("", req, 0);
  await clearLoginPair({ email: user.email, ip });
  if (account) await setKnownDeviceCookie(account, req);
  await grantReauthOnSignIn(user, req);

  void recordActivity({
    action: "mfa.success",
    userId: user.id,
    organizationId: user.organizationId,
    req,
    metadata: { method: input.method, ...(recoveryRemaining !== null ? { recoveryCodesRemaining: recoveryRemaining } : {}) },
  });
  return sessionUser(user, req);
}

/** Which second steps a pending sign-in can offer (for the login page). */
export async function pendingFactors(userId: string): Promise<{ totp: boolean; webauthn: boolean; recovery: boolean }> {
  const f = await loadFactors(userId);
  return { totp: f.totp, webauthn: f.webauthnCount > 0, recovery: f.recoveryRemaining > 0 };
}
