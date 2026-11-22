import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

// GET /api/incidents/[id]/decisions
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const decisions = await db.incidentDecision.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ decisions }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  context: z.string().max(5000).optional(),
  dueAt: z.string().datetime().optional(),
});

// POST /api/incidents/[id]/decisions — open a decision.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await params;
  const orgId = session.user.organizationId;
  const userId = session.user.id;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const created = await db.$transaction(async (tx) => {
    const d = await tx.incidentDecision.create({
      data: {
        organizationId: orgId,
        incidentId: id,
        title: parsed.data.title,
        context: parsed.data.context ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "decision_made",
      actorUserId: userId,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { decisionId: d.id, title: d.title, kind: "opened" },
    });
    return d;
  });

  return NextResponse.json(created, { status: 201 });
}
