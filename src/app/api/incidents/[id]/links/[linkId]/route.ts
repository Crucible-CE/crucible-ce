import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { assertIncidentWritable } from "@/lib/incident/lock";

// DELETE — remove an incident link (from either side).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, linkId } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const link = await db.incidentLink.findFirst({ where: { id: linkId, organizationId: session.user.organizationId, OR: [{ incidentId: id }, { relatedIncidentId: id }] }, select: { id: true } });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.incidentLink.delete({ where: { id: linkId } });
  return NextResponse.json({ ok: true });
}
