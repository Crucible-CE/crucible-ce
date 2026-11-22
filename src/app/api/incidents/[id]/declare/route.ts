import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";

// POST /api/incidents/[id]/declare — formally declares the incident
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  if (incident.declaredAt) {
    return NextResponse.json(
      { error: "Incident already declared." },
      { status: 409 },
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  const now = new Date();
  const orgId = session.user.organizationId;
  const userId = session.user.id;

  const updated = await db.$transaction(async (tx) => {
    const u = await tx.incident.update({
      where: { id },
      data: { declaredAt: now, status: "investigating" },
    });
    await tx.incidentActivity.create({
      data: {
        incidentId: id,
        userId,
        userName: user?.name ?? null,
        action: "declared",
        notes: "Incident declared.",
        metadata: { declaredAt: now.toISOString() },
      },
    });
    // Record the declaration on the tamper-evident ledger (genesis entry).
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "declared",
      actorUserId: userId,
      actorLabel: user?.name ?? null,
      payload: { declaredAt: now.toISOString(), status: "investigating" },
    });
    return u;
  });

  return NextResponse.json(updated);
}
