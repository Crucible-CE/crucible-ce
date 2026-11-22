// Ops Room "Active incidents": a compact list of the open incidents the member
// may see (lock rules via accessibleIncidentsWhere; "open" = every status but
// closed, lib/incident/status), most severe first, with the member's own role
// and the SLA headline.

import { db } from "@/lib/db";
import { accessibleIncidentsWhere, type AccessUser } from "@/lib/incident/access";
import { ACTIVE_STATUS_FILTER } from "@/lib/incident/status";
import { loadSlaHeadlines } from "./sla-summary";
import type { SlaHeadline } from "./sla-headline";
import { myRoles, sortActive } from "./rules";

export const ACTIVE_LIST_LIMIT = 8;

export interface ActiveIncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  restricted: boolean;
  createdAt: string;
  roles: string[];
  sla: SlaHeadline;
}

export interface ActiveIncidents {
  rows: ActiveIncidentRow[];
  total: number;
  critical: number;
}

export async function loadActiveIncidents(user: AccessUser & { organizationId: string }, now: Date = new Date()): Promise<ActiveIncidents> {
  const [total, critical, candidates] = await Promise.all([
    db.incident.count({ where: { AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { status: ACTIVE_STATUS_FILTER }] } }),
    db.incident.count({ where: { AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { status: ACTIVE_STATUS_FILTER }, { severity: "critical" }] } }),
    // Bounded candidate set; the most severe are picked from it.
    db.incident.findMany({
      where: { AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { status: ACTIVE_STATUS_FILTER }] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        restricted: true,
        createdAt: true,
        declaredAt: true,
        containedAt: true,
        resolvedAt: true,
        closedAt: true,
        assignedToId: true,
        roleAssignments: { where: { userId: user.id }, select: { role: true } },
      },
    }),
  ]);
  const top = sortActive(candidates).slice(0, ACTIVE_LIST_LIMIT);
  const slas = await loadSlaHeadlines(user.organizationId, top, now);
  return {
    total,
    critical,
    rows: top.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      restricted: i.restricted,
      createdAt: i.createdAt.toISOString(),
      roles: myRoles(i.roleAssignments, i.assignedToId === user.id),
      sla: slas.get(i.id) ?? { state: "none", label: null, deadline: null, remainingMinutes: null },
    })),
  };
}
