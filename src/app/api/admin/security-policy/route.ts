import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAdminContext } from "@/lib/auth/admin-guard";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { canEnablePolicy } from "@/lib/auth/mfa/policy";
import { userHasMfa } from "@/lib/auth/mfa/service";
import { countMembersWithoutMfa, signOutMembersWithoutMfa } from "@/lib/auth/mfa/org-status";
import { recordActivity } from "@/lib/security/activity-log";
import { requireAdminReauth } from "@/lib/auth/mfa/http";

// GET/PUT /api/admin/security-policy — the org's sign-in policy:
//   requireMfa  every member must use two-factor sign-in. Members without a
//               factor are funnelled to enrollment until they add one.
// Turning it on requires the admin doing so to have two-factor themselves
// (no self lock-out), and immediately signs out every active member without
// two-factor (they sign in again and are asked to set it up). Audited, with
// the number of members signed out.

export async function GET() {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const org = await db.organization.findUnique({ where: { id: admin.organizationId }, select: { requireMfa: true } });
  return NextResponse.json({
    requireMfa: org?.requireMfa ?? false,
    membersWithoutMfa: await countMembersWithoutMfa(admin.organizationId),
  });
}

const schema = z.object({ requireMfa: z.boolean() });

export async function PUT(req: Request) {
  const admin = await getAdminContext();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Changing the org's sign-in policy needs the admin's own step-up grant.
  const stepUp = await requireAdminReauth(req, admin.userId);
  if (stepUp) return stepUp;
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { requireMfa } = parsed.data;

  if (requireMfa) {
    const check = canEnablePolicy({ actorHasMfa: await userHasMfa(admin.userId) });
    if (!check.ok) return NextResponse.json({ error: check.error, code: "actor_needs_mfa" }, { status: 409 });
  }
  const before = await db.organization.findUnique({ where: { id: admin.organizationId }, select: { requireMfa: true } });
  await db.organization.update({ where: { id: admin.organizationId }, data: { requireMfa } });
  const turnedOn = requireMfa && before?.requireMfa !== true;
  const signedOut = turnedOn ? await signOutMembersWithoutMfa(admin.organizationId, admin.userId) : [];
  for (const id of signedOut) {
    void recordActivity({
      action: "session.revoked",
      userId: id,
      organizationId: admin.organizationId,
      metadata: { reason: "require_mfa_enabled", actorUserId: admin.userId },
    });
  }
  const membersWithoutMfa = await countMembersWithoutMfa(admin.organizationId);

  if (before?.requireMfa !== requireMfa) {
    await recordAdminAuditLog({
      actorUserId: admin.userId,
      actorEmail: admin.email,
      actorName: admin.name,
      organizationId: admin.organizationId,
      action: requireMfa ? "org.require_mfa_enabled" : "org.require_mfa_disabled",
      targetType: "organization",
      targetId: admin.organizationId,
      metadata: { requireMfa, membersWithoutMfa, ...(requireMfa ? { membersSignedOut: signedOut.length } : {}) },
    });
  }
  return NextResponse.json({ requireMfa, membersWithoutMfa, membersSignedOut: signedOut.length });
}
