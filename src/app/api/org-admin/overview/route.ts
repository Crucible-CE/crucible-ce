import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { ACTIVE_STATUS_FILTER } from "@/lib/incident/status";

// ---------------------------------------------------------------------------
// GET /api/org-admin/overview — the org-admin landing page's stat strip.
// Org admins (admin.access), scoped to their own organization.
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = session.user.organizationId;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const [members, activeMembers, pendingInvites, openIncidents, recentAudit] =
    await Promise.all([
      db.user.count({ where: { organizationId: orgId } }),
      db.user.count({ where: { organizationId: orgId, isActive: true } }),
      db.orgInvite.count({
        where: { organizationId: orgId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
      }),
      db.incident.count({
        // Same visibility funnel as every incident list (admins see locked ones).
        where: { ...accessibleIncidentsWhere(session.user, { excludeTraining: true }), status: ACTIVE_STATUS_FILTER },
      }),
      db.adminAuditLog.count({
        where: { organizationId: orgId, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

  return NextResponse.json({
    stats: { members, activeMembers, pendingInvites, openIncidents, recentAudit },
  });
}
