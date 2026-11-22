// Client-side sign-out, single-flight.
//
// `signOut({ redirect: false })` POSTs /api/auth/signout and then refetches
// the session. That refetch flips useSession() to "unauthenticated", which the
// platform shell's stale-cookie self-heal used to answer with a SECOND
// signOut — and the page then navigated away mid-request, so the aborted
// fetch surfaced in the console as `AuthError: Failed to fetch`. Every
// sign-out goes through here: one in-flight sign-out per page, the self-heal
// skips while it runs, and a network abort during the hand-off to /login is
// swallowed (the cookie is cleared server-side by then, or /login re-gates).

import { signOut } from "next-auth/react";

let inFlight: Promise<void> | null = null;

/** True while a sign-out is in progress (the self-heal must not start another). */
export function isSigningOut(): boolean {
  return inFlight !== null;
}

/** Sign out once and land on `to` (default /login). Safe to call repeatedly. */
export function signOutAndRedirect(to = "/login"): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await signOut({ redirect: false });
    } catch {
      // Aborted by navigation or a transient network error — fall through to
      // the redirect; middleware gates /login-required pages either way.
    }
    window.location.assign(to);
  })();
  return inFlight;
}
