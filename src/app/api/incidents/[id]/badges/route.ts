import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { computeIncidentBadges, NEW_SECTIONS, type NewSection } from "@/lib/incident/badges";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/badges?chat=<iso>&comms=<iso>&… — per-section activity
// badge counts for the war-room left nav. Last-seen timestamps come from the
// client (per browser); action counts (pages/tasks) are computed server-side.
export async function GET(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, { id: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const since: Partial<Record<NewSection, string>> = {};
  for (const s of NEW_SECTIONS) {
    const v = url.searchParams.get(s);
    if (v) since[s] = v;
  }

  const badges = await computeIncidentBadges(session.user.id, id, since);
  return NextResponse.json({ badges }, { headers: { "Cache-Control": "no-store" } });
}
