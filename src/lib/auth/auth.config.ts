import type { NextAuthConfig } from "next-auth";
import { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ipFromRequest } from "@/lib/security/rate-limit";
import { recordActivity } from "@/lib/security/activity-log";
import {
  checkLoginThrottle,
  clearLoginPair,
  recordLoginFailure,
} from "@/lib/security/login-throttle";
import { readKnownDeviceCookie, setKnownDeviceCookie, verifyKnownDevice } from "@/lib/auth/known-device";
import { MfaRequiredError, authorizeMfa, grantReauthOnSignIn, sessionUser, startMfaLogin } from "@/lib/auth/mfa/login";
import { userHasMfa } from "@/lib/auth/mfa/service";
import { WALL_SELECT, wallsFromRow } from "@/lib/auth/mfa/state";
import { revalidateToken } from "@/lib/auth/jwt-revalidate";
import { disconnectUserSockets } from "@/lib/socket/evict";

// Thrown when a credentials sign-in is attempted before the user has verified
// their email. NextAuth surfaces `code` to the client on signIn({ redirect: false }).
export class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}

// Login brute-force defense: see src/lib/security/login-throttle.ts (per-IP
// cap + progressive per-email+IP and per-email delay; a known-device cookie
// skips the per-email gates). Only FAILED attempts are counted — a user
// logging in repeatedly through the day does not burn their own quota.
//
// Generic "Invalid email or password" is preserved; a throttled attempt is
// indistinguishable from a wrong password to the attacker.

// Constant bcrypt hash (cost 12, same as every stored hash) of a password
// nobody uses. Unknown / inactive / passwordless accounts are compared against
// it so their response time matches a real wrong-password attempt (no
// account-enumeration timing oracle).
const DUMMY_BCRYPT_HASH = "$2b$12$4bp/b1vXqetk6tSpcb0IKu/twUr8RlBR.aP9M4poMbCu0G7hqlB7q";

/** The credentials authorize() logic, exported for tests. */
export async function authorizeCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
  req: Request | undefined,
) {
  if (!credentials?.email || !credentials?.password) return null;
  if (typeof credentials.email !== "string" || typeof credentials.password !== "string") return null;

  // Normalize email to lowercase for case-insensitive login. Also
  // trim — browsers / password managers occasionally submit a trailing
  // space, which would otherwise produce a silent user_not_found.
  const email = credentials.email.toLowerCase().trim();
  const password = credentials.password;
  // A NUL in the email 500s at Postgres; no real credential contains one.
  if (email.includes("\u0000") || password.includes("\u0000") || email.length > 320 || password.length > 256) {
    return null;
  }
  const ip = ipFromRequest(req);

  const user = await db.user.findUnique({ where: { email } });
  // Same code path whether or not the account exists (verify runs one HMAC
  // either way); never throws on a malformed cookie.
  const trustedDevice = verifyKnownDevice(readKnownDeviceCookie(req), user);

  // Throttle check BEFORE bcrypt. A tripped gate short-circuits to null —
  // same visible outcome as a wrong password — and is NOT counted as another
  // failure (blocked attempts never extend the block).
  const gate = await checkLoginThrottle({ email, ip, trustedDevice });
  if (!gate.allowed) return null;

  // Always run one bcrypt compare (against the dummy hash when there is no
  // usable account) so timing does not reveal whether the email exists.
  const usable = !!user && !!user.passwordHash && user.isActive;
  const valid = await bcrypt.compare(password, usable ? user.passwordHash! : DUMMY_BCRYPT_HASH);

  if (!usable || !valid) {
    // Unknown-email and inactive-account misses count too: both are useful
    // signals to an attacker probing account existence.
    await recordLoginFailure({ email, ip });
    // Activity trail: unknown email → userId null + emailHash (salted hash,
    // never the raw address) carries the enumeration signal. Fire-and-forget.
    void recordActivity({
      action: "login.failure",
      userId: user?.id ?? null,
      organizationId: user?.organizationId ?? null,
      email: user ? null : email,
      req,
      metadata: {
        reason: !user ? "unknown_email" : !user.isActive ? "inactive" : !user.passwordHash ? "no_password" : "bad_password",
      },
    });
    return null;
  }

  // Hard block unverified logins. Not counted as a failed attempt: the
  // credentials were correct.
  if (!user.emailVerified) {
    throw new EmailNotVerifiedError();
  }

  // Two-factor sign-in: the password was right, but no session yet. Open a
  // pending ticket (signed cookie) and tell the client to ask for the second
  // factor; the "mfa" provider completes the sign-in (src/lib/auth/mfa/login.ts).
  // Nothing here skips it: not the known-device cookie, not a fresh password.
  // The throttle pair and the device cookie are only updated once MFA passes.
  if (await userHasMfa(user.id)) {
    await startMfaLogin({ id: user.id, tokenVersion: user.tokenVersion }, req);
    throw new MfaRequiredError();
  }

  await clearLoginPair({ email, ip });
  await setKnownDeviceCookie(user, req);
  // A fresh sign-in counts as "confirm it's you" for 5 minutes.
  await grantReauthOnSignIn(user, req);

  // IP asymmetry fix: events.signIn (where login.success is logged, after the
  // sign-in fully completes) receives no request; sessionUser() stashes the
  // derived IP fields for it.
  return sessionUser(user, req);
}

