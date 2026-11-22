// CSRF Origin check for state-changing API requests (edge-safe, pure).
//
// The session cookie is SameSite=Lax, which stops classic cross-SITE form
// posts but not SAME-SITE ones (any sibling subdomain of the install counts as
// same-site), and not a `text/plain` fetch from a same-site page. So every
// POST / PUT / PATCH / DELETE under /api/* must carry an Origin (Referer as the
// fallback when Origin is absent) equal to one of the app's own origins
// (src/lib/security/origins.ts: PUBLIC_URL / AUTH_URL / NEXTAUTH_URL, plus
// localhost:3000/3001 outside production).
//
// Missing BOTH Origin and Referer: allowed. Every current browser sends Origin
// on a cross-origin POST/PUT/PATCH/DELETE (fetch, XHR and <form> alike), so a
// request with neither header did not come from a browser page and cannot be
// a CSRF (curl / scripts carry their own cookies on purpose). A literal
// `Origin: null` (sandboxed iframe, some cross-origin redirects) is NOT
// "absent": it is rejected.
//
// Covered: /api/auth/* (NextAuth also has its own double-submit CSRF token; the
// Origin check adds login-CSRF protection on top) and /api/public/* (setup,
// register, password reset: browser JSON posts from our own pages).
// Exempt: /api/public/twilio/* (server-to-server, Twilio-signature validated).
// The page-ack POST (/api/public/page-ack/*) is token-authenticated and is
// usually opened from a mail client or phone; it follows the general rule
// (a mismatching Origin is rejected, an absent one allowed).

import { appOrigins, configuredAppOrigins, originOf, sameHostOrigin } from "./origins";

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const CSRF_EXEMPT_PREFIXES = ["/api/public/twilio/"] as const;

export type CsrfDecision = { ok: true } | { ok: false; reason: string };

export function checkCsrf(
  req: { method: string; pathname: string; headers: Headers },
  env: Record<string, string | undefined> = process.env,
): CsrfDecision {
  if (!STATE_CHANGING.has(req.method.toUpperCase())) return { ok: true };
  if (!(req.pathname === "/api" || req.pathname.startsWith("/api/"))) return { ok: true };
  if (CSRF_EXEMPT_PREFIXES.some((p) => req.pathname.startsWith(p))) return { ok: true };

  const originHeader = req.headers.get("origin");
  let source: string | null;
  let from: "Origin" | "Referer";
  if (originHeader !== null && originHeader.trim() !== "") {
    from = "Origin";
    source = originOf(originHeader); // "null" / garbage -> null -> rejected
  } else {
    const referer = req.headers.get("referer");
    if (referer === null || referer.trim() === "") return { ok: true }; // non-browser client
    from = "Referer";
    source = originOf(referer);
  }
  const raw = from === "Origin" ? originHeader : req.headers.get("referer");
  if (!source) return { ok: false, reason: mismatchReason(from, displayValue(raw), env) };

  const allowed = appOrigins(env);
  if (allowed.includes(source)) return { ok: true };
  // Nothing configured at all (plain `next start` without PUBLIC_URL): fall
  // back to a strict same-Host comparison instead of rejecting everything.
  if (configuredAppOrigins(env).length === 0 && sameHostOrigin(source, req.headers.get("host"))) {
    return { ok: true };
  }
  return { ok: false, reason: mismatchReason(from, source, env) };
}

/**
 * The origin operators should compare against: PUBLIC_URL's origin, else the
 * first other configured app origin (AUTH_URL / NEXTAUTH_URL / ...), else null.
 */
export function primaryAllowedOrigin(env: Record<string, string | undefined> = process.env): string | null {
  return originOf(env.PUBLIC_URL) ?? configuredAppOrigins(env)[0] ?? null;
}

/**
 * One-line boot-log description of what the CSRF check accepts, e.g.
 * `https://crucible.example.com` or `https://a.example.com (also: https://b.example.com)`.
 */
export function describeCsrfAllowedOrigins(env: Record<string, string | undefined> = process.env): string {
  const primary = primaryAllowedOrigin(env);
  if (!primary) {
    return "none configured (PUBLIC_URL unset): only same-Host requests are accepted; set PUBLIC_URL to the URL users open";
  }
  const others = appOrigins(env).filter((o) => o !== primary);
  return others.length ? `${primary} (also: ${others.join(", ")})` : primary;
}

function mismatchReason(
  from: "Origin" | "Referer",
  value: string,
  env: Record<string, string | undefined>,
): string {
  const label = from === "Origin" ? "Origin" : "Referer origin";
  const expected = primaryAllowedOrigin(env) ?? "(not set)";
  return `${label} ${value} does not match PUBLIC_URL ${expected}; set PUBLIC_URL to the URL users open`;
}

/** Header value safe to echo in an error detail: printable, bounded. */
function displayValue(v: string | null): string {
  const s = (v ?? "").replace(/[^\x20-\x7e]/g, "?").trim();
  return s.length > 200 ? `${s.slice(0, 200)}...` : s;
}
