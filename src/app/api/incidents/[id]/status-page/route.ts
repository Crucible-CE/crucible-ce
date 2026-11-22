import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { parseJsonBody } from "@/lib/http/parse-body";
import { findAccessibleIncident } from "@/lib/incident/access";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { generatePublicToken, hashPublicToken } from "@/lib/incident/guest";
import { STATUS_AUDIENCE_SCOPES } from "@/lib/incident/status-page";
import { appendLedger } from "@/lib/ledger/append";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { logAudit } from "@/lib/audit/log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const publicUrl = (token: string) => `${getPublicBaseUrl().replace(/\/+$/, "")}/status/${token}`;

// GET /api/incidents/[id]/status-page: the incident's status page settings and
// confirmed subscriber count. The public link is never returned here.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const page = await db.incidentStatusPage.findUnique({ where: { incidentId: id } });
  const subscriberCount = page
    ? await db.statusPageSubscriber.count({ where: { statusPageId: page.id, confirmedAt: { not: null }, unsubscribedAt: null } })
    : 0;
  return NextResponse.json(
    {
      restricted: incident.restricted,
      page: page
        ? { id: page.id, isPublished: page.isPublished, live: page.isPublished && !incident.restricted, title: page.title, audienceScope: page.audienceScope, createdAt: page.createdAt, subscriberCount }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

const postSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  isPublished: z.boolean().optional(),
  audienceScope: z.enum(STATUS_AUDIENCE_SCOPES).optional(),
  /** Replace the public link. The old link stops working. */
  rotateLink: z.boolean().optional(),
});

// POST /api/incidents/[id]/status-page: create the page, or change its title,
// audience, published state or link. A new link is returned once.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = session.user.organizationId;
  const { id } = await context.params;

  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true, isTraining: true });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (incident.restricted) return NextResponse.json({ error: "A locked incident cannot have a public status page." }, { status: 403 });
  if (incident.isTraining) return NextResponse.json({ error: "Training incidents do not have a status page." }, { status: 409 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const actorLabel = session.user.name ?? session.user.email ?? null;
  const existing = await db.incidentStatusPage.findUnique({ where: { incidentId: id } });

  if (!existing) {
    if (!data.title) return NextResponse.json({ error: "A public title is required." }, { status: 400 });
    const token = generatePublicToken();
    const page = await db.$transaction(async (tx) => {
      const created = await tx.incidentStatusPage.create({
        data: {
          organizationId: orgId,
          incidentId: id,
          tokenHash: hashPublicToken(token),
          title: data.title!,
          isPublished: data.isPublished ?? false,
          audienceScope: data.audienceScope ?? "public",
          createdById: session.user.id,
        },
      });
      if (created.isPublished) {
        await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "status_page_published", actorUserId: session.user.id, actorLabel, payload: { statusPageId: created.id, title: created.title } });
      }
      return created;
    });
    await logAudit({ actorUserId: session.user.id, actorEmail: session.user.email, actorName: session.user.name, organizationId: orgId, action: "status_page.created", targetType: "IncidentStatusPage", targetId: page.id, targetLabel: page.title, metadata: { incidentId: id } });
    return NextResponse.json(
      { page: { id: page.id, isPublished: page.isPublished, title: page.title, audienceScope: page.audienceScope }, publicUrl: publicUrl(token) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  }

  const flip = data.isPublished !== undefined && data.isPublished !== existing.isPublished;
  const token = data.rotateLink ? generatePublicToken() : null;
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.incidentStatusPage.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.isPublished !== undefined ? { isPublished: data.isPublished } : {}),
        ...(data.audienceScope !== undefined ? { audienceScope: data.audienceScope } : {}),
        ...(token ? { tokenHash: hashPublicToken(token) } : {}),
      },
    });
    if (flip) {
      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: data.isPublished ? "status_page_published" : "status_page_unpublished",
        actorUserId: session.user.id,
        actorLabel,
        payload: { statusPageId: existing.id, title: u.title },
      });
    }
    return u;
  });
  if (flip || token) {
    await logAudit({
      actorUserId: session.user.id,
      actorEmail: session.user.email,
      actorName: session.user.name,
      organizationId: orgId,
      action: token ? "status_page.link_rotated" : data.isPublished ? "status_page.published" : "status_page.unpublished",
      targetType: "IncidentStatusPage",
      targetId: existing.id,
      targetLabel: updated.title,
      metadata: { incidentId: id },
    });
  }
  return NextResponse.json(
    {
      page: { id: updated.id, isPublished: updated.isPublished, title: updated.title, audienceScope: updated.audienceScope },
      ...(token ? { publicUrl: publicUrl(token) } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
