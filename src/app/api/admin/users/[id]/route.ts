import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission, ORG_ROLES } from "@/lib/auth/rbac";
import { recordActivity } from "@/lib/security/activity-log";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { disconnectUserSockets } from "@/lib/socket/evict";
import { revokeIcsTokens } from "@/lib/ics/token";
import { acquireLastAdminLock, countRemainingActiveAdmins } from "@/lib/auth/last-admin";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const updateSchema = z
  .object({
    role: z.enum(ORG_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const deleteSchema = z.object({ confirmEmail: z.string().max(LIMITS.EMAIL).optional() });

// PATCH /api/admin/users/[id]
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const parsed = await parseJsonBody(req, updateSchema);
  if (!parsed.ok) return parsed.response;

  if (id === session.user.id && parsed.data.isActive === false) {
    return NextResponse.json(
      { error: "You can't deactivate your own account." },
      { status: 400 },
    );
  }

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      role: true,
      isActive: true,
    },
  });

  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // An admin can't change their own role (another admin must do it), which
  // also stops the last admin demoting themselves.
  if (id === session.user.id && parsed.data.role !== undefined && parsed.data.role !== target.role) {
    return NextResponse.json({ error: "You can't change your own role." }, { status: 400 });
  }

  // Deactivation bumps tokenVersion to immediately invalidate any live tokens.
  const requiresTokenRevocation = parsed.data.isActive === false;
  const orgId = session.user.organizationId;
  // Does this change take an active administrator out of the admin pool?
  const removesAdmin =
    target.role === "administrator" &&
    target.isActive &&
    ((parsed.data.role !== undefined && parsed.data.role !== "administrator") || parsed.data.isActive === false);

  const fields = parsed.data;
  type Outcome = { ok: true; user: Awaited<ReturnType<typeof updateUser>> } | { ok: false };
  function updateUser(tx: Pick<typeof db, "user">) {
    return tx.user.update({
      where: { id },
      data: {
        ...(fields.role !== undefined ? { role: fields.role } : {}),
        ...(fields.isActive !== undefined ? { isActive: fields.isActive } : {}),
        ...(requiresTokenRevocation ? { tokenVersion: { increment: 1 } } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        organizationId: true,
      },
    });
  }

  // Last-admin lockout: the count and the update run under one per-org
  // advisory lock, so two admins demoting each other concurrently can't both
  // succeed and leave the org with no administrator.
  const outcome: Outcome = await db.$transaction(async (tx) => {
    if (removesAdmin) {
      await acquireLastAdminLock(tx, orgId);
      const others = await countRemainingActiveAdmins(tx, orgId, [id]);
      if (others === 0) return { ok: false };
    }
    return { ok: true, user: await updateUser(tx) };
  });
  if (!outcome.ok) {
    return NextResponse.json(
      { error: "This is the last active administrator. Promote another administrator first.", code: "last_admin" },
      { status: 409 },
    );
  }
  const updated = outcome.user;
  if (requiresTokenRevocation || parsed.data.role !== undefined) disconnectUserSockets(updated.id);
  // A deactivated user's calendar-feed links die with their sessions.
  if (requiresTokenRevocation) await revokeIcsTokens({ userId: updated.id });

  if (requiresTokenRevocation) {
    void recordActivity({
      action: "session.revoked",
      userId: updated.id,
      organizationId: updated.organizationId,
      metadata: {
        reason: "deactivated",
        actorUserId: session.user.id,
      },
    });
  }

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: parsed.data.isActive !== undefined ? "user.status_change" : "user.update",
      targetType: "user",
      targetId: updated.id,
      targetLabel: updated.email,
      metadata: parsed.data,
    });
  } catch (auditError) {
    console.error("[admin-audit] Failed to record user update", auditError);
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
    lastLoginAt: updated.lastLoginAt ? updated.lastLoginAt.toISOString() : null,
    createdAt: updated.createdAt.toISOString(),
  });
}

// DELETE /api/admin/users/[id]
// Org-admin hard delete of a member of the caller's organization. Auth-related
// records (notifications, preferences) cascade; activity
// logs keep their rows with userId nulled. Users who reported incidents cannot
// be deleted (the incident record must keep its reporter); deactivate instead.
export async function DELETE(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "You can't delete your own account." },
      { status: 403 },
    );
  }

  const target = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      organizationId: true,
      _count: {
        select: {
          reportedIncidents: true,
        },
      },
    },
  });

  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Require confirmEmail in body for safety.
  const parsedBody = await parseJsonBody(req, deleteSchema);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.data;

  // Case and whitespace insensitive: emails are stored lowercased, but the
  // admin types this by hand in the confirmation dialog.
  const confirmEmail =
    typeof body.confirmEmail === "string"
      ? body.confirmEmail.trim().toLowerCase()
      : "";
  if (confirmEmail !== target.email.toLowerCase()) {
    return NextResponse.json(
      { error: "Type the user's email to confirm." },
      { status: 400 },
    );
  }

  // Reporters are a required reference on Incident: keep the record intact.
  if (target._count.reportedIncidents > 0) {
    return NextResponse.json(
      {
        error:
          "This user reported incidents and can't be deleted. Deactivate the account instead.",
      },
      { status: 409 },
    );
  }

  // Cannot delete the last ACTIVE administrator of the organization (#13):
  // the count and the delete run under the same per-org advisory lock the
  // PATCH demote/deactivate path takes, so concurrent removals serialize.
  const orgId = session.user.organizationId;
  const deleted = await db.$transaction(async (tx) => {
    if (target.role === "administrator") {
      await acquireLastAdminLock(tx, orgId);
      const others = await countRemainingActiveAdmins(tx, orgId, [id]);
      if (others === 0) return false;
    }

    // 1. Nullify nullable assignment references.
    await tx.incident.updateMany({
      where: { assignedToId: id },
      data: { assignedToId: null },
    });

    // 2. Remove invites this user minted (required creator reference).
    await tx.orgInvite.deleteMany({ where: { createdById: id } });

    // 3. Delete the user; remaining relations cascade or set null per schema.
    await tx.user.delete({ where: { id } });
    return true;
  });
  if (!deleted) {
    return NextResponse.json(
      { error: "Can't delete the last administrator.", code: "last_admin" },
      { status: 409 },
    );
  }

  // #4: a deleted account's live sockets die with it, exactly like
  // force-logout / deactivate (its JWT is already unusable: no user row).
  disconnectUserSockets(id);

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: "user.delete",
      targetType: "user",
      targetId: target.id,
      targetLabel: target.email,
      metadata: {
        name: target.name,
      },
    });
  } catch (auditError) {
    console.error("[admin-audit] Failed to record user.delete", auditError);
  }

  return NextResponse.json({ success: true, deleted: target.email });
}
