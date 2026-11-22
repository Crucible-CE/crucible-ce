import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission } from "@/lib/auth/rbac";
import { clearLoginThrottleForEmail } from "@/lib/security/login-throttle";

// POST /api/admin/users/[id]/unlock
// Clears the user's sign-in throttle: the per-email delay and every
// per-email+IP delay (src/lib/security/login-throttle.ts). Use when someone
// hammering an account has slowed its owner's sign-in. The per-IP cap is not
// touched (it protects the whole install). The user's own sessions and
// password are unchanged.

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, organizationId: true },
  });
  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const cleared = await clearLoginThrottleForEmail(target.email);
  if (cleared === null) {
    return NextResponse.json(
      { error: "Redis isn't reachable, so there's nothing to unlock." },
      { status: 503 },
    );
  }

  await recordAdminAuditLog({
    actorUserId: session.user.id,
    actorEmail: session.user.email ?? null,
    actorName: session.user.name ?? null,
    organizationId: session.user.organizationId,
    action: "user.signin_unlocked",
    targetType: "user",
    targetId: id,
    targetLabel: target.email,
    metadata: { keysCleared: cleared },
  });

  return NextResponse.json({ success: true, email: target.email });
}
