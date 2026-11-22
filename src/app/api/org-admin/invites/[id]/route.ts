import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission, type RBACUser } from "@/lib/auth/rbac";

// DELETE /api/org-admin/invites/[id] — revoke an invite for the caller's org.
// Org admins (admin.access) may only revoke invites belonging to their own org.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  const user = session?.user as RBACUser | undefined;
  if (
    !hasPermission(user, "admin.access") ||
    !session?.user?.organizationId ||
    !session.user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const invite = await db.orgInvite.findUnique({
    where: { id },
    select: {
      id: true,
      usedAt: true,
      revokedAt: true,
      inviteeEmail: true,
      organizationId: true,
    },
  });

  if (!invite || invite.organizationId !== session.user.organizationId) {
    // Don't leak existence of invites in other orgs.
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  if (invite.usedAt) {
    return NextResponse.json(
      { error: "This invite was already used. It can't be revoked." },
      { status: 409 },
    );
  }
  if (invite.revokedAt) {
    return NextResponse.json({ success: true, alreadyRevoked: true });
  }

  await db.orgInvite.update({
    where: { id },
    data: { revokedAt: new Date() },
  });

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: invite.organizationId,
      action: "org_invite.revoke",
      targetType: "org_invite",
      targetId: id,
      targetLabel: invite.inviteeEmail ?? "(invite)",
      metadata: { organizationId: invite.organizationId, scope: "org_admin" },
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record org_invite.revoke", err);
  }

  return NextResponse.json({ success: true });
}
