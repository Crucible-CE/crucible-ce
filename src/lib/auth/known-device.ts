// Known-device cookie for the login throttle (src/lib/security/login-throttle.ts).
//
// Set on every successful credentials sign-in. The value is OPAQUE:
//   v1.<random device id>.<issued-at sec>.<mac>
//   mac = HMAC-SHA256(key, "v1|deviceId|iat|userId|passwordHash")
// with the key derived (HKDF) from AUTH_SECRET (NEXTAUTH_SECRET fallback). No
// user id travels in clear; the MAC is only checked against the account being
// signed in to, so the cookie can't be forged, moved to another account, or
// used to learn who signed in on a browser. Binding the password hash means
// any password change or reset invalidates every device cookie of that user.
// (Deliberately NOT tokenVersion: sign-out bumps it, and a user who signed out
// must still count as a known device when an attacker is hammering the
// account.)
//
// A browser presenting a valid cookie for the account it is signing in to
// skips the per-email and per-email+IP backoff (an attacker hammering that
// account can't lock its owner out); the per-IP cap still applies.
//
// HttpOnly, SameSite=Strict, Path=/api/auth (only the sign-in POST needs it),
// Secure when the request arrived over https. It is not a session and grants
// nothing on its own: the password is still required.

import crypto from "node:crypto";

export const KNOWN_DEVICE_COOKIE = "crucible_known_device";
export const KNOWN_DEVICE_MAX_AGE_SEC = 180 * 24 * 60 * 60;
const VERSION = "v1";

type Env = Record<string, string | undefined>;

export interface DeviceAccount {
  id: string;
  passwordHash: string | null;
}

// Verification for a missing account still runs one HMAC over this, so the
// code path and timing do not depend on whether the email exists.
const NO_ACCOUNT: DeviceAccount = { id: "\u0000no-account", passwordHash: null };

function deviceKey(env: Env = process.env): Buffer | null {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return Buffer.from(crypto.hkdfSync("sha256", secret, "", "crucible-ce login known-device cookie v1", 32));
}

function mac(key: Buffer, deviceId: string, iat: string, account: DeviceAccount): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${VERSION}|${deviceId}|${iat}|${account.id}|${account.passwordHash ?? ""}`)
    .digest("base64url");
}

/** Cookie value for `account`, or null when no secret is configured. */
export function signKnownDevice(
  account: DeviceAccount,
  nowSec = Math.floor(Date.now() / 1000),
  env?: Env,
): string | null {
  const key = deviceKey(env);
  if (!key) return null;
  const deviceId = crypto.randomBytes(16).toString("base64url");
  const iat = String(nowSec);
  return `${VERSION}.${deviceId}.${iat}.${mac(key, deviceId, iat, account)}`;
}

/**
 * True when `value` is a valid, unexpired device cookie for `account`.
 * Malformed input of any kind is "not known" — this never throws.
 */
export function verifyKnownDevice(
  value: string | null | undefined,
  account: DeviceAccount | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  env?: Env,
): boolean {
  try {
    const key = deviceKey(env);
    if (!key) return false;
    const parts = typeof value === "string" && value.length <= 512 ? value.split(".") : [];
    const [v = "", deviceId = "", iatRaw = "", sig = ""] = parts;
    const target = account ?? NO_ACCOUNT;
    const expected = Buffer.from(mac(key, deviceId, iatRaw, target));
    const given = Buffer.from(sig);
    const sigOk = expected.length === given.length && crypto.timingSafeEqual(expected, given);
    const iat = Number(iatRaw);
    const fresh = Number.isInteger(iat) && iat <= nowSec + 300 && nowSec - iat <= KNOWN_DEVICE_MAX_AGE_SEC;
    return parts.length === 4 && v === VERSION && !!account && sigOk && fresh;
  } catch {
    return false;
  }
}

/** Read the raw cookie value from a request's Cookie header. Never throws. */
export function readKnownDeviceCookie(req: Request | { headers: Headers } | null | undefined): string | null {
  try {
    const header = req?.headers?.get?.("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === KNOWN_DEVICE_COOKIE) return part.slice(eq + 1).trim();
    }
    return null;
  } catch {
    return null;
  }
}

/** True when the request reached us over https (directly or via a TLS proxy). */
export function isHttpsRequest(req: Request | { headers: Headers; url?: string } | null | undefined): boolean {
  const xfp = req?.headers?.get?.("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (xfp) return xfp === "https";
  const url = req && "url" in req ? req.url : undefined;
  return typeof url === "string" && url.startsWith("https://");
}

/** Remember this browser for the login throttle. Best-effort, never throws. */
export async function setKnownDeviceCookie(
  account: DeviceAccount,
  req: Request | undefined,
): Promise<void> {
  const value = signKnownDevice(account);
  if (!value) return;
  try {
    const { cookies } = await import("next/headers");
    (await cookies()).set(KNOWN_DEVICE_COOKIE, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: isHttpsRequest(req),
      path: "/api/auth",
      maxAge: KNOWN_DEVICE_MAX_AGE_SEC,
    });
  } catch {
    // Not in a request scope (tests, non-HTTP callers): nothing to set.
  }
}
