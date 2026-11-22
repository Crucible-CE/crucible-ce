import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { mintIcsToken, revokeIcsTokens } from "@/lib/ics/token";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/calendar/subscribe — Returns the standing
// subscription URL (webcal + https forms) for this incident's calendar feed.
// The URL embeds a stored, revocable per-user token (src/lib/ics/token.ts);
// copying a new link revokes the caller's previous one for this incident.
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

  const orgId = session.user.organizationId;
  const token = await mintIcsToken({ organizationId: orgId, incidentId: id, userId: session.user.id });
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || new URL(req.url).origin;
  const httpsUrl = `${base}/api/public/ics/incident/${id}/${token}`;
  const webcalUrl = httpsUrl.replace(/^https?:/, "webcal:");

  return NextResponse.json({ httpsUrl, webcalUrl }, { headers: { "Cache-Control": "no-store" } });
}

// DELETE /api/incidents/[id]/calendar/subscribe — revoke the caller's feed
// link for this incident.
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  // Access check first (uniform 404 for locked / deleted / foreign incidents).
  // Losing access already kills the feed (verifyIcsToken re-checks access).
  const incident = await findAccessibleIncident(session.user, id, { id: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const revoked = await revokeIcsTokens({ userId: session.user.id, incidentId: id });
  return NextResponse.json({ ok: true, revoked });
}
