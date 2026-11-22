import { NextResponse } from "next/server";
import { z } from "zod";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/sitrep — SITREP history (newest first).
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

  const sitreps = await db.incidentSitrep.findMany({
    where: { incidentId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return NextResponse.json({ sitreps }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  content: z.string().trim().min(1, "SITREP content is required").max(20_000),
});

// POST /api/incidents/[id]/sitrep — publish a manually written SITREP.
// (AI-synthesized SITREPs are a Crucible Cloud feature.)
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, organizationId: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  const sitrep = await db.$transaction(async (tx) => {
    const row = await tx.incidentSitrep.create({
      data: {
        incidentId: id,
        organizationId: incident.organizationId,
        content: parsed.data.content,
        generatedById: session.user.id,
        generatedByName: session.user.name ?? null,
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: incident.organizationId,
      eventType: "sitrep_published",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: { sitrepId: row.id, length: parsed.data.content.length },
    });
    return row;
  });

  return NextResponse.json({ sitrep }, { status: 201 });
}
