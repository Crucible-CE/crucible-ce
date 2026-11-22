// Authority to approve high-risk containment/eradication actions: the Incident
// Commander or the Executive Sponsor for that incident, falling back to an org
// admin if neither role is assigned. Centralised so the API + UI agree.
import { db } from "@/lib/db";
import { hasPermission, type RBACUser } from "@/lib/auth/rbac";

const APPROVER_ROLES = ["incident_commander", "exec_sponsor"];

export async function canApproveActions(user: RBACUser | null | undefined, incidentId: string): Promise<boolean> {
  if (!user?.id) return false;
  const roles = await db.incidentRoleAssignment.findMany({
    where: { incidentId, role: { in: APPROVER_ROLES }, userId: { not: null } },
    select: { userId: true },
  });
  // If approver roles are assigned, only those holders (or an admin) may approve.
  if (roles.length > 0) {
    if (roles.some((r) => r.userId === user.id)) return true;
    return hasPermission(user, "admin.access");
  }
  // No IC/Exec assigned yet — fall back to org admins so the incident isn't stuck.
  return hasPermission(user, "admin.access");
}
