// The app's own origins, shared by the CSRF Origin check (src/middleware.ts),
// the page CSP connect-src, and the Socket.io handshake Origin check
// (src/lib/socket/server.ts).
//
// Edge-safe: ZERO `node:*` imports (the middleware runs on the edge runtime).
// Env is read at call time — the self-hosted image is built once and
// PUBLIC_URL is supplied when the container starts.
//
// Sources, in order: PUBLIC_URL, AUTH_URL, NEXTAUTH_URL, plus the build-time
// NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SOCKET_URL when set. Outside production
// the dev ports (http://localhost:3000 and :3001) are added so `npm run
// dev:full` (Next on :3000, socket sidecar on :3001) keeps working.

type Env = Record<string, string | undefined>;

const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

/** `scheme://host[:port]` of a URL, or null for anything unparseable / opaque. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin === "null" ? null : u.origin;
  } catch {
    return null;
  }
}

/** Origins from the configured public URL env vars (no dev extras). */
export function configuredAppOrigins(env: Env = process.env): string[] {
  const out = new Set<string>();
  for (const v of [
    env.PUBLIC_URL,
    env.AUTH_URL,
    env.NEXTAUTH_URL,
    env.NEXT_PUBLIC_APP_URL,
    env.NEXT_PUBLIC_SOCKET_URL,
  ]) {
    const o = originOf(v);
    if (o) out.add(o);
  }
  return [...out];
}

/** Configured origins plus, outside production, the local dev ports. */
export function appOrigins(env: Env = process.env): string[] {
  const out = new Set(configuredAppOrigins(env));
  if (env.NODE_ENV !== "production") for (const o of DEV_ORIGINS) out.add(o);
  return [...out];
}

/** Comma-separated extra origins (e.g. SOCKET_EXTRA_ALLOWED_ORIGINS). */
export function parseOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => originOf(s.trim()))
    .filter((o): o is string => o !== null);
}

/** ws(s):// counterpart of an http(s):// origin (for CSP connect-src). */
export function wsOriginOf(origin: string): string | null {
  if (origin.startsWith("https://")) return `wss://${origin.slice(8)}`;
  if (origin.startsWith("http://")) return `ws://${origin.slice(7)}`;
  return null;
}

/**
 * Same-origin fallback used ONLY when no public URL is configured at all
 * (plain `next start` without env): the Origin's host must equal the Host the
 * request was sent to. A browser cannot forge either header.
 */
export function sameHostOrigin(origin: string, host: string | null | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.trim().toLowerCase();
  } catch {
    return false;
  }
}
