// Shared plumbing for the /api/user/mfa/* routes: the signed-in user, the
// step-up ("confirm it's you") grant, and the policy guard on removing the
// last factor.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isHttpsRequest } from "@/lib/auth/known-device";
import { MFA_REAUTH_COOKIE, MFA_REAUTH_PATH, MFA_REAUTH_TTL_SEC, readCookie, signReauthCookie, verifyReauthCookie } from "./cookies";
import { canRemoveFactor } from "./policy";

export interface MfaUser {
  id: string;
  email: string;
  name: string | null;
  organizationId: string;
  tokenVersion: number;
  passwordHash: string | null;
  requireMfa: boolean;
}

/** The signed-in, active user (fresh from the DB), or a 401 response. */
export async function mfaUser(): Promise<{ ok: true; user: MfaUser } | { ok: false; response: NextResponse }> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const u = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      organizationId: true,
      tokenVersion: true,
      passwordHash: true,
      isActive: true,
      organization: { select: { requireMfa: true } },
    },
  });
  if (!u || !u.isActive) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return {
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      organizationId: u.organizationId,
      tokenVersion: u.tokenVersion,
      passwordHash: u.passwordHash,
      requireMfa: u.organization?.requireMfa ?? false,
    },
  };
}

/** Expiry (ms) of this request's step-up grant, or null. */
export function reauthExpiry(req: Request, user: Pick<MfaUser, "id" | "tokenVersion">): number | null {
  const exp = verifyReauthCookie(readCookie(req, MFA_REAUTH_COOKIE), user);
  return exp === null ? null : exp * 1000;
}

/** null when the request carries a valid step-up grant, else the 403 to return. */
export function requireReauth(req: Request, user: Pick<MfaUser, "id" | "tokenVersion">): NextResponse | null {
  if (reauthExpiry(req, user) !== null) return null;
  return NextResponse.json(
    { error: "Confirm it's you first.", code: "reauth_required" },
    { status: 403 },
  );
}

/** A JSON response carrying a fresh step-up grant cookie (body gets reauthUntil), or null without AUTH_SECRET. */
export function grantReauth(req: Request, user: Pick<MfaUser, "id" | "tokenVersion">, body: Record<string, unknown> = {}): NextResponse | null {
  const expSec = Math.floor(Date.now() / 1000) + MFA_REAUTH_TTL_SEC;
  const value = signReauthCookie(user, expSec);
  if (!value) return null;
  const res = NextResponse.json({ ...body, ok: true, reauthUntil: new Date(expSec * 1000).toISOString() });
  res.cookies.set(MFA_REAUTH_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHttpsRequest(req),
    path: MFA_REAUTH_PATH,
    maxAge: MFA_REAUTH_TTL_SEC,
  });
  return res;
}

/** 409 when the org requires MFA and this removal would leave no factor. */
export function guardLastFactor(user: Pick<MfaUser, "requireMfa">, factorsAfterRemoval: number): NextResponse | null {
  if (canRemoveFactor({ requireMfa: user.requireMfa, factorsAfterRemoval })) return null;
  return NextResponse.json(
    {
      error: "Your organization requires two-factor sign-in. Add another method first.",
      code: "mfa_required_by_policy",
    },
    { status: 409 },
  );
}

/**
 * Step-up for administrator actions on other accounts (MFA reset, reset
 * link, require-MFA policy): the admin's own fresh "confirm it's you"
 * grant, checked against their current tokenVersion. null = allowed.
 */
export async function requireAdminReauth(req: Request, adminUserId: string): Promise<NextResponse | null> {
  const u = await db.user.findUnique({ where: { id: adminUserId }, select: { id: true, tokenVersion: true } });
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return requireReauth(req, u);
}
