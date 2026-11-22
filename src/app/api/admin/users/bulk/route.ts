import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission } from "@/lib/auth/rbac";
import { disconnectUserSockets } from "@/lib/socket/evict";
import { revokeIcsTokens } from "@/lib/ics/token";
import { acquireLastAdminLock, countRemainingActiveAdmins } from "@/lib/auth/last-admin";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";

// POST /api/admin/users/bulk
// Body: { userIds: string[]; action: "force_logout" | "deactivate" | "activate" }
// Applies the action to every listed user in the caller's organization.

const MAX_BATCH = 500;

type BulkAction = "force_logout" | "deactivate" | "activate";

const bulkBodySchema = z.object({ userIds: z.unknown(), action: z.unknown() });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Shared parser for the Content-Type / size / NUL guards; the field checks
  // below keep their specific error messages.
  const parsed = await parseJsonBody(req, bulkBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
    return NextResponse.json(
      { error: "userIds must be a non-empty array" },
      { status: 400 },
    );
  }
  const userIds = body.userIds.filter((v): v is string => typeof v === "string" && v.length <= LIMITS.ID);
  if (userIds.length === 0) {
    return NextResponse.json({ error: "userIds must contain strings" }, { status: 400 });
  }
  if (userIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large. Max ${MAX_BATCH}` },
      { status: 400 },
    );
  }

  const validActions: BulkAction[] = ["force_logout", "deactivate", "activate"];
  if (typeof body.action !== "string" || !validActions.includes(body.action as BulkAction)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const action = body.action as BulkAction;

  // Fetch targets (org-scoped) then operate only on the returned ids: an
  // admin can never touch users outside their org even if they guess ids.
  const targets = await db.user.findMany({
    where: { id: { in: userIds }, organizationId: session.user.organizationId },
    select: { id: true, email: true, organizationId: true },
  });

  if (targets.length === 0) {
    return NextResponse.json({ error: "No eligible users selected." }, { status: 404 });
  }

  // Self-protection: don't let an admin bulk-deactivate or bulk-force-logout themselves.
  const filtered = targets.filter((t) => t.id !== session.user.id);
  const selfSkipped = targets.length - filtered.length;
  const targetIds = filtered.map((t) => t.id);

  let affected = 0;
  if (targetIds.length > 0) {
    switch (action) {
      case "force_logout": {
        const result = await db.user.updateMany({
          where: { id: { in: targetIds } },
          data: { tokenVersion: { increment: 1 } },
        });
        affected = result.count;
        for (const uid of targetIds) disconnectUserSockets(uid);
        break;
      }
      case "deactivate": {
        // Last-admin lockout (#13): if the batch includes an active
        // administrator, count the admins that would remain and apply the
        // deactivation under the SAME per-org advisory lock the single-user
        // PATCH/DELETE paths take.
        const orgId = session.user.organizationId;
        const result = await db.$transaction(async (tx) => {
          const adminTargets = await tx.user.count({
            where: { id: { in: targetIds }, organizationId: orgId, role: "administrator", isActive: true },
          });
          if (adminTargets > 0) {
            await acquireLastAdminLock(tx, orgId);
            const remaining = await countRemainingActiveAdmins(tx, orgId, targetIds);
            if (remaining === 0) return null;
          }
          return tx.user.updateMany({
            where: { id: { in: targetIds }, organizationId: orgId },
            data: { isActive: false, tokenVersion: { increment: 1 } },
          });
        });
        if (!result) {
          return NextResponse.json(
            { error: "Can't deactivate the last active administrator. Promote another administrator first.", code: "last_admin" },
            { status: 409 },
          );
        }
        affected = result.count;
        // Live sockets and calendar-feed links die with the accounts.
        for (const uid of targetIds) {
          disconnectUserSockets(uid);
          await revokeIcsTokens({ userId: uid });
        }
        break;
      }
      case "activate": {
        const result = await db.user.updateMany({
          where: { id: { in: targetIds } },
          data: { isActive: true },
        });
        affected = result.count;
        break;
      }
    }
  }

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: `user.bulk_${action}`,
      targetType: "user",
      targetId: null,
      targetLabel: `${affected} user${affected === 1 ? "" : "s"}`,
      metadata: {
        affectedUserIds: targetIds,
        selfSkipped,
        requested: userIds.length,
      },
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record user.bulk_*", err);
  }

  return NextResponse.json({
    success: true,
    affected,
    selfSkipped,
    requested: userIds.length,
  });
}
