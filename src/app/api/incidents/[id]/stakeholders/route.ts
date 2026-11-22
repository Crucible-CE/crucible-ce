import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const createSchema = z.object({
  stakeholder: z.string().min(1).max(120),
  userId: z.string().max(LIMITS.ID).optional(),
  channel: z.string().max(60).optional(),
  notes: z.string().max(1000).optional(),
});

// GET /api/incidents/[id]/stakeholders — notification tracker entries.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stakeholders = await db.incidentStakeholderNotification.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ stakeholders }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/incidents/[id]/stakeholders — add a stakeholder to track.
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
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  const created = await db.incidentStakeholderNotification.create({
    data: {
      incidentId: id,
      organizationId: orgId,
      stakeholder: parsed.data.stakeholder,
      userId: parsed.data.userId ?? null,
      channel: parsed.data.channel,
      notes: parsed.data.notes,
      createdById: session.user.id,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
