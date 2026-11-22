import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset";
import { activeEmailTransport } from "@/lib/email/transport";
import { hasPermission } from "@/lib/auth/rbac";
import { issuePasswordResetLink } from "@/lib/auth/password-reset";

// ---------------------------------------------------------------------------
// POST /api/admin/users/[id]/send-password-reset
// Admin "Email reset link". Creates a 1-hour single-use reset link and emails
// it to the user (the same link the public forgot-password flow sends, just
// initiated by an org admin). Without an email transport it refuses; use
// "Copy reset link" (copy-reset-link) instead.
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
  if (activeEmailTransport() === null) {
    return NextResponse.json(
      { error: "Email isn't set up on this server. Use Copy reset link." },
      { status: 409 },
    );
  }

  const { id } = await context.params;

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      organizationId: true,
    },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Earlier unused links for this user stop working; the latest one wins.
  const link = await issuePasswordResetLink(target.email);

  // Fire-and-forget: the token is already in the DB; email delivery failure is
  // logged but not fatal. The admin can re-trigger if it never arrives.
  sendPasswordResetEmail(target.email, target.name ?? "there", link.url).catch(
    (err) => {
      console.error("[admin-password-reset] email failure:", {
        to: target.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  );

  await recordAdminAuditLog({
    actorUserId: session.user.id,
    actorEmail: session.user.email ?? null,
    actorName: session.user.name ?? null,
    organizationId: session.user.organizationId,
    action: "user.admin_password_reset",
    targetType: "user",
    targetId: id,
    targetLabel: target.email,
  });

  return NextResponse.json({ success: true, email: target.email });
}
