import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { recordActivity } from "@/lib/security/activity-log";
import { hasPermission } from "@/lib/auth/rbac";
import { disconnectUserSockets } from "@/lib/socket/evict";

// POST /api/admin/users/[id]/force-logout
// Bumps tokenVersion on the target user. Every currently active JWT for this
// user becomes invalid on the next re-validation (~immediately, since auth.js
// revalidates on every request). Use during incident response to kick a
// suspected compromised account off all devices.

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
    select: { id: true, email: true, organizationId: true },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db.user.update({
    where: { id },
    data: { tokenVersion: { increment: 1 } },
  });
  disconnectUserSockets(id);

  void recordActivity({
    action: "session.revoked",
    userId: target.id,
    organizationId: target.organizationId,
    metadata: { reason: "admin_force_logout", actorUserId: session.user.id },
  });

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: "user.force_logout",
      targetType: "user",
      targetId: id,
      targetLabel: target.email,
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record user.force_logout", err);
  }

  return NextResponse.json({ success: true, email: target.email });
}
