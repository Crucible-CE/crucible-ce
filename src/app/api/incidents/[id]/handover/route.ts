import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const createSchema = z.object({
  summary: z.string().min(1).max(4000),
  openItems: z.string().max(4000).optional(),
  toUserId: z.string().max(LIMITS.ID).optional(),
  toLabel: z.string().max(120).optional(),
});

// GET /api/incidents/[id]/handover — shift handover log (newest first).
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

  const handovers = await db.incidentHandover.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ handovers }, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/incidents/[id]/handover — record a shift/responder handover.
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

  // Resolve the on-coming responder (must be an active org member).
  let toUserName: string | null = null;
  if (parsed.data.toUserId) {
    const target = await db.user.findFirst({
      where: { id: parsed.data.toUserId, organizationId: orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (!target) return NextResponse.json({ error: "Incoming responder not found" }, { status: 400 });
    toUserName = target.name ?? null;
  }

  const created = await db.incidentHandover.create({
    data: {
      incidentId: id,
      organizationId: orgId,
      fromUserId: session.user.id,
      fromUserName: session.user.name ?? null,
      toUserId: parsed.data.toUserId ?? null,
      toLabel: parsed.data.toLabel ?? toUserName,
      summary: parsed.data.summary,
      openItems: parsed.data.openItems,
      status: "pending",
    },
  });

  // Auto-page the incoming responder to accept the handover.
  if (parsed.data.toUserId && parsed.data.toUserId !== session.user.id) {
    await createNotification(
      parsed.data.toUserId,
      "incident_page",
      "Handover waiting for you",
      `${session.user.name ?? "A responder"} handed an incident over to you. Review and accept it.`,
      { incidentId: id, handoverId: created.id },
      // The handover panel lives on the SITREP tab (StatusPanels).
      `/incidents/${id}/sitrep`,
    );
  }

  return NextResponse.json(created, { status: 201 });
}
