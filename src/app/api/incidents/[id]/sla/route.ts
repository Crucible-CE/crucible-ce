import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { getOrgSlaMatrix, computeSlaStatuses, slaMilestoneTimestamps } from "@/lib/incident/sla";

// GET /api/incidents/[id]/sla — live response-SLA status for the command hub.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { severity: true, createdAt: true, declaredAt: true, containedAt: true, resolvedAt: true, closedAt: true, isTraining: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Training incidents run no SLA clocks.
  if (incident.isTraining) return NextResponse.json({ statuses: [] }, { headers: { "Cache-Control": "no-store" } });

  // Resolve milestone completion timestamps.
  const [icRole, firstUpdate] = await Promise.all([
    db.incidentRoleAssignment.findFirst({ where: { incidentId: id, role: "incident_commander", userId: { not: null } }, orderBy: { assignedAt: "asc" }, select: { assignedAt: true } }),
    // Later-unpublished updates still count: the SLA measures when the first
    // external update WENT OUT; a retraction doesn't undo that it did.
    db.incidentStatusUpdate.findFirst({ where: { incidentId: id }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const matrix = await getOrgSlaMatrix(session.user.organizationId);
  const statuses = computeSlaStatuses(
    incident.severity,
    incident.createdAt,
    incident.declaredAt,
    slaMilestoneTimestamps(incident, icRole?.assignedAt ?? null, firstUpdate?.createdAt ?? null),
    matrix,
  );
  return NextResponse.json({ statuses }, { headers: { "Cache-Control": "no-store" } });
}
