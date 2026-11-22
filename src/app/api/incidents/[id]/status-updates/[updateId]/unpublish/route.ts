import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";

// POST — unpublish (retract) a status update. Soft + additive: the row stays
// (greyed/badged in the UI, still in the list) and the original
// status_update_published ledger event is retained — the statement WAS
// public, and the record must never imply otherwise. Guarded updateMany so
// a double-tap is a clean 409.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, updateId } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;
  const existing = await db.incidentStatusUpdate.findFirst({ where: { id: updateId, incidentId: id, organizationId: orgId }, select: { id: true, headline: true, audience: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const unpublished = await db.$transaction(async (tx) => {
    const { count } = await tx.incidentStatusUpdate.updateMany({
      where: { id: updateId, incidentId: id, organizationId: orgId, unpublishedAt: null },
      data: { unpublishedAt: new Date() },
    });
    if (count === 0) return false;
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "status_update_unpublished",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { updateId, audience: existing.audience, headline: existing.headline },
    });
    return true;
  });
  if (!unpublished) return NextResponse.json({ error: "Already unpublished" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
