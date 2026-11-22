import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";

// POST — restore a soft-deleted asset (the undo toast). Guarded updateMany
// (atomic-claim convention): only a currently-tombstoned row restores, so a
// double-tap or racing restore is a clean 404 no-op.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, assetId } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const restored = await db.$transaction(async (tx) => {
    const { count } = await tx.incidentAsset.updateMany({
      where: { id: assetId, incidentId: id, organizationId: orgId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    if (count === 0) return false;
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "asset_restored", actorUserId: session.user.id, actorLabel: session.user.name ?? session.user.email ?? null, payload: { assetId } });
    return true;
  });
  if (!restored) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
