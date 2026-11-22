import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { summarizeBroadcast } from "@/lib/broadcast/summary";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/broadcasts/[id]: one broadcast with every recipient's delivery
// attempts and acknowledgement. Administrators and contributors only.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const b = await db.broadcast.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: {
      id: true,
      title: true,
      message: true,
      channels: true,
      audience: true,
      createdByName: true,
      createdAt: true,
      recipients: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          userId: true,
          contactId: true,
          acknowledgedAt: true,
          acknowledgedVia: true,
          deliveries: { orderBy: { createdAt: "asc" }, select: { channel: true, provider: true, status: true, error: true, destination: true, updatedAt: true } },
        },
      },
    },
  });
  if (!b) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ broadcast: { ...b, ...summarizeBroadcast(b.recipients) } }, { headers: { "Cache-Control": "no-store" } });
}
