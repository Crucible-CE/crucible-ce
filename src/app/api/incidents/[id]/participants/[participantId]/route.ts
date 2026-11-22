import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { canManageIncidentLock, incidentLockedResponse } from "@/lib/incident/lock";
import { evictFromIncidentRoom } from "@/lib/socket/evict";
import { revokeIcsTokens } from "@/lib/ics/token";

interface RouteContext {
  params: Promise<{ id: string; participantId: string }>;
}

// DELETE /api/incidents/[id]/participants/[participantId] — remove someone from
// the allowlist. Strict founder lock rule: the reporter and assignee are
// ordinary participants with no implicit access, so they CAN be removed (and
// then lose a locked incident). The IC and administrators keep access anyway.
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, participantId } = await context.params;
  const orgId = session.user.organizationId;

  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageIncidentLock(session.user, id))) {
    if (incident.restricted) return incidentLockedResponse();
    return NextResponse.json({ error: "Only the incident commander, the reporter or an Org admin can manage participants." }, { status: 403 });
  }

  const participant = await db.incidentParticipant.findFirst({
    where: { id: participantId, incidentId: id },
    select: { id: true, userId: true, userName: true },
  });
  if (!participant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    await tx.incidentParticipant.delete({ where: { id: participantId } });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "participant_removed",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: { userId: participant.userId, userName: participant.userName },
    });
  });

  // If that removal cost them access (locked incident, and they are not the
  // IC or an admin), pull their live sockets out of the war room.
  // Fire-and-forget: evictFromIncidentRoom never throws.
  if (participant.userId) {
    void evictFromIncidentRoom(id, { userIds: [participant.userId] });
    // Their calendar-feed link for this incident is revoked outright.
    await revokeIcsTokens({ userId: participant.userId, incidentId: id });
  }

  return NextResponse.json({ ok: true });
}
