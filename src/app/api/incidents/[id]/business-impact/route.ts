import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import type { Prisma } from "@prisma/client";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const schema = z.object({
  affectedServices: z.array(z.string().max(120)).max(50).optional(),
  impactDimensions: z.array(z.string().max(40)).max(12).optional(),
  operationalStatus: z.string().max(40).optional(),
  customerImpactLevel: z.string().max(40).optional(),
  financialImpactLevel: z.string().max(40).optional(),
  customerImpact: z.string().max(2000).optional(),
  revenueImpact: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

// GET /api/incidents/[id]/business-impact — the business-impact assessment
// (read by the Scope page's "Business impact" stat; written by SITREP).
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
    select: { businessImpactJson: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const value = incident.businessImpactJson;
  const obj = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return NextResponse.json(obj, { headers: { "Cache-Control": "no-store" } });
}

// PATCH /api/incidents/[id]/business-impact — set the business-impact assessment.
export async function PATCH(req: Request, context: RouteContext) {
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
    select: { id: true, businessImpactJson: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  // Shallow-merge so a partial save never wipes fields the caller didn't send.
  const existing =
    incident.businessImpactJson && typeof incident.businessImpactJson === "object" && !Array.isArray(incident.businessImpactJson)
      ? (incident.businessImpactJson as Record<string, unknown>)
      : {};
  const merged = { ...existing, ...parsed.data };

  const updated = await db.incident.update({
    where: { id },
    data: { businessImpactJson: merged as unknown as Prisma.InputJsonValue },
    select: { businessImpactJson: true },
  });
  return NextResponse.json(updated.businessImpactJson ?? {});
}
