import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";

const ACTIVE_WINDOW_MS = 90_000; // considered "in the room" if seen in the last 90s

// GET — who is actively in the war room. POST — heartbeat my presence.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const present = await db.incidentPresence.findMany({ where: { incidentId: id, lastSeenAt: { gte: since } }, orderBy: { lastSeenAt: "desc" }, select: { userId: true, userName: true, lastSeenAt: true } });
  return NextResponse.json({ present }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.incidentPresence.upsert({
    where: { incidentId_userId: { incidentId: id, userId: session.user.id } },
    create: { organizationId: session.user.organizationId, incidentId: id, userId: session.user.id, userName: session.user.name ?? session.user.email ?? null, lastSeenAt: new Date() },
    update: { lastSeenAt: new Date(), userName: session.user.name ?? session.user.email ?? null },
  });
  return NextResponse.json({ ok: true });
}
