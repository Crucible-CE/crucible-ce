// Require-MFA policy decisions. Pure and EDGE-SAFE (imported by
// src/middleware.ts): no node:* imports, no DB.

/** A user must enroll before using the app: policy on, no factor yet. */
export function mfaEnrollRequired(input: { requireMfa: boolean; hasMfa: boolean }): boolean {
  return input.requireMfa && !input.hasMfa;
}

/**
 * Removing a factor that would leave the user with none is refused while the
 * org requires MFA (they would be locked into the enrollment funnel; adding
 * the replacement first keeps them signed in).
 */
export function canRemoveFactor(input: { requireMfa: boolean; factorsAfterRemoval: number }): boolean {
  return !input.requireMfa || input.factorsAfterRemoval > 0;
}

/** Turning the policy on requires the admin doing it to have MFA (no self lock-out). */
export function canEnablePolicy(input: { actorHasMfa: boolean }): { ok: true } | { ok: false; error: string } {
  if (input.actorHasMfa) return { ok: true };
  return {
    ok: false,
    error: "Turn on two-factor sign-in for your own account first, in Settings > Security.",
  };
}

// ---- Sign-in wall (middleware) ---------------------------------------------

export const MFA_FUNNEL_PATH = "/mfa-setup-required";

export type WallDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "forbidden"; code: "mfa_enrollment_required"; error: string };

const isApi = (p: string) => p === "/api" || p.startsWith("/api/");

/**
 * Whether a signed-in request hits the require-MFA enrollment wall. It
 * allow-lists only the routes the enrollment page needs.
 */
export function signInWall(
  pathname: string,
  claims: { mfaEnrollRequired?: boolean },
): WallDecision {
  if (claims.mfaEnrollRequired === true) {
    const allowed =
      pathname === MFA_FUNNEL_PATH ||
      pathname === "/api/user/mfa" ||
      pathname.startsWith("/api/user/mfa/") ||
      pathname.startsWith("/api/auth");
    if (allowed) return { kind: "allow" };
    return isApi(pathname)
      ? { kind: "forbidden", code: "mfa_enrollment_required", error: "Two-factor sign-in required" }
      : { kind: "redirect", to: MFA_FUNNEL_PATH };
  }
  return { kind: "allow" };
}
