import { NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { LIMITS, stripNul } from "@/lib/http/limits";

// Sign-in / security activity reader (UserActivityLog), scoped to the admin's
// organization. Cursor-paginated by id (BigInt), mirroring admin/audit/org.
//
// Privacy: ipHash is NEVER returned, only ipLastOctet for triage.

const SELECT = {
  id: true,
  userId: true,
  organizationId: true,
  action: true,
  emailHash: true,
  path: true,
  statusCode: true,
  ipLastOctet: true,
  userAgent: true,
  metadataJson: true,
  createdAt: true,
} as const;

export async function GET(req: Request) {
  const ctx = await getAdminContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const action = stripNul(url.searchParams.get("action") ?? "").trim().slice(0, LIMITS.SHORT_LABEL);
  const cursor = url.searchParams.get("cursor");
  const take = Math.min(Number(url.searchParams.get("take")) || 50, 100);

  const where: Prisma.UserActivityLogWhereInput = { organizationId: ctx.organizationId };
  if (action) where.action = { contains: action };
  if (cursor) {
    try { where.id = { lt: BigInt(cursor) }; } catch { /* ignore bad cursor */ }
  }

  const rows = await db.userActivityLog.findMany({
    where,
    orderBy: { id: "desc" },
    take: take + 1,
    select: SELECT,
  });

  const hasMore = rows.length > take;
  const page = rows.slice(0, take);

  return NextResponse.json(
    {
      events: page.map((e) => ({
        id: e.id.toString(),
        userId: e.userId,
        organizationId: e.organizationId,
        action: e.action,
        emailHash: e.emailHash,
        path: e.path,
        statusCode: e.statusCode,
        ipLastOctet: e.ipLastOctet,
        userAgent: e.userAgent,
        metadata: e.metadataJson,
        createdAt: e.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id.toString() : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
