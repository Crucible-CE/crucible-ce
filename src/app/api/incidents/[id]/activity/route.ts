import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { boundedJson } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

const bodySchema = z.object({
  action: z.string().min(1).max(100),
  notes: z.string().min(1).max(2000),
  metadata: boundedJson(z.record(z.string(), z.unknown())).optional(),
});

// GET /api/incidents/[id]/activity
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.organizationId)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const activity = await db.incidentActivity.findMany({
    where: { incidentId: id },
    orderBy: { timestamp: "asc" },
  });

  return NextResponse.json(activity);
}

// POST /api/incidents/[id]/activity
export async function POST(
  req: Request,
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
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  const entry = await db.incidentActivity.create({
    data: {
      incidentId: id,
      userId: session.user.id,
      userName: user?.name ?? null,
      action: parsed.data.action,
      notes: parsed.data.notes,
      metadata: (parsed.data.metadata as Record<string, string>) ?? {},
    },
  });

  return NextResponse.json(entry, { status: 201 });
}
