// Guest cookie names and value format. Edge-safe: no node:* imports, no DB.
// Used by src/middleware.ts (routing only) and src/auth/guest.ts (validation).
//
// The __Host- prefix requires Secure, so plain-HTTP development uses the
// unprefixed name. Value: "<exerciseId>.<token>". The exercise id lets the
// middleware keep a guest on its own exercise's paths; the token is the
// secret, and only its SHA-256 is stored (GuestSession.tokenHash).

export const GUEST_COOKIE_SECURE = "__Host-ce-guest";
export const GUEST_COOKIE_PLAIN = "ce-guest";
export const GUEST_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Secure cookies when PUBLIC_URL is https, or in production when PUBLIC_URL is unset. */
export function guestCookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  const pub = env.PUBLIC_URL?.trim().toLowerCase();
  if (pub) return pub.startsWith("https://");
  return env.NODE_ENV === "production";
}

export function guestCookieName(env: Record<string, string | undefined> = process.env): string {
  return guestCookieSecure(env) ? GUEST_COOKIE_SECURE : GUEST_COOKIE_PLAIN;
}

const ID_RE = /^[a-z0-9]{8,40}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/** Parse a cookie value into its parts. Null when malformed. */
export function parseGuestCookieValue(value: string | null | undefined): { exerciseId: string; token: string } | null {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const exerciseId = value.slice(0, dot);
  const token = value.slice(dot + 1);
  if (!ID_RE.test(exerciseId) || !TOKEN_RE.test(token)) return null;
  return { exerciseId, token };
}

/** Read the guest cookie value from a Cookie header (either name). */
export function readGuestCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  let plain: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === GUEST_COOKIE_SECURE) return value;
    if (name === GUEST_COOKIE_PLAIN) plain = value;
  }
  return plain;
}

/**
 * Paths a guest (no user session) may reach: the play page of its own
 * exercise and that exercise's play API. Everything else is refused.
 */
export function guestMayAccess(pathname: string, exerciseId: string): boolean {
  const page = `/play/${exerciseId}`;
  const api = `/api/play/${exerciseId}`;
  return pathname === page || pathname.startsWith(`${page}/`) || pathname === api || pathname.startsWith(`${api}/`);
}
