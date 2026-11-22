// ---------------------------------------------------------------------------
// GET /api/org-members — List active members of the caller's organization
// Returns minimal fields (id, name, email) for use in approver pickers etc.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const members = await db.user.findMany({
    where: {
      organizationId: session.user.organizationId,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  return NextResponse.json(members);
}
