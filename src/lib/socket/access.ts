// =============================================================================
// Crucible CE — Socket access decisions (no socket.io runtime import)
// =============================================================================
// Kept apart from ./server.ts so Next.js route handlers (via ./evict.ts) can
// re-run the war-room access check without bundling socket.io / next-auth/jwt.
// Both functions defer to `decideIncidentAccess` — the SAME decision the
// incident REST routes and `accessibleIncidentsWhere` make — so a locked war
// room never streams to anyone the REST API would 404:
//   - org scope is the boundary;
//   - unlocked → every org member;
//   - locked   → participants, the IC, and org admins (the reporter and
//                assignee only via the participant allowlist);
//   - soft-deleted → nobody.
// =============================================================================

import { db } from "@/lib/db";
import { decideIncidentAccess } from "@/lib/incident/access";

export interface SocketAccessUser {
  userId: string;
  organizationId?: string;
  role?: string;
}

/** May `auth` join / stay in the `incident:{id}` war-room room? */
export async function canAccessIncident(
  incidentId: string,
  auth: SocketAccessUser,
): Promise<boolean> {
  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    select: {
      organizationId: true,
      restricted: true,
      deletedAt: true,
      participants: { where: { userId: auth.userId }, select: { id: true } },
      roleAssignments: {
        where: { role: "incident_commander", userId: auth.userId },
        select: { id: true },
      },
    },
  });
  if (!incident) return false;
  return decideIncidentAccess(
    { id: auth.userId, organizationId: auth.organizationId, role: auth.role },
    incident,
    incident.participants.length > 0,
    incident.roleAssignments.length > 0,
  );
}

/**
 * Batch form of {@link canAccessIncident} for eviction: which of `userIds` may
 * still access the incident, judged on each user's CURRENT DB state (role,
 * org, isActive) rather than whatever their socket handshake carried. Two
 * queries regardless of how many sockets are in the room. A deleted incident
 * or an inactive / deleted user yields no access.
 */
export async function usersWithIncidentAccess(
  incidentId: string,
  userIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  const allowed = new Set<string>();
  if (ids.length === 0) return allowed;

  const [incident, users] = await Promise.all([
    db.incident.findUnique({
      where: { id: incidentId },
      select: {
        organizationId: true,
        restricted: true,
        deletedAt: true,
        participants: { where: { userId: { in: ids } }, select: { userId: true } },
        roleAssignments: {
          where: { role: "incident_commander", userId: { in: ids } },
          select: { userId: true },
        },
      },
    }),
    db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, organizationId: true, role: true, isActive: true },
    }),
  ]);
  if (!incident) return allowed;

  const participantIds = new Set(incident.participants.map((p) => p.userId));
  const icIds = new Set(incident.roleAssignments.map((r) => r.userId));
  for (const u of users) {
    if (!u.isActive) continue;
    if (
      decideIncidentAccess(
        { id: u.id, organizationId: u.organizationId, role: u.role },
        incident,
        participantIds.has(u.id),
        icIds.has(u.id),
      )
    ) {
      allowed.add(u.id);
    }
  }
  return allowed;
}
