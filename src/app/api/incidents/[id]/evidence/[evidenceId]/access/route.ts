import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";

interface RouteContext {
  params: Promise<{ id: string; evidenceId: string }>;
}

// GET /api/incidents/[id]/evidence/[evidenceId]/access — the custody access log.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, evidenceId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ev = await db.incidentEvidence.findFirst({
    where: { id: evidenceId, incidentId: id, organizationId: session.user.organizationId },
    select: { id: true },
  });
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accesses = await db.incidentEvidenceAccess.findMany({
    where: { evidenceId: ev.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, userName: true, action: true, createdAt: true },
  });
  return NextResponse.json({ accesses }, { headers: { "Cache-Control": "no-store" } });
}
