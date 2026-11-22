// Guest join infrastructure. This module owns codes, guest sessions, and the request principal.
//
//   - Join codes: 8 chars from the setup-code alphabet (no 0/O/1/I/L), CSPRNG.
//   - Guest session: 32 random bytes, sent as an httpOnly cookie, never in a
//     URL. Only the SHA-256 is stored (GuestSession.tokenHash). 12 h expiry.
//   - resolveGuest(req) validates the cookie against the DB every time.

import { randomBytes, randomInt } from "node:crypto";
import type { NextResponse } from "next/server";
import { db, type DbClient } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/exercise/auth/session";
import { SETUP_CODE_ALPHABET } from "@/lib/setup/setup-code";
import { hashGuestToken, resolveGuestCookieValue, type GuestPrincipal } from "@/lib/exercise/auth/guest-core";

export { hashGuestToken, resolveGuestCookieValue, type GuestPrincipal } from "@/lib/exercise/auth/guest-core";
import {
  GUEST_SESSION_TTL_MS,
  guestCookieName,
  guestCookieSecure,
  readGuestCookie,
} from "@/lib/exercise/auth/guest-cookie";

export { GUEST_SESSION_TTL_MS, guestCookieName, readGuestCookie } from "@/lib/exercise/auth/guest-cookie";

export const JOIN_CODE_LENGTH = 8;

/** A fresh join code: 8 chars from the unambiguous alphabet. */
export function generateJoinCode(length: number = JOIN_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) code += SETUP_CODE_ALPHABET[randomInt(0, SETUP_CODE_ALPHABET.length)];
  return code;
}

/** Uppercase and drop spaces and dashes, so "abcd-efgh" matches "ABCDEFGH". */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export interface GuestCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: "/";
    expires: Date;
  };
}

export interface IssuedGuestSession {
  sessionId: string;
  expiresAt: Date;
  cookie: GuestCookie;
}

/**
 * Create a guest session and set its cookie. Pass `response` to set the
 * cookie on it; otherwise the cookie is set through next/headers (route
 * handlers and server actions).
 */
export async function issueGuestSession(
  exerciseId: string,
  participantId: string,
  opts: { client?: DbClient; response?: NextResponse; now?: Date } = {},
): Promise<IssuedGuestSession> {
  const client = opts.client ?? db;
  const now = opts.now ?? new Date();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_MS);
  const row = await client.guestSession.create({
    data: { tokenHash: hashGuestToken(token), exerciseId, participantId, expiresAt },
    select: { id: true },
  });
  const cookie: GuestCookie = {
    name: guestCookieName(),
    value: `${exerciseId}.${token}`,
    options: { httpOnly: true, sameSite: "lax", secure: guestCookieSecure(), path: "/", expires: expiresAt },
  };
  if (opts.response) opts.response.cookies.set(cookie.name, cookie.value, cookie.options);
  else {
    const { cookies } = await import("next/headers");
    (await cookies()).set(cookie.name, cookie.value, cookie.options);
  }
  return { sessionId: row.id, expiresAt, cookie };
}

/** The guest behind a request, or null. Never throws on a malformed cookie. */
export async function resolveGuest(req: Request | { headers: Headers }): Promise<GuestPrincipal | null> {
  try {
    return await resolveGuestCookieValue(readGuestCookie(req.headers.get("cookie")));
  } catch (err) {
    console.error("[guest] could not resolve guest session:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Delete every guest session of a participant (removed, or left). */
export async function revokeGuestSessions(participantId: string, client: DbClient = db): Promise<number> {
  const res = await client.guestSession.deleteMany({ where: { participantId } });
  return res.count;
}

export type Principal =
  | { kind: "user"; user: SessionUser }
  | { kind: "guest"; exerciseId: string; participantId: string };

/** Who is making this request: a signed-in user first, else a valid guest, else null. */
export async function resolvePrincipal(req: Request | { headers: Headers }): Promise<Principal | null> {
  const user = await getSessionUser();
  if (user) return { kind: "user", user };
  const guest = await resolveGuest(req);
  if (guest) return { kind: "guest", ...guest };
  return null;
}

// ---------------------------------------------------------------------------
// Display names
// ---------------------------------------------------------------------------

export const DISPLAY_NAME_MAX = 40;
export const RESERVED_DISPLAY_NAMES = ["facilitator", "system", "admin", "controller", "evaluator"] as const;

export type DisplayNameResult = { ok: true; name: string } | { ok: false; error: string };

/**
 * Clean a guest-chosen display name: strip control and invisible formatting
 * characters (including bidi overrides), collapse whitespace, trim, cap at 40,
 * and refuse reserved names (case-insensitive).
 */
export function sanitizeDisplayName(raw: unknown): DisplayNameResult {
  if (typeof raw !== "string") return { ok: false, error: "Enter a name." };
  const cleaned = raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return { ok: false, error: "Enter a name." };
  if ([...cleaned].length > DISPLAY_NAME_MAX) return { ok: false, error: `Use ${DISPLAY_NAME_MAX} characters or fewer.` };
  const lower = cleaned.toLowerCase();
  if ((RESERVED_DISPLAY_NAMES as readonly string[]).includes(lower)) {
    return { ok: false, error: "That name is reserved. Pick another." };
  }
  return { ok: true, name: cleaned };
}
