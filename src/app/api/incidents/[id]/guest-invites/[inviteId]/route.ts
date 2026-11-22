import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { canManageIncidentLock } from "@/lib/incident/lock";
import { logAudit } from "@/lib/audit/log";

interface RouteContext {
  params: Promise<{ id: string; inviteId: string }>;
}

// DELETE /api/incidents/[id]/guest-invites/[inviteId]: revoke a guest link.
// The link stops working on the guest's next request.
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, inviteId } = await context.params;
  const orgId = session.user.organizationId;

  const incident = await findAccessibleIncident(session.user, id, { id: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageIncidentLock(session.user, id))) {
    return NextResponse.json({ error: "Only the incident commander, the reporter or an administrator can revoke guest links." }, { status: 403 });
  }

  const invite = await db.incidentGuestInvite.findFirst({ where: { id: inviteId, incidentId: id }, select: { id: true, email: true, revokedAt: true } });
  if (!invite) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invite.revokedAt) return NextResponse.json({ ok: true });

  const actorLabel = session.user.name ?? session.user.email ?? null;
  await db.$transaction(async (tx) => {
    const r = await tx.incidentGuestInvite.updateMany({ where: { id: inviteId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: session.user.id } });
    if (r.count === 0) return;
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "guest_revoked",
      actorUserId: session.user.id,
      actorLabel,
      payload: { inviteId, email: invite.email },
    });
  });
  await logAudit({
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    actorName: session.user.name,
    organizationId: orgId,
    action: "incident_guest.revoked",
    targetType: "IncidentGuestInvite",
    targetId: inviteId,
    targetLabel: invite.email,
    metadata: { incidentId: id },
  });
  return NextResponse.json({ ok: true });
}
