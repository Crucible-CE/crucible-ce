import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const schema = z.object({ allowUnverified: z.boolean() });

// POST /api/admin/users/[id]/notification-phone { allowUnverified }
// Administrator-only toll-fraud override for a MEMBER's notification phone:
// lets the delivery engine and notify() text / call the number without the
// member having confirmed it by SMS code (e.g. SMS isn't configured, or the
// number was confirmed out of band). Same rule as allowUnverifiedPhone on an
// escalation contact. Cleared automatically when the member changes the number.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "admin.access") || !session.user.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true, organizationId: true } });
  if (!target || target.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const setting = await db.userNotificationSetting.findUnique({
    where: { userId: id },
    select: { notificationPhone: true, notificationPhoneVerifiedAt: true },
  });
  if (parsed.data.allowUnverified && !setting?.notificationPhone) {
    return NextResponse.json({ error: "This member has no notification phone saved." }, { status: 400 });
  }

  await db.userNotificationSetting.upsert({
    where: { userId: id },
    create: { userId: id, allowUnverifiedPhone: parsed.data.allowUnverified },
    update: { allowUnverifiedPhone: parsed.data.allowUnverified },
  });

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: session.user.organizationId,
      action: parsed.data.allowUnverified ? "user.phone_unverified_allowed" : "user.phone_unverified_revoked",
      targetType: "user",
      targetId: id,
      targetLabel: target.email,
      metadata: { phone: setting?.notificationPhone ?? null },
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record phone override", err);
  }

  return NextResponse.json({
    ok: true,
    allowUnverified: parsed.data.allowUnverified,
    phoneVerified: !!setting?.notificationPhoneVerifiedAt,
  });
}
