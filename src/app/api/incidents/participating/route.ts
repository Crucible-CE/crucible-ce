import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { ACTIVE_STATUS_FILTER } from "@/lib/incident/status";
import { accessibleIncidentsWhere } from "@/lib/incident/access";

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
const severityRank = (s: string) => SEVERITY_RANK[s] ?? -1;

// GET /api/incidents/participating — the single most urgent ACTIVE incident the
// viewer is personally involved in (participant, reporter, assignee, or holding
// an incident role). Powers the top-bar "active incident" pill, so it answers
// "which war room should I be in right now?" — not the org-wide list.
// The involvement OR is only a relevance filter: visibility always comes from
// accessibleIncidentsWhere, so a reporter/assignee removed from a LOCKED
// incident's allowlist does not see it here (strict lock rule), and
// soft-deleted incidents never appear.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ incident: null });
  }

  const candidates = await db.incident.findMany({
    where: {
      organizationId: session.user.organizationId,
      status: ACTIVE_STATUS_FILTER,
      // Neither a command role (other than IC) nor being reporter/assignee
      // opens a locked incident (strict lock rule).
      AND: [accessibleIncidentsWhere(session.user, { excludeTraining: true })],
      OR: [
        { reportedById: session.user.id },
        { assignedToId: session.user.id },
        { participants: { some: { userId: session.user.id } } },
        { roleAssignments: { some: { userId: session.user.id } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, severity: true, status: true },
  });

  // Most severe first; ties break to the most recent (the findMany order).
  const incident =
    candidates.length === 0
      ? null
      : candidates.reduce((best, c) => (severityRank(c.severity) > severityRank(best.severity) ? c : best));

  return NextResponse.json({ incident }, { headers: { "Cache-Control": "no-store" } });
}
