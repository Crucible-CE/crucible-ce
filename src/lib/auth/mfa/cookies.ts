// Signed, short-lived MFA cookies. Both are HttpOnly + SameSite=Strict,
// Secure over https, and MAC'd with a key derived (HKDF) from AUTH_SECRET
// (NEXTAUTH_SECRET fallback), like the known-device cookie. Neither is a
// session on its own.
//
//   crucible_mfa_pending  "password accepted, second factor pending".
//                         v1.<ticketId>.<exp>.<mac>, mac over the ticket's
//                         user id + tokenVersion. The ticket row
//                         (MfaLoginTicket) makes it single use. Path /api.
//   crucible_mfa_reauth   "re-entered password (+ a factor) recently": the
//                         step-up grant that sensitive changes require (MFA
//                         settings, and admin MFA reset / reset link /
//                         require-MFA policy). v1.<userId>.<tokenVersion>.<exp>.<mac>.
//                         Path /api; checked server-side per route. Reusable
//                         until it expires (5 min).
//
// Pure: no I/O. Verification never throws.

import crypto from "node:crypto";

export const MFA_PENDING_COOKIE = "crucible_mfa_pending";
export const MFA_REAUTH_COOKIE = "crucible_mfa_reauth";
export const MFA_PENDING_TTL_SEC = 5 * 60;
export const MFA_REAUTH_TTL_SEC = 5 * 60;
export const MFA_PENDING_PATH = "/api";
export const MFA_REAUTH_PATH = "/api";

type Env = Record<string, string | undefined>;
const VERSION = "v1";

function key(purpose: "pending" | "reauth", env: Env = process.env): Buffer | null {
  const secret = env.AUTH_SECRET || env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return Buffer.from(crypto.hkdfSync("sha256", secret, "", `crucible-ce mfa ${purpose} cookie v1`, 32));
}

function mac(k: Buffer, parts: string[]): string {
  return crypto.createHmac("sha256", k).update(parts.join("|")).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---- pending ---------------------------------------------------------------

export function signPendingCookie(
  ticket: { id: string; userId: string; tokenVersion: number },
  expSec: number,
  env?: Env,
): string | null {
  const k = key("pending", env);
  if (!k || !ID_RE.test(ticket.id)) return null;
  const exp = String(expSec);
  return `${VERSION}.${ticket.id}.${exp}.${mac(k, [VERSION, ticket.id, exp, ticket.userId, String(ticket.tokenVersion)])}`;
}

/** The ticket id a pending cookie names (unverified: the MAC needs the ticket row). */
export function parsePendingCookie(value: string | null | undefined): { ticketId: string; exp: number; sig: string } | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION || !ID_RE.test(parts[1])) return null;
  const exp = Number(parts[2]);
  if (!Number.isInteger(exp)) return null;
  return { ticketId: parts[1], exp, sig: parts[3] };
}

/** Full check of a pending cookie against its ticket row. Never throws. */
export function verifyPendingCookie(
  value: string | null | undefined,
  ticket: { id: string; userId: string; tokenVersion: number },
  nowSec: number = Math.floor(Date.now() / 1000),
  env?: Env,
): boolean {
  try {
    const p = parsePendingCookie(value);
    const k = key("pending", env);
    if (!p || !k || p.ticketId !== ticket.id || p.exp < nowSec) return false;
    return safeEqual(p.sig, mac(k, [VERSION, ticket.id, String(p.exp), ticket.userId, String(ticket.tokenVersion)]));
  } catch {
    return false;
  }
}

// ---- reauth ----------------------------------------------------------------

export function signReauthCookie(user: { id: string; tokenVersion: number }, expSec: number, env?: Env): string | null {
  const k = key("reauth", env);
  if (!k || !ID_RE.test(user.id)) return null;
  const exp = String(expSec);
  const tv = String(user.tokenVersion);
  return `${VERSION}.${user.id}.${tv}.${exp}.${mac(k, [VERSION, user.id, tv, exp])}`;
}

/** Expiry (sec) of a valid grant for this user + tokenVersion, else null. Never throws. */
export function verifyReauthCookie(
  value: string | null | undefined,
  user: { id: string; tokenVersion: number },
  nowSec: number = Math.floor(Date.now() / 1000),
  env?: Env,
): number | null {
  try {
    if (typeof value !== "string" || value.length > 256) return null;
    const parts = value.split(".");
    if (parts.length !== 5 || parts[0] !== VERSION) return null;
    const [, id, tv, expRaw, sig] = parts;
    const k = key("reauth", env);
    const exp = Number(expRaw);
    if (!k || id !== user.id || tv !== String(user.tokenVersion) || !Number.isInteger(exp) || exp < nowSec) return null;
    // A grant can't outlive its TTL even if the clock moved backwards.
    if (exp - nowSec > MFA_REAUTH_TTL_SEC + 60) return null;
    return safeEqual(sig, mac(k, [VERSION, id, tv, expRaw])) ? exp : null;
  } catch {
    return null;
  }
}

/** Read one cookie from a request's Cookie header. Never throws. */
export function readCookie(req: Request | { headers: Headers } | null | undefined, name: string): string | null {
  try {
    const header = req?.headers?.get?.("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
    }
    return null;
  } catch {
    return null;
  }
}
