import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { canManageIncidentLock, canUnlockIncidentFor, incidentLockedResponse } from "@/lib/incident/lock";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/participants — the allowlist (org members).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const participants = await db.incidentParticipant.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      userName: true,
      userEmail: true,
      role: true,
      addedByName: true,
      createdAt: true,
    },
  });
  const canManage = await canManageIncidentLock(session.user, id);
  // M7: unlocking is narrower than managing — admins, or the IC captured at
  // lock time while still seated. The UI shows the Unlock control off this.
  const canUnlock = incident.restricted ? await canUnlockIncidentFor(session.user, id) : false;
  return NextResponse.json(
    { participants, restricted: incident.restricted, canManage, canUnlock },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const postSchema = z.object({
  userId: z.string().min(1).max(LIMITS.ID),
  role: z.enum(["responder", "observer"]).optional(),
});

// POST /api/incidents/[id]/participants — add an internal org member to the allowlist.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const orgId = session.user.organizationId;

  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canManageIncidentLock(session.user, id))) {
    if (incident.restricted) return incidentLockedResponse();
    return NextResponse.json({ error: "Only the incident commander, the reporter or an Org admin can manage participants." }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const member = await db.user.findFirst({
    where: { id: parsed.data.userId, organizationId: orgId, isActive: true },
    select: { id: true, name: true, email: true },
  });
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  const created = await db.$transaction(async (tx) => {
    const p = await tx.incidentParticipant.upsert({
      where: { incidentId_userId: { incidentId: id, userId: member.id } },
      create: {
        organizationId: orgId,
        incidentId: id,
        userId: member.id,
        userName: member.name ?? member.email ?? "Unknown",
        userEmail: member.email ?? null,
        role: parsed.data.role ?? "responder",
        addedById: session.user.id,
        addedByName: session.user.name ?? null,
      },
      update: { role: parsed.data.role ?? "responder" },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "participant_added",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: { userId: member.id, userName: p.userName },
    });
    return p;
  });

  await createNotification(
    member.id,
    "incident_participant_added",
    "Added to a locked incident",
    `You were added to a locked incident by ${session.user.name ?? "a colleague"}.`,
    { incidentId: id },
    `/incidents/${id}`
  ).catch(() => {});

  return NextResponse.json(created, { status: 201 });
}
