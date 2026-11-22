import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { shouldApplyPageCsp } from "@/lib/security/csp-scope";
import { checkCsrf } from "@/lib/security/csrf";
import { appOrigins, wsOriginOf } from "@/lib/security/origins";
import { signInWall } from "@/lib/auth/mfa/policy";
import { guestMayAccess, parseGuestCookieValue, readGuestCookie } from "@/lib/exercise/auth/guest-cookie";

// Per-request CSP with a nonce for inline <script> tags (no 'unsafe-inline'
// on script-src). Edge-safe: uses WebCrypto only.
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// connect-src: 'self' plus the app's configured origins (PUBLIC_URL /
// AUTH_URL / NEXTAUTH_URL) and their ws(s):// counterparts for the Socket.io
// upgrade. Outside production appOrigins() also carries the dev ports — the
// custom Next + Socket.io sidecar runs on :3001 in dev. No blanket `wss:`:
// that would let injected script open a socket to any host.
function connectSources(): string[] {
  const out = new Set<string>(["'self'"]);
  for (const o of appOrigins()) {
    out.add(o);
    const ws = wsOriginOf(o);
    if (ws) out.add(ws);
  }
  return [...out];
}

function buildCsp(nonce: string): string {
  // script-src: 'self' + the nonce for our inline theme bootstrap.
  // 'strict-dynamic' is intentionally omitted because Next.js still injects
  // non-nonced runtime scripts (RSC chunks). style-src retains
  // 'unsafe-inline' — React `style=` attributes require it. Fonts are
  // self-hosted (next/font), images are same-origin or data:/blob: previews.
  const scriptSrc = ["'self'", `'nonce-${nonce}'`].join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src ${scriptSrc}`,
    `connect-src ${connectSources().join(" ")}`,
  ].join("; ");
}

// HSTS only on a request that actually arrived over HTTPS (directly, or via a
// TLS-terminating proxy that sets X-Forwarded-Proto). Sending it over plain
// HTTP is ignored by browsers anyway, and a LAN / localhost install must stay
// reachable over http. No `preload`: a self-hosted install should not opt
// its operator's domain into the browser preload list.
const HSTS_VALUE = "max-age=31536000; includeSubDomains";
function isHttpsRequest(headers: Headers, protocol: string): boolean {
  const xfp = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (xfp) return xfp === "https";
  return protocol === "https:";
}

const isApiPath = (pathname: string) => pathname === "/api" || pathname.startsWith("/api/");

// Edge-safe auth instance — no Prisma, no DB calls.
// Only decrypts the JWT to check if the user is logged in.
const { auth } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt({ token }) {
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.mfaEnrollRequired = token.mfaEnrollRequired;
      }
      return session;
    },
  },
});

// Public pages that never require a session.
//   /login, /register, /forgot-password — the sign-in flows
//   /reset-password      — token-based; email links must work on any device
//   /check-email         — post-registration "check your inbox" page
//   /cancel-email-change — token-based link sent to the previous address
//   /setup               — first-run wizard (self-gates once a user exists)
//   /join                — exercise join by invite code (guests have no account)
// Token pages (the token in the URL is the credential, checked by the page):
//   /incident-guest/<t>  — an outside guest on one incident (lib/incident/guest)
//   /status/<t>          — a public incident status page (lib/incident/status-page)
const PUBLIC_PAGES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/check-email",
  "/cancel-email-change",
  "/setup",
  "/join",
];

const TOKEN_PAGE_PREFIXES = ["/incident-guest/", "/status/"];
const isTokenPage = (pathname: string) => TOKEN_PAGE_PREFIXES.some((p) => pathname.startsWith(p));

export default auth(async (req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const pathname = nextUrl.pathname;

  // Generate the per-request nonce. Forwarded to the React tree via the
  // `x-nonce` request header (consumed by src/app/layout.tsx) and emitted
  // on the response via Content-Security-Policy.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  // Page CSP only off /api/*: in Next 15 middleware headers WIN over route
  // handler headers, so a page CSP here would replace the sandbox CSP every
  // file download sets (see lib/security/csp-scope.ts).
  const applyCsp = shouldApplyPageCsp(pathname);
  const https = isHttpsRequest(req.headers, nextUrl.protocol);
  const withCsp = (res: NextResponse) => {
    if (applyCsp) res.headers.set("Content-Security-Policy", csp);
    if (https) res.headers.set("Strict-Transport-Security", HSTS_VALUE);
    // Token-in-URL pages (guest links, status pages): never leak the token
    // in a Referer header to a linked site.
    if (isTokenPage(pathname)) res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  };

  // Helper — apply CSP + forward nonce on a NextResponse.next() result.
  const passthrough = () => withCsp(NextResponse.next({ request: { headers: requestHeaders } }));

  // Static assets — skip middleware entirely. Belt-and-braces with the matcher
  // below: files under public/ (e.g. /cloud/*.png, /branding/logos/*.svg) are
  // fetched cookie-less by the /_next/image optimizer, so an auth redirect
  // here breaks every optimized image.
  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname.startsWith("/cloud/") ||
    pathname.startsWith("/branding/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/icon" ||
    pathname === "/icon.svg" ||
    pathname === "/icon.png" ||
    pathname === "/apple-icon" ||
    pathname === "/apple-icon.png"
  ) {
    return NextResponse.next();
  }

  // ---- CSRF: Origin check on state-changing API requests -----------------
  // Runs before the auth gate and before the public-route passthrough, so it
  // covers /api/auth/* and /api/public/* too (exemptions and the absent-Origin
  // rule live in lib/security/csrf.ts).
  if (isApiPath(pathname)) {
    const csrf = checkCsrf({ method: req.method, pathname, headers: req.headers });
    if (!csrf.ok) {
      return withCsp(
        NextResponse.json(
          { error: "Forbidden", code: "csrf_origin_mismatch", details: csrf.reason },
          { status: 403 },
        ),
      );
    }
  }

  // NextAuth API routes + public API routes + health probe — always allow.
  // /api/join and /api/join/<code>: exercise join by invite code. The routes
  // rate limit and check the code themselves.
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/public") ||
    pathname === "/api/health" ||
    pathname === "/api/join" ||
    pathname.startsWith("/api/join/")
  ) {
    return passthrough();
  }

  // /escalation-verify/<token> — an escalation contact (not a user) confirms
  // their details; possession of the single-use token is the authorization.
  if (
    PUBLIC_PAGES.includes(pathname) ||
    pathname.startsWith("/escalation-verify/") ||
    pathname.startsWith("/join/") ||
    isTokenPage(pathname)
  ) {
    return passthrough();
  }

  // The root page routes itself (signed in → /dashboard, fresh install →
  // /setup, otherwise → /login). Let it run instead of bouncing to /login
  // here, which would hide the setup wizard from a brand-new install.
  if (pathname === "/") {
    return passthrough();
  }

  // ---- Auth gate ----------------------------------------------------------
  // All other routes require a session. API callers get a JSON 401 (a 307 to
  // the HTML login page is useless to fetch() and hides which routes exist
  // behind a uniform redirect anyway); pages redirect to /login.
  if (!isLoggedIn) {
    // Exercise guest (invite code, no account): only its own exercise's play
    // page and play API. The cookie is validated against the database in the
    // route handlers (src/lib/exercise/auth/guest.ts).
    const guest = parseGuestCookieValue(readGuestCookie(req.headers.get("cookie")));
    if (guest && guestMayAccess(pathname, guest.exerciseId)) return passthrough();

    if (isApiPath(pathname)) {
      return withCsp(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("from", pathname);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  // ---- Sign-in wall ------------------------------------------------------
  // Require-MFA policy: the org requires two-factor sign-in and this user
  // has no factor yet; every page funnels through /mfa-setup-required.
  // API routes the wall page needs are allow-listed (lib/auth/mfa/policy.ts);
  // any other API call gets a JSON 403. The claims come from the JWT, which
  // the full auth instance re-validates against the DB on every server-side
  // auth() call; the platform layout re-checks the MFA claim fresh, so a
  // policy turned on mid-session applies on the next page load.
  const wall = signInWall(pathname, {
    mfaEnrollRequired: req.auth?.user?.mfaEnrollRequired,
  });
  if (wall.kind === "forbidden") {
    return withCsp(NextResponse.json({ error: wall.error, code: wall.code }, { status: 403 }));
  }
  if (wall.kind === "redirect") {
    return withCsp(NextResponse.redirect(new URL(wall.to, nextUrl)));
  }

  return passthrough();
});

export const config = {
  matcher: [
    // Excludes Next internals, the icon routes, and the public/ static asset
    // dirs (`branding/`, `cloud/` — note the trailing slash: the /cloud PAGE
    // still runs through the auth gate; only /cloud/<file> assets skip it).
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|icon|icon.svg|icon.png|apple-icon|apple-icon.png|branding/|cloud/).*)",
  ],
};
