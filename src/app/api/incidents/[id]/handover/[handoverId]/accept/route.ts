import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; handoverId: string }>;
}

// POST /api/incidents/[id]/handover/[handoverId]/accept — the incoming responder
// signs off on the handover. Two-party record: from (who handed off) + accepted
// by (who picked it up), with a ledger entry for the audit trail.
export async function POST(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, handoverId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const handover = await db.incidentHandover.findFirst({
    where: { id: handoverId, incidentId: id, organizationId: orgId },
  });
  if (!handover) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (handover.status === "accepted") {
    return NextResponse.json({ error: "Already accepted" }, { status: 409 });
  }
  // Two-party integrity: when a specific incoming responder was named, only they
  // may sign off, and never the person who handed off.
  if (handover.toUserId && handover.toUserId !== session.user.id) {
    return NextResponse.json({ error: "This handover is addressed to another responder" }, { status: 403 });
  }
  if (handover.toUserId && handover.fromUserId === session.user.id) {
    return NextResponse.json({ error: "You can't accept your own handover." }, { status: 403 });
  }

  // The state change and its ledger record commit or roll back together — a
  // handover can't become "accepted" without the tamper-evident entry. The
  // accept is conditional on the row still being un-accepted (#13: the
  // pre-check above is advisory only), so two concurrent accepts can't both
  // win and double-ledger.
  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.incidentHandover.updateMany({
      where: { id: handoverId, incidentId: id, organizationId: orgId, status: { not: "accepted" } },
      data: {
        status: "accepted",
        acceptedById: session.user.id,
        acceptedByName: session.user.name ?? null,
        acceptedAt: new Date(),
      },
    });
    if (claimed.count === 0) return null;
    const u = await tx.incidentHandover.findUniqueOrThrow({ where: { id: handoverId } });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "handover_accepted",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: {
        handoverId,
        fromUserName: handover.fromUserName ?? null,
        fromUserId: handover.fromUserId ?? null,
      },
    });
    return u;
  });
  if (!updated) {
    return NextResponse.json({ error: "Already accepted" }, { status: 409 });
  }

  return NextResponse.json(updated);
}
