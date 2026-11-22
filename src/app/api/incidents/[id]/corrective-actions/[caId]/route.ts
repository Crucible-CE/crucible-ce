import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

const patchSchema = z.object({ status: z.enum(["open", "in_progress", "done", "cancelled"]) });

async function owns(id: string, caId: string, orgId: string, user: Parameters<typeof accessibleIncidentsWhere>[0]) {
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(user) }, select: { id: true } });
  if (!incident) return false;
  const ca = await db.incidentCorrectiveAction.findFirst({ where: { id: caId, incidentId: id, organizationId: orgId }, select: { id: true } });
  return !!ca;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; caId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, caId } = await params;
  if (!(await owns(id, caId, session.user.organizationId, session.user))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const action = await db.incidentCorrectiveAction.update({ where: { id: caId }, data: { status: parsed.data.status } });
  return NextResponse.json({ action });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; caId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, caId } = await params;
  if (!(await owns(id, caId, session.user.organizationId, session.user))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  await db.incidentCorrectiveAction.delete({ where: { id: caId } });
  return NextResponse.json({ ok: true });
}
