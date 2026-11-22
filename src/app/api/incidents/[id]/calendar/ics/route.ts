import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { buildIncidentIcs } from "@/lib/ics/incident-feed";
import { ICS_CONTENT_TYPE } from "@/lib/ics/ics";
import { fileResponse } from "@/lib/http/file-response";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/calendar/ics — One-shot .ics download of the
// incident timeline (milestones, regulatory deadlines, task due dates, user
// events) for import into Apple/Google/Outlook. Session-authenticated; the
// standing subscription variant lives at /api/public/ics/incident/....
export async function GET(_req: Request, context: RouteContext) {
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

  const ics = await buildIncidentIcs(id);
  if (!ics) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return fileResponse(ics, { filename: `incident-${id}.ics`, contentType: ICS_CONTENT_TYPE, trustedContentType: true });
}
