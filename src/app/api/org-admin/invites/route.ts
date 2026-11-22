import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { hasPermission, type RBACUser } from "@/lib/auth/rbac";
import {
  ORG_INVITE_ALLOWED_ROLES,
  createOrgInviteToken,
} from "@/lib/org-invite/tokens";
import { parseJsonBody } from "@/lib/http/parse-body";
import { activeEmailTransport } from "@/lib/email/transport";

// ---------------------------------------------------------------------------
// Org-admin invite management — org admins (admin.access), scoped to their OWN
// organization. Mirrors the platform /api/admin/org-invites flow (single-use,
// trackable, link-based signup) but the destination org is always the caller's
// own org — never chosen — and only org roles are grantable.
//   GET  /api/org-admin/invites   — list this org's recent invites
//   POST /api/org-admin/invites   — mint a new invite link for this org
// ---------------------------------------------------------------------------

function getBaseUrl(req: Request): string {
  return (
    process.env.PUBLIC_URL ??
    process.env.NEXTAUTH_URL ??
    new URL(req.url).origin
  );
}

const createSchema = z.object({
  role: z.enum(ORG_INVITE_ALLOWED_ROLES).optional(),
  inviteeName: z.string().trim().min(1).max(120).optional(),
  inviteeEmail: z.string().trim().email().max(320).optional(),
  expiryDays: z.number().int().min(1).max(30).optional(),
  skipEmailVerification: z.boolean().optional(),
});

function statusOf(
  i: { revokedAt: Date | null; usedAt: Date | null; expiresAt: Date },
  now: number,
): "active" | "used" | "expired" | "revoked" {
  if (i.revokedAt) return "revoked";
  if (i.usedAt) return "used";
  if (i.expiresAt.getTime() < now) return "expired";
  return "active";
}

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user as RBACUser | undefined;
  if (!hasPermission(user, "admin.access") || !session?.user?.organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

  const invites = await db.orgInvite.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      role: true,
      inviteeName: true,
      inviteeEmail: true,
      skipEmailVerification: true,
      expiresAt: true,
      usedAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
      usedBy: { select: { name: true, email: true } },
    },
  });

  const now = Date.now();
  return NextResponse.json(
    {
      // Without email the invitee never receives a verification link, so the
      // panel warns and defaults "Skip email verification" on.
      emailConfigured: activeEmailTransport() !== null,
      invites: invites.map((i) => ({
        id: i.id,
        role: i.role,
        inviteeName: i.inviteeName,
        inviteeEmail: i.inviteeEmail,
        skipEmailVerification: i.skipEmailVerification,
        createdBy: i.createdBy,
        usedBy: i.usedBy,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
        usedAt: i.usedAt?.toISOString() ?? null,
        revokedAt: i.revokedAt?.toISOString() ?? null,
        status: statusOf(i, now),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as RBACUser | undefined;
  if (
    !hasPermission(user, "admin.access") ||
    !session?.user?.organizationId ||
    !session.user.id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  // Destination org is ALWAYS the caller's own org — never client-supplied.
  const org = await db.organization.findUnique({
    where: { id: session.user.organizationId },
    select: { id: true, slug: true, name: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const { token, idHash, expiresAt } = createOrgInviteToken({
    orgId: org.id,
    orgSlug: org.slug,
    role: parsed.data.role,
    expiryDays: parsed.data.expiryDays,
  });

  const invite = await db.orgInvite.create({
    data: {
      tokenHash: idHash,
      organizationId: org.id,
      role: parsed.data.role ?? "contributor",
      createdById: session.user.id,
      inviteeName: parsed.data.inviteeName ?? null,
      inviteeEmail: parsed.data.inviteeEmail?.toLowerCase() ?? null,
      skipEmailVerification: parsed.data.skipEmailVerification ?? false,
      expiresAt,
    },
  });

  const inviteUrl = `${getBaseUrl(req)}/register?orgInvite=${token}`;

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: org.id,
      action: "org_invite.create",
      targetType: "org_invite",
      targetId: invite.id,
      targetLabel: parsed.data.inviteeEmail ?? org.slug,
      metadata: {
        organizationId: org.id,
        organizationSlug: org.slug,
        role: invite.role,
        inviteeName: parsed.data.inviteeName,
        skipEmailVerification: invite.skipEmailVerification,
        expiresAt: expiresAt.toISOString(),
        scope: "org_admin",
      },
    });
  } catch (err) {
    console.error("[admin-audit] Failed to record org_invite.create", err);
  }

  return NextResponse.json({
    id: invite.id,
    organizationName: org.name,
    organizationSlug: org.slug,
    role: invite.role,
    skipEmailVerification: invite.skipEmailVerification,
    inviteUrl,
    expiresAt: expiresAt.toISOString(),
  });
}
