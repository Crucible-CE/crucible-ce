import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";

// GET /api/incidents/[id]/ledger — the tamper-evident defensible record.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Org-scope: confirm the incident belongs to the caller's org before reading.
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const entries = await db.incidentLedgerEntry.findMany({
    where: { incidentId: id },
    orderBy: { seq: "asc" },
    select: {
      seq: true,
      eventType: true,
      actorUserId: true,
      actorLabel: true,
      payloadJson: true,
      prevHash: true,
      entryHash: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}
