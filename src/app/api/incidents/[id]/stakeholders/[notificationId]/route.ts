import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; notificationId: string }>;
}

const patchSchema = z.object({
  status: z.enum(["pending", "notified", "acknowledged", "not_required"]).optional(),
  notes: z.string().max(1000).optional(),
});

// PATCH /api/incidents/[id]/stakeholders/[notificationId] — update status/notes.
// Marking a stakeholder "notified" stamps the time and records a
// notification_sent entry on the tamper-evident ledger.
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, notificationId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const existing = await db.incidentStakeholderNotification.findFirst({
    where: { id: notificationId, incidentId: id, organizationId: orgId },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const becomingNotified =
    parsed.data.status === "notified" && existing.status !== "notified";

  const updated = await db.incidentStakeholderNotification.update({
    where: { id: notificationId },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(becomingNotified ? { notifiedAt: new Date() } : {}),
    },
  });

  if (becomingNotified) {
    await db.$transaction(async (tx) => {
      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: "notification_sent",
        actorUserId: session.user.id,
        actorLabel: session.user.name ?? null,
        payload: { stakeholder: existing.stakeholder, channel: existing.channel ?? null },
      });
    });
  }

  return NextResponse.json(updated);
}
