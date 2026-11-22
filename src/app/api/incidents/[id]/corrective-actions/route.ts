import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

// GET — corrective actions / lessons-learned tracked to closure.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const actions = await db.incidentCorrectiveAction.findMany({ where: { incidentId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ actions }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  ownerId: z.string().max(LIMITS.ID).nullable().optional(),
  ownerName: z.string().max(200).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const action = await db.$transaction(async (tx) => {
    const a = await tx.incidentCorrectiveAction.create({
      data: { organizationId: orgId, incidentId: id, title: parsed.data.title, description: parsed.data.description ?? null, ownerId: parsed.data.ownerId ?? null, ownerName: parsed.data.ownerName ?? null, dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null, createdById: session.user.id },
    });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "corrective_action_created", actorUserId: session.user.id, actorLabel: session.user.name ?? null, payload: { title: parsed.data.title } });
    return a;
  });
  return NextResponse.json({ action });
}
