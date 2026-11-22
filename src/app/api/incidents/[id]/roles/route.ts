import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { notify } from "@/lib/notifications/dispatch";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable, canAssignIncidentCommander } from "@/lib/incident/lock";
import { evictFromIncidentRoom } from "@/lib/socket/evict";

const ROLES = [
  "incident_commander",
  "comms_lead",
  "legal_lead",
  "tech_lead",
  "exec_sponsor",
  "scribe",
] as const;

const ROLE_LABELS: Record<string, string> = {
  incident_commander: "Incident Commander",
  comms_lead: "Communications Lead",
  legal_lead: "Legal Lead",
  tech_lead: "Technical Lead",
  exec_sponsor: "Executive Sponsor",
  scribe: "Scribe",
};

// GET /api/incidents/[id]/roles — current command structure.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, reportedById: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const roles = await db.incidentRoleAssignment.findMany({ where: { incidentId: id } });
  // M7: tell the UI whether this viewer may fill / change the IC seat, so it
  // only offers the control when the PUT would succeed.
  const icRow = roles.find((r) => r.role === "incident_commander");
  const canAssignIc = canAssignIncidentCommander(session.user, incident, {
    occupied: !!(icRow?.userId || icRow?.escalationContactId),
    currentIcUserId: icRow?.userId ?? null,
  });
  return NextResponse.json({ roles, canAssignIc }, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.object({
  role: z.enum(ROLES),
  userId: z.string().max(LIMITS.ID).nullable().optional(),
  escalationContactId: z.string().max(LIMITS.ID).nullable().optional(),
});

// PUT /api/incidents/[id]/roles — assign (upsert) a command role.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await params;
  const orgId = session.user.organizationId;
  const userId = session.user.id;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, title: true, reportedById: true, restricted: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const { role, userId: assigneeUserId, escalationContactId } = parsed.data;

  // Both assignee kinds must belong to this org (and be active).
  if (assigneeUserId) {
    const u = await db.user.findFirst({ where: { id: assigneeUserId, organizationId: orgId, isActive: true }, select: { id: true } });
    if (!u) return NextResponse.json({ error: "Assignee not found in your organization" }, { status: 400 });
  }
  if (escalationContactId) {
    const c = await db.escalationContact.findFirst({ where: { id: escalationContactId, organizationId: orgId, isActive: true }, select: { id: true } });
    if (!c) return NextResponse.json({ error: "Escalation contact not found in your organization" }, { status: 400 });
  }

  // IC takeover guard (M7 + #13): the incident commander seat carries lock
  // exemption, so an EMPTY seat may be filled only by the reporter or an
  // administrator, and an OCCUPIED seat changes hands only via the current
  // IC, the reporter, or an administrator. The seat is read and decided
  // INSIDE the transaction under a row lock on the incident, so two
  // concurrent takeovers serialize and neither decides on a stale seat.
  // Written inside the transaction callback (an object so TS does not narrow
  // the fields to their initial values).
  const ic: { previousUserId: string | null; denied: boolean } = { previousUserId: null, denied: false };

  const assignment = await db.$transaction(async (tx) => {
    if (role === "incident_commander") {
      await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.incidentRoleAssignment.findFirst({
        where: { incidentId: id, role: "incident_commander" },
        select: { userId: true, escalationContactId: true },
      });
      const occupied = !!(current?.userId || current?.escalationContactId);
      ic.previousUserId = current?.userId ?? null;
      if (!canAssignIncidentCommander(session.user, incident, { occupied, currentIcUserId: current?.userId ?? null })) {
        ic.denied = true;
        return null;
      }
    }
    const a = await tx.incidentRoleAssignment.upsert({
      where: { incidentId_role: { incidentId: id, role } },
      create: {
        organizationId: orgId,
        incidentId: id,
        role,
        userId: assigneeUserId ?? null,
        escalationContactId: escalationContactId ?? null,
      },
      update: {
        userId: assigneeUserId ?? null,
        escalationContactId: escalationContactId ?? null,
        assignedAt: new Date(),
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "role_assigned",
      actorUserId: userId,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { role, userId: assigneeUserId ?? null, escalationContactId: escalationContactId ?? null },
    });
    return a;
  });
  if (ic.denied || !assignment) {
    return NextResponse.json(
      {
        error:
          "Only the reporter or an administrator can fill an empty incident commander seat; only the current incident commander, the reporter, or an administrator can change it.",
      },
      { status: 403 },
    );
  }

  // A displaced IC on a locked incident may have lost access: recheck their sockets.
  if (incident.restricted && ic.previousUserId && ic.previousUserId !== assigneeUserId) {
    void evictFromIncidentRoom(id, { userIds: [ic.previousUserId] });
  }

  // Tell the newly-assigned person (never the actor assigning themselves).
  if (assigneeUserId && assigneeUserId !== userId) {
    await notify({
      event: "role_assigned",
      organizationId: orgId,
      incidentId: id,
      actorUserId: userId,
      recipientIds: [assigneeUserId],
      title: "You've been assigned a command role",
      body: `You are now ${ROLE_LABELS[role] ?? role} for "${incident.title}".`,
      link: `/incidents/${id}`,
      metadata: { role, incidentId: id },
    }).catch(() => {});
  }

  return NextResponse.json(assignment);
}
