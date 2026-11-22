import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { getOrgPolicyMatrix } from "@/lib/notifications/preferences";
import { CATEGORY_BY_CODE, CHANNELS } from "@/lib/notifications/catalog";
import { parseJsonBody } from "@/lib/http/parse-body";
import { logAudit } from "@/lib/audit/log";
import { LIMITS } from "@/lib/http/limits";

// Org-admin notification policy: hard-lock category x channel cells (force_on /
// force_off) and the critical-breaks-DND floor. Gated by admin.access and
// scoped to the caller's organization.

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const data = await getOrgPolicyMatrix(session.user.organizationId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.object({
  policies: z
    .array(z.object({ categoryCode: z.string().max(LIMITS.TAG), channel: z.enum(CHANNELS), lock: z.enum(["user_choice", "force_on", "force_off"]) }))
    .max(LIMITS.ARRAY)
    .optional(),
  criticalBreaksDnd: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "admin.access")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgId = session.user.organizationId;
  const userId = session.user.id;

  const parsed = await parseJsonBody(req, putSchema);
  if (!parsed.ok) return parsed.response;

  for (const p of parsed.data.policies ?? []) {
    const cat = CATEGORY_BY_CODE[p.categoryCode];
    if (!cat || !cat.availableChannels.includes(p.channel)) continue;
    if (p.lock === "user_choice") {
      // Clearing a lock = delete the row (absence means user_choice).
      await db.orgNotificationPolicy.deleteMany({ where: { organizationId: orgId, categoryCode: p.categoryCode, channel: p.channel } });
    } else {
      await db.orgNotificationPolicy.upsert({
        where: { organizationId_categoryCode_channel: { organizationId: orgId, categoryCode: p.categoryCode, channel: p.channel } },
        create: { organizationId: orgId, categoryCode: p.categoryCode, channel: p.channel, lock: p.lock, updatedById: userId },
        update: { lock: p.lock, updatedById: userId },
      });
    }
  }

  if (parsed.data.criticalBreaksDnd !== undefined) {
    await db.orgNotificationDefault.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, criticalBreaksDnd: parsed.data.criticalBreaksDnd, updatedById: userId },
      update: { criticalBreaksDnd: parsed.data.criticalBreaksDnd, updatedById: userId },
    });
  }

  await logAudit({
    actorUserId: userId,
    actorEmail: session.user.email ?? null,
    actorName: session.user.name ?? null,
    organizationId: orgId,
    action: "notification_policy.updated",
    targetType: "OrgNotificationPolicy",
    targetId: orgId,
    metadata: {
      policies: (parsed.data.policies ?? []).map((p) => ({ categoryCode: p.categoryCode, channel: p.channel, lock: p.lock })),
      ...(parsed.data.criticalBreaksDnd !== undefined ? { criticalBreaksDnd: parsed.data.criticalBreaksDnd } : {}),
    },
  });

  const data = await getOrgPolicyMatrix(orgId);
  return NextResponse.json(data);
}
