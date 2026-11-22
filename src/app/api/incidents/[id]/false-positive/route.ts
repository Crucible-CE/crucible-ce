import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { FP_REASON_CODES } from "@/lib/incident/disposition";
import { markIncidentFalsePositive } from "@/lib/incident/false-positive";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { parseJsonBody } from "@/lib/http/parse-body";

const schema = z.object({
  reason: z.enum(FP_REASON_CODES as [string, ...string[]]),
  note: z.string().max(2000).optional(),
});

// POST /api/incidents/[id]/false-positive — classify the incident as a false
// positive and close it (waives started clocks, ledger-recorded, reversible).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  // Enforce org/access scope before acting.
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const result = await markIncidentFalsePositive({
    incidentId: id,
    organizationId: session.user.organizationId,
    userId: session.user.id,
    actorLabel: session.user.name ?? session.user.email ?? null,
    reason: parsed.data.reason,
    note: parsed.data.note,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, status: "closed", disposition: "false_positive", reason: parsed.data.reason });
}
