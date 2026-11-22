// Per-request JWT re-validation for the Auth.js `jwt` callback
// (src/lib/auth/auth.config.ts), split out so the fail-closed / grace logic is
// unit-testable without NextAuth.
//
// Every request re-reads the security-critical user fields from the DB so role
// changes, deactivations and tokenVersion bumps (password change, force-logout,
// sign-out) take effect immediately.
//
// When the DB check cannot complete (error, or no answer within timeoutMs):
//   - token validated successfully within the last graceMs (60 s) -> keep the
//     session: return the previous token UNCHANGED (a brief pool stall or DB
//     restart must not sign everyone out — returning null clears the cookie);
//   - otherwise FAIL CLOSED (null => no session). A token we could not
//     re-validate may belong to a user who was just deactivated or
//     force-logged-out; the grace caps how long such a token can ride an outage.
//
// "Validated within the last 60 s" is tracked SERVER-SIDE, in a process-memory
// map keyed by user id + tokenVersion (shared through globalThis so every
// Next.js route bundle in this single process sees the same map). The
// lastValidatedAt claim in the cookie only moves when the cookie is reissued,
// which most requests (route handlers, server components) never do, so relying
// on it alone made the grace almost never apply. The cookie claim still counts
// (e.g. right after a restart, when the map is empty). The grace applies ONLY
// to a DB error / timeout, never to a definite mismatch.

export const JWT_REVALIDATE_TIMEOUT_MS = 3000;
export const JWT_REVALIDATE_GRACE_MS = 60_000;

export interface RevalidateUser {
  isActive: boolean;
  organizationId: string | null;
  role: string;
  tokenVersion: number;
  /** Require-MFA policy on and the user has no factor yet (enrollment funnel). */
  mfaEnrollRequired?: boolean;
}

export interface RevalidateDeps {
  loadUser: (id: string) => Promise<RevalidateUser | null>;
  loadOrgName: (organizationId: string) => Promise<string | null>;
  now?: () => number;
  timeoutMs?: number;
  graceMs?: number;
  log?: Pick<Console, "warn" | "error">;
}

type Token = Record<string, unknown>;

/** Max tracked sessions; older stamps are pruned first. */
const VALIDATED_MAP_MAX = 10_000;

type ValidatedMap = Map<string, number>;
const g = globalThis as typeof globalThis & { __crucibleJwtValidatedAt?: ValidatedMap };

function validatedMap(): ValidatedMap {
  if (!g.__crucibleJwtValidatedAt) g.__crucibleJwtValidatedAt = new Map();
  return g.__crucibleJwtValidatedAt;
}

function sessionKey(token: Token): string {
  return `${String(token.id)}:${token.tokenVersion === undefined ? "-" : String(token.tokenVersion)}`;
}

function stampValidated(key: string, at: number, graceMs: number): void {
  const map = validatedMap();
  map.delete(key); // re-insert so iteration order stays oldest-first
  map.set(key, at);
  if (map.size > VALIDATED_MAP_MAX) {
    for (const [k, t] of map) {
      if (map.size <= VALIDATED_MAP_MAX && at - t <= graceMs) break;
      map.delete(k);
    }
  }
}

/** Test-only: forget every server-side validation stamp. */
export function __resetJwtValidationStampsForTests(): void {
  validatedMap().clear();
}

/**
 * Returns the token to keep (updated on success, unchanged within the grace
 * window on a DB failure) or null to end the session.
 */
export async function revalidateToken<T extends Token>(token: T, deps: RevalidateDeps): Promise<T | null> {
  if (!token.id) return token;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? JWT_REVALIDATE_TIMEOUT_MS;
  const graceMs = deps.graceMs ?? JWT_REVALIDATE_GRACE_MS;
  const log = deps.log ?? console;

  // Reads only — the token is NOT mutated inside the race, so a late DB answer
  // arriving after a timeout can't rewrite a token we already returned.
  const check = async () => {
    const dbUser = await deps.loadUser(String(token.id));
    if (!dbUser || !dbUser.isActive) return { kind: "invalid" as const };
    if (token.tokenVersion !== undefined && dbUser.tokenVersion !== token.tokenVersion) {
      return { kind: "invalid" as const };
    }
    const orgName = dbUser.organizationId ? await deps.loadOrgName(dbUser.organizationId) : null;
    return { kind: "ok" as const, dbUser, orgName };
  };

  const key = sessionKey(token);
  const withinGrace = () => {
    const fromCookie = typeof token.lastValidatedAt === "number" ? token.lastValidatedAt : null;
    const fromServer = validatedMap().get(key) ?? null;
    const candidates = [fromCookie, fromServer].filter((x): x is number => x !== null);
    if (candidates.length === 0) return false;
    const last = Math.max(...candidates);
    return now() - last >= 0 && now() - last <= graceMs;
  };

  const timeout = Symbol("jwt-revalidate-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: Awaited<ReturnType<typeof check>> | typeof timeout;
  try {
    result = await Promise.race([
      check(),
      new Promise<typeof timeout>((resolve) => {
        timer = setTimeout(() => resolve(timeout), timeoutMs);
      }),
    ]);
  } catch (error) {
    if (withinGrace()) {
      log.warn("[auth] JWT re-validation error; keeping a token validated <60s ago:", error);
      return token;
    }
    log.error("[auth] JWT re-validation error; failing closed (no session):", error);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (result === timeout) {
    if (withinGrace()) {
      log.warn("[auth] JWT re-validation timed out; keeping a token validated <60s ago");
      return token;
    }
    log.warn("[auth] JWT re-validation timed out; failing closed (no session)");
    return null;
  }
  if (result.kind === "invalid") {
    validatedMap().delete(key);
    return null;
  }

  const { dbUser, orgName } = result;
  // Stamp under the CURRENT tokenVersion (same as the token, checked above).
  stampValidated(key, now(), graceMs);
  const next: Token = {
    ...token,
    organizationId: dbUser.organizationId,
    role: dbUser.role,
    tokenVersion: dbUser.tokenVersion,
    mfaEnrollRequired: dbUser.mfaEnrollRequired ?? false,
    lastValidatedAt: now(),
  };
  if (orgName) next.organizationName = orgName;
  return next as T;
}
