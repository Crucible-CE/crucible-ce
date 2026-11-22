import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

const patchSchema = z.object({
  status: z.enum(["active", "blocked", "false_positive"]).optional(),
  sharedExternally: z.boolean().optional(),
});

async function ownsIndicator(id: string, indicatorId: string, organizationId: string, user: Parameters<typeof accessibleIncidentsWhere>[0]) {
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(user) }, select: { id: true } });
  if (!incident) return false;
  const ind = await db.incidentIndicator.findFirst({ where: { id: indicatorId, incidentId: id, organizationId, deletedAt: null }, select: { id: true } });
  return !!ind;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; indicatorId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, indicatorId } = await params;
  if (!(await ownsIndicator(id, indicatorId, session.user.organizationId, session.user))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const indicator = await db.incidentIndicator.update({ where: { id: indicatorId }, data: parsed.data });
  return NextResponse.json({ indicator });
}

// DELETE — soft-delete: sets deletedAt so the undo toast can restore.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; indicatorId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, indicatorId } = await params;
  const orgId = session.user.organizationId;
  if (!(await ownsIndicator(id, indicatorId, orgId, session.user))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const ind = await db.incidentIndicator.findFirst({ where: { id: indicatorId }, select: { indicatorType: true, value: true } });
  await db.$transaction(async (tx) => {
    await tx.incidentIndicator.update({ where: { id: indicatorId }, data: { deletedAt: new Date() } });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "indicator_deleted", actorUserId: session.user.id, actorLabel: session.user.name ?? session.user.email ?? null, payload: { indicatorId, type: ind?.indicatorType, value: ind?.value } });
  });
  return NextResponse.json({ ok: true, undoToken: indicatorId });
}
