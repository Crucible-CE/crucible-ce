import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { canManageIncidentLock, canUnlockIncidentFor, incidentLockedResponse } from "@/lib/incident/lock";
import { ensureIncidentParticipants } from "@/lib/incident/participants";
import { parseJsonBody } from "@/lib/http/parse-body";
import { evictFromIncidentRoom } from "@/lib/socket/evict";
import { liveIncidentWhere } from "@/lib/incident/live";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const schema = z.object({ restricted: z.boolean() });

class LockStateChanged extends Error {}

// PATCH /api/incidents/[id]/restricted — lock or unlock an incident (#6).
//
// LOCK (reporter, IC, or administrator, while unlocked): seeds the participant
// allowlist from the current team — reporter, assignee, every command-role
// holder (the IC included) and the locker — as ordinary, removable
// participants (strict lock rule: reporter/assignee carry no implicit
// access), and captures the seated IC in lockedIcUserId + lockedAt.
//
// UNLOCK (M7): administrators, or the IC who held the seat at lock time and
// still holds it. Clears lockedAt / lockedIcUserId.
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const orgId = session.user.organizationId;

  const incident = await findAccessibleIncident(session.user, id, {
    id: true,
    restricted: true,
    reportedById: true,
    assignedToId: true,
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { restricted } = parsed.data;

  if (incident.restricted) {
    // Locked: unlocking is narrower than managing the lock.
    if (!(await canUnlockIncidentFor(session.user, id))) {
      if (!(await canManageIncidentLock(session.user, id))) return incidentLockedResponse();
      if (restricted === false) {
        return NextResponse.json(
          {
            error: "Only an Org admin, or the incident commander who locked it and still holds the role, can unlock it.",
            code: "unlock_forbidden",
          },
          { status: 403 },
        );
      }
    }
  } else if (!(await canManageIncidentLock(session.user, id))) {
    return NextResponse.json(
      { error: "Only the incident commander, the reporter or an Org admin can lock this incident." },
      { status: 403 },
    );
  }

  if (restricted === incident.restricted) {
    return NextResponse.json({ restricted });
  }

  try {
    await db.$transaction(async (tx) => {
      let lockedIcUserId: string | null = null;
      if (restricted) {
        const ic = await tx.incidentRoleAssignment.findFirst({
          where: { incidentId: id, role: "incident_commander" },
          select: { userId: true },
        });
        lockedIcUserId = ic?.userId ?? null;
      }

      // Conditional on the state we checked against: a concurrent lock/unlock
      // can't double-apply (or double-ledger).
      const res = await tx.incident.updateMany({
        where: liveIncidentWhere({ id, organizationId: orgId, restricted: !restricted }),
        data: restricted
          ? { restricted: true, lockedAt: new Date(), lockedIcUserId }
          : { restricted: false, lockedAt: null, lockedIcUserId: null },
      });
      if (res.count === 0) throw new LockStateChanged();

      if (restricted) {
        // Gather the current team so locking never evicts an active responder.
        const roles = await tx.incidentRoleAssignment.findMany({
          where: { incidentId: id, userId: { not: null } },
          select: { userId: true },
        });
        await ensureIncidentParticipants(
          {
            organizationId: orgId,
            incidentId: id,
            userIds: [
              session.user.id,
              incident.reportedById,
              incident.assignedToId,
              lockedIcUserId,
              ...roles.map((r) => r.userId),
            ],
            addedBy: { id: session.user.id, name: session.user.name ?? null },
          },
          tx,
        );
      }

      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: restricted ? "incident_locked" : "incident_unlocked",
        actorUserId: session.user.id,
        actorLabel: session.user.name ?? null,
        payload: restricted ? { restricted, lockedIcUserId } : { restricted },
      });
    });
  } catch (err) {
    if (err instanceof LockStateChanged) {
      return NextResponse.json({ error: "The lock changed. Reload and try again." }, { status: 409 });
    }
    throw err;
  }

  // Locking narrows visibility: recheck every socket in the war room and evict
  // anyone who is not on the (just-seeded) allowlist, not the IC and not an
  // admin. Fire-and-forget: evictFromIncidentRoom never throws.
  if (restricted) {
    void evictFromIncidentRoom(id, { recheckAll: true });
  }

  return NextResponse.json({ restricted });
}
