import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/auth/admin-guard";
import type { Prisma } from "@prisma/client";
import { LIMITS, stripNul } from "@/lib/http/limits";

// Org-scoped audit reader: admins see their own org's privileged-action
// events. Cursor-paginated by id (BigInt) so it scales past large logs.
export async function GET(req: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const action = stripNul(url.searchParams.get("action") ?? "").trim().slice(0, LIMITS.SHORT_LABEL);
  const cursor = url.searchParams.get("cursor"); // last id seen
  const take = Math.min(Number(url.searchParams.get("take")) || 50, 100);

  const where: Prisma.AdminAuditLogWhereInput = { organizationId: ctx.organizationId };
  if (action) where.action = { contains: action };
  if (cursor) {
    try { where.id = { lt: BigInt(cursor) }; } catch { /* ignore bad cursor */ }
  }

  const rows = await db.adminAuditLog.findMany({
    where,
    orderBy: { id: "desc" },
    take: take + 1,
    select: { id: true, actorUserId: true, actorEmail: true, actorName: true, organizationId: true, action: true, targetType: true, targetId: true, targetLabel: true, metadataJson: true, createdAt: true },
  });

  const hasMore = rows.length > take;
  const page = rows.slice(0, take);

  return NextResponse.json(
    {
      events: page.map((e) => ({
        id: e.id.toString(),
        actorUserId: e.actorUserId,
        actorEmail: e.actorEmail,
        actorName: e.actorName,
        organizationId: e.organizationId,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        targetLabel: e.targetLabel,
        metadata: e.metadataJson,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
