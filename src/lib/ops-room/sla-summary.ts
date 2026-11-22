// Batched SLA headline loader for the Ops Room (three queries for any number
// of incidents), computed with the SAME rules as the incident's SLA panel
// (lib/incident/sla: computeSlaStatuses + slaMilestoneTimestamps). The pure
// headline logic is in ./sla-headline.

import { db } from "@/lib/db";
import { computeSlaStatuses, getOrgSlaMatrix, slaMilestoneTimestamps } from "@/lib/incident/sla";
import { summarizeSla, type SlaHeadline } from "./sla-headline";

export interface SlaIncidentInput {
  id: string;
  severity: string;
  createdAt: Date;
  declaredAt: Date | null;
  containedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
}

/** SLA headline per incident id (batched; the caller has already applied access rules). */
export async function loadSlaHeadlines(
  organizationId: string,
  incidents: SlaIncidentInput[],
  now: Date = new Date(),
): Promise<Map<string, SlaHeadline>> {
  const out = new Map<string, SlaHeadline>();
  if (incidents.length === 0) return out;
  const ids = incidents.map((i) => i.id);
  const [matrix, icRoles, updates] = await Promise.all([
    getOrgSlaMatrix(organizationId),
    db.incidentRoleAssignment.findMany({
      where: { incidentId: { in: ids }, role: "incident_commander", userId: { not: null } },
      select: { incidentId: true, assignedAt: true },
    }),
    // Later-unpublished updates still count (same rule as the SLA route).
    db.incidentStatusUpdate.groupBy({
      by: ["incidentId"],
      where: { incidentId: { in: ids } },
      _min: { createdAt: true },
    }),
  ]);
  const icBy = new Map<string, Date>();
  for (const r of icRoles) {
    const cur = icBy.get(r.incidentId);
    if (!cur || r.assignedAt < cur) icBy.set(r.incidentId, r.assignedAt);
  }
  const firstUpdateBy = new Map(updates.map((u) => [u.incidentId, u._min.createdAt ?? null]));
  for (const inc of incidents) {
    const statuses = computeSlaStatuses(
      inc.severity,
      inc.createdAt,
      inc.declaredAt,
      slaMilestoneTimestamps(inc, icBy.get(inc.id) ?? null, firstUpdateBy.get(inc.id) ?? null),
      matrix,
      now,
    );
    out.set(inc.id, summarizeSla(statuses));
  }
  return out;
}
