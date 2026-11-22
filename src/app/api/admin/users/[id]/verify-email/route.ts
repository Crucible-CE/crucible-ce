import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission } from "@/lib/auth/rbac";

// ---------------------------------------------------------------------------
// POST /api/admin/users/[id]/verify-email
// Force-marks a user as emailVerified=now. Useful when a user can't receive
// the verification email (typo'd address, spam filter, deliverability issue).
// Clears any outstanding VerificationToken rows for that identifier.
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      emailVerified: true,
      organizationId: true,
    },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (target.emailVerified) {
    return NextResponse.json({
      success: true,
      alreadyVerified: true,
      email: target.email,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { emailVerified: new Date() },
    });
    // Clean up any stale verification tokens (harmless if none exist).
    await tx.verificationToken.deleteMany({
      where: { identifier: target.email },
    });
  });

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: "user.force_verify_email",
      targetType: "user",
      targetId: id,
      targetLabel: target.email,
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record user.force_verify_email", err);
  }

  return NextResponse.json({ success: true, email: target.email });
}
