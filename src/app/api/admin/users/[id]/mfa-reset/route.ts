import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { requireAdminReauth } from "@/lib/auth/mfa/http";
import { resetMemberMfa } from "@/lib/auth/mfa/admin-reset";

// POST /api/admin/users/[id]/mfa-reset
// For a member who lost their phone and their recovery codes: removes every
// two-factor method (authenticator app, security keys, recovery codes) and
// bumps tokenVersion so all their sessions end. They sign in with their
// password alone next time (and, under the require-MFA policy, enroll again
// straight away). Needs the admin's own step-up grant ("confirm it's you").
// Works on other administrators too (CE has one admin tier). The member is
// emailed (when email is configured) and the reset is audited either way
// (src/lib/auth/mfa/admin-reset.ts, shared with the server recovery command).
// Not for your own account: use Settings > Security.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext) {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stepUp = await requireAdminReauth(req, admin.userId);
  if (stepUp) return stepUp;
  const { id } = await context.params;
  if (id === admin.userId) {
    return NextResponse.json({ error: "Manage your own two-factor sign-in in Settings > Security." }, { status: 400 });
  }
  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, organizationId: true } });
  if (!target || target.organizationId !== admin.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await resetMemberMfa(target, {
    userId: admin.userId,
    email: admin.email,
    name: admin.name,
    label: admin.name ?? admin.email ?? null,
  });

  return NextResponse.json({ success: true, email: target.email });
}
