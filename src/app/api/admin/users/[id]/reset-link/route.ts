import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { requireAdminReauth } from "@/lib/auth/mfa/http";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { issuePasswordResetLink } from "@/lib/auth/password-reset";
import { checkRateLimit } from "@/lib/security/rate-limit";

// POST /api/admin/users/[id]/reset-link
// Admin "Copy reset link": a one-time password reset link for a member, shown
// to the admin once so they can pass it on (works without email). Same link
// as the forgot-password email: random token, only its hash stored, single
// use, 1 hour, earlier unused links for that member stop working. Completing
// it never skips two-factor sign-in. Needs the admin's own step-up grant
// ("confirm it's you"). Audited without the token. Not for your own account.

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: Request, context: RouteContext) {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const stepUp = await requireAdminReauth(req, admin.userId);
  if (stepUp) return stepUp;

  const { id } = await context.params;
  if (id === admin.userId) {
    return NextResponse.json({ error: "Change your own password in Settings." }, { status: 400 });
  }

  const limit = await checkRateLimit({ namespace: "admin-reset-link:admin", identifier: admin.userId, windowMs: HOUR_MS, max: 20 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many reset links. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, isActive: true, organizationId: true },
  });
  if (!target || target.organizationId !== admin.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!target.isActive) {
    return NextResponse.json({ error: "Activate this account first." }, { status: 400 });
  }

  const link = await issuePasswordResetLink(target.email);

  await recordAdminAuditLog({
    actorUserId: admin.userId,
    actorEmail: admin.email,
    actorName: admin.name,
    organizationId: admin.organizationId,
    action: "user.reset_link_created",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    metadata: { expiresAt: link.expiresAt.toISOString() },
  });

  return NextResponse.json({ url: link.url, expiresAt: link.expiresAt.toISOString(), name: target.name, email: target.email });
}
