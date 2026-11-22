import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

const CONTAINED_STATUSES = ["contained", "eradicated", "clean"];
const patchSchema = z.object({
  status: z.enum(["affected", "investigating", "contained", "eradicated", "clean"]).optional(),
  criticality: z.enum(["critical", "high", "medium", "low"]).optional(),
  name: z.string().min(1).max(200).optional(),
  identifier: z.string().max(300).nullable().optional(),
  dataClassification: z.enum(["pii", "phi", "pci", "financial", "ip", "confidential", "none"]).nullable().optional(),
  owner: z.string().max(120).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, assetId } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const asset = await db.incidentAsset.findFirst({ where: { id: assetId, incidentId: id, organizationId: session.user.organizationId, deletedAt: null }, select: { id: true, containedAt: true } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  // Stamp containedAt the first time an asset reaches a contained tier; clear if
  // it regresses to affected/investigating.
  let containedAt: Date | null | undefined;
  if (parsed.data.status) {
    if (CONTAINED_STATUSES.includes(parsed.data.status)) containedAt = asset.containedAt ?? new Date();
    else containedAt = null;
  }

  const updated = await db.incidentAsset.update({
    where: { id: assetId },
    data: { ...parsed.data, ...(containedAt !== undefined ? { containedAt } : {}) },
  });
  return NextResponse.json({ asset: updated });
}

// DELETE — soft-delete: sets deletedAt so the undo toast can restore.
// Read paths filter deletedAt: null; the row is a tombstone, not gone.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, assetId } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;
  const asset = await db.incidentAsset.findFirst({ where: { id: assetId, incidentId: id, organizationId: orgId, deletedAt: null }, select: { id: true, name: true } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.incidentAsset.update({ where: { id: assetId }, data: { deletedAt: new Date() } });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "asset_deleted", actorUserId: session.user.id, actorLabel: session.user.name ?? session.user.email ?? null, payload: { assetId, name: asset.name } });
  });
  return NextResponse.json({ ok: true, undoToken: assetId });
}
