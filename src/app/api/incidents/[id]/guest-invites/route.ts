import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { canManageIncidentLock } from "@/lib/incident/lock";
import { GUEST_DEFAULT_DAYS, GUEST_MAX_DAYS, generatePublicToken, hashPublicToken } from "@/lib/incident/guest";
import { sendGuestInviteEmail } from "@/lib/incident/guest-email";
import { parseJsonBody } from "@/lib/http/parse-body";
import { logAudit } from "@/lib/audit/log";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { checkRateLimit } from "@/lib/security/rate-limit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/incidents/[id]/guest-invites: the incident's guest links (never the tokens).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true, lockedAt: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [invites, canManage] = await Promise.all([
    db.incidentGuestInvite.findMany({
      where: { incidentId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, name: true, company: true, canUpload: true, invitedByName: true, expiresAt: true, revokedAt: true, lastAccessAt: true, createdAt: true },
    }),
    canManageIncidentLock(session.user, id),
  ]);
  const now = Date.now();
  const suspendedBefore = incident.restricted ? (incident.lockedAt?.getTime() ?? Infinity) : null;
  return NextResponse.json(
    {
      canManage,
      invites: invites.map((i) => ({
        ...i,
        state: i.revokedAt
          ? "revoked"
          : i.expiresAt.getTime() <= now
            ? "expired"
            : suspendedBefore !== null && i.createdAt.getTime() < suspendedBefore
              ? "suspended"
              : "active",
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const postSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(120).optional(),
  expiresInDays: z.number().int().min(1).max(GUEST_MAX_DAYS).optional(),
  canUpload: z.boolean().optional(),
  sendEmail: z.boolean().optional(),
});

// POST /api/incidents/[id]/guest-invites: make a guest link. The link is
// returned once (only its hash is stored) and, by default, emailed to the guest.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const orgId = session.user.organizationId;

  const incident = await findAccessibleIncident(session.user, id, { id: true, title: true, isTraining: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (incident.isTraining) return NextResponse.json({ error: "Training incidents do not invite guests." }, { status: 409 });
  if (!(await canManageIncidentLock(session.user, id))) {
    return NextResponse.json({ error: "Only the incident commander, the reporter or an administrator can invite guests." }, { status: 403 });
  }
  const rl = await checkRateLimit({ namespace: "guest:invite", identifier: session.user.id, windowMs: 60 * 60_000, max: 30 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many invites. Try again later." }, { status: 429 });

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const token = generatePublicToken();
  const expiresAt = new Date(Date.now() + (data.expiresInDays ?? GUEST_DEFAULT_DAYS) * 24 * 60 * 60_000);
  const actorLabel = session.user.name ?? session.user.email ?? null;

  const invite = await db.$transaction(async (tx) => {
    const inv = await tx.incidentGuestInvite.create({
      data: {
        organizationId: orgId,
        incidentId: id,
        email: data.email.toLowerCase(),
        name: data.name || null,
        company: data.company || null,
        canUpload: data.canUpload ?? true,
        tokenHash: hashPublicToken(token),
        invitedById: session.user.id,
        invitedByName: actorLabel,
        expiresAt,
      },
      select: { id: true, email: true, name: true, company: true, canUpload: true, expiresAt: true, createdAt: true },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "guest_invited",
      actorUserId: session.user.id,
      actorLabel,
      payload: { inviteId: inv.id, email: inv.email, company: inv.company, expiresAt: inv.expiresAt.toISOString(), canUpload: inv.canUpload },
    });
    return inv;
  });

  await logAudit({
    actorUserId: session.user.id,
    actorEmail: session.user.email,
    actorName: session.user.name,
    organizationId: orgId,
    action: "incident_guest.invited",
    targetType: "IncidentGuestInvite",
    targetId: invite.id,
    targetLabel: invite.email,
    metadata: { incidentId: id, expiresAt: invite.expiresAt.toISOString() },
  });

  const inviteUrl = `${getPublicBaseUrl().replace(/\/+$/, "")}/incident-guest/${token}`;
  let emailed = false;
  if (data.sendEmail ?? true) {
    emailed = await sendGuestInviteEmail({ to: invite.email, name: invite.name, inviterName: actorLabel, url: inviteUrl, expiresAt: invite.expiresAt });
  }
  return NextResponse.json({ invite, inviteUrl, emailed }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