const credentialsProvider = Credentials({
  name: "credentials",
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  authorize: (credentials, req) => authorizeCredentials(credentials, req),
});

// Second sign-in step for accounts with MFA. Needs the pending-ticket cookie
// set by the credentials step; returns the user only after a valid factor.
const mfaProvider = Credentials({
  id: "mfa",
  name: "mfa",
  credentials: {
    method: { label: "Method", type: "text" },
    code: { label: "Code", type: "text" },
    response: { label: "WebAuthn response", type: "text" },
  },
  authorize: (credentials, req) => authorizeMfa(credentials, req),
});

/**
 * Sign-out revokes the session everywhere: bump tokenVersion so this JWT (and
 * every other one this user holds) fails the jwt() re-validation on its next
 * use. Conditional on the token's own tokenVersion still being current, so a
 * stale / already-revoked cookie replayed at /api/auth/signout can't keep
 * logging the user out of fresh sessions.
 */
export async function revokeOnSignOut(token: Record<string, unknown> | null | undefined): Promise<boolean> {
  if (!token?.id) return false;
  const id = String(token.id);
  try {
    const res = await db.user.updateMany({
      where: {
        id,
        ...(typeof token.tokenVersion === "number" ? { tokenVersion: token.tokenVersion } : {}),
      },
      data: { tokenVersion: { increment: 1 } },
    });
    if (res.count > 0) disconnectUserSockets(id);
    return res.count > 0;
  } catch (err) {
    console.error("[auth] sign-out revocation failed:", err);
    return false;
  }
}

export const authConfig: NextAuthConfig = {
  // Bound the JWT lifetime: an absolute 8h cap with a 15-min rolling refresh,
  // instead of the 30-day default. The jwt() callback re-validates against the
  // DB every request, so this also caps how long a stolen token can live.
  session: { strategy: "jwt", maxAge: 8 * 60 * 60, updateAge: 15 * 60 },
  trustHost: true,

  pages: {
    signIn: "/login",
  },

  providers: [credentialsProvider, mfaProvider],

  // Auth/security activity trail. login.success fires HERE, not in
  // authorize() — authorize can still be rejected downstream (EmailNotVerified,
  // signIn callback). All writes are fire-and-forget and never block auth.
  events: {
    async signIn({ user, account }) {
      const u = user as Record<string, unknown>;
      const stashedIp = u._loginIp as { ipHash: string | null; ipLastOctet: string | null } | undefined;
      delete u._loginIp;
      void recordActivity({
        action: "login.success",
        userId: (u.id as string) ?? null,
        organizationId: (u.organizationId as string | null) ?? null,
        ip: stashedIp ?? { ipHash: null, ipLastOctet: null },
        metadata: { provider: account?.provider ?? "credentials", mfa: account?.provider === "mfa" },
      });
    },
    async signOut(message) {
      // jwt strategy → { token }. Explicit client sign-out only; idle-timeout
      // expiry has no server hook and is documented best-effort-uncaptured.
      const token = "token" in message ? (message.token as Record<string, unknown> | null) : null;
      if (!token?.id) return;
      const revoked = await revokeOnSignOut(token);
      if (revoked) {
        void recordActivity({
          action: "session.revoked",
          userId: token.id as string,
          organizationId: (token.organizationId as string | null) ?? null,
          metadata: { reason: "sign_out" },
        });
      }
      void recordActivity({
        action: "logout",
        userId: token.id as string,
        organizationId: (token.organizationId as string | null) ?? null,
      });
    },
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: seed the token from the authorize() return value.
        token.id = user.id;
        token.organizationId = (user as Record<string, unknown>).organizationId as string;
        token.role = (user as Record<string, unknown>).role as string;
      }

      // Re-validate security-critical fields from DB on every request, with a
      // hard timeout and a 60 s grace for a token validated just before a DB
      // stall; otherwise fail closed. See src/lib/auth/jwt-revalidate.ts.
      return revalidateToken(token, {
        loadUser: async (id) => {
          const u = await db.user.findUnique({
            where: { id },
            select: {
              isActive: true,
              organizationId: true,
              role: true,
              tokenVersion: true,
              ...WALL_SELECT,
            },
          });
          if (!u) return null;
          const walls = wallsFromRow(u);
          return {
            isActive: u.isActive,
            organizationId: u.organizationId,
            role: u.role,
            tokenVersion: u.tokenVersion,
            // Require-MFA policy funnel (middleware + platform layout).
            mfaEnrollRequired: walls.mfaEnrollRequired,
          };
        },
        loadOrgName: async (organizationId) =>
          (await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? null,
      });
    },

    async session({ session, token }) {
      // The jwt() callback always re-validates from DB and returns null for
      // deactivated/revoked tokens. If we reach here the token is valid.
      if (!session.user || !token) return session;

      const t = token as Record<string, unknown>;

      session.user.id = t.id as string;
      session.user.organizationId = t.organizationId as string | undefined;
      session.user.organizationName = t.organizationName as string | undefined;
      session.user.role = t.role as string | undefined;
      session.user.mfaEnrollRequired = (t.mfaEnrollRequired as boolean | undefined) ?? false;

      return session;
    },
  },
};
