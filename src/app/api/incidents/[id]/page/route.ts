import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { isClosedStatus } from "@/lib/incident/status";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { deliverPage } from "@/lib/delivery/engine";
import { redactDeliveryError } from "@/lib/delivery/redact";
import { isRedactedTarget, redactedInAppPage } from "@/lib/delivery/redaction";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { checkRateLimit } from "@/lib/security/rate-limit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const schema = z
  .object({
    userId: z.string().min(1).max(LIMITS.ID).optional(),
    contactId: z.string().min(1).max(LIMITS.ID).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((b) => Boolean(b.userId) !== Boolean(b.contactId), {
    message: "Provide exactly one of userId or contactId",
  });

/** Minutes the target has to acknowledge before the page escalates. */
const ACK_WINDOW_MINUTES = 10;
/** Pages one person may send per 10 minutes, in total / to the same target. */
const PAGES_PER_PAGER_10MIN = 30;
const PAGES_PER_PAGER_TARGET_10MIN = 5;

// GET /api/incidents/[id]/page: the incident's pages with per-channel
// delivery status (latest attempt per provider and level), newest first.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pages = await db.incidentPage.findMany({
    where: { incidentId: id, organizationId: session.user.organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      targetLabel: true,
      targetUserId: true,
      targetContactId: true,
      message: true,
      priority: true,
      status: true,
      escalationLevel: true,
      ackDeadlineAt: true,
      acknowledgedAt: true,
      acknowledgedVia: true,
      cancelledAt: true,
      createdAt: true,
      deliveries: {
        orderBy: [{ level: "asc" }, { attempt: "asc" }],
        select: { provider: true, channel: true, level: true, attempt: true, status: true, error: true, nextRetryAt: true, createdAt: true },
      },
    },
  });

  // Collapse to the latest attempt per (level, provider) for display. Raw
  // delivery error text (phone numbers, provider bodies) is for people who
  // can edit the incident; everyone else gets a coarse category.
  const canSeeRawErrors = hasPermission(session.user, "incidents.edit");
  const shaped = pages.map(({ deliveries, ...p }) => {
    const latest = new Map<string, (typeof deliveries)[number]>();
    for (const d of deliveries) latest.set(`${d.level}:${d.provider}`, d);
    return {
      ...p,
      deliveries: [...latest.values()].map((d) => (canSeeRawErrors ? d : { ...d, error: redactDeliveryError(d.error) })),
    };
  });
  return NextResponse.json({ pages: shaped });
}

// POST /api/incidents/[id]/page — page an org member (userId) or an external
// escalation-matrix contact (contactId) to this incident. Creates the page
// record the escalation engine watches, an in-app notification (members), a
// `page_sent` ledger entry, and fans out out-of-band to every configured
// channel (email / SMS / voice / webhook / plugins). The response carries the
// per-channel delivery outcome, plus `warning` when the target could not be
// reached on any addressed channel.
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, title: true, severity: true, status: true, restricted: true, isTraining: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (incident.isTraining) return NextResponse.json({ error: "Training incidents do not page anyone." }, { status: 409 });

  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  if (isClosedStatus(incident.status)) {
    return NextResponse.json({ error: "This incident is closed. Reopen it to page responders." }, { status: 409 });
  }

  // Pages can fan out to SMS / voice: cap them per pager (toll-fraud and
  // harassment guard) — generous enough for a real major incident...
  const rl = await checkRateLimit({ namespace: "page:user", identifier: session.user.id, windowMs: 10 * 60_000, max: PAGES_PER_PAGER_10MIN });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many pages sent. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  // ...and much tighter per (pager, target): nobody needs to page the same
  // person more than a handful of times in 10 minutes (escalation re-pages
  // automatically), and it stops one account from pumping one number.
  const rlTarget = await checkRateLimit({
    namespace: "page:user-target",
    identifier: `${session.user.id}:${parsed.data.userId ? `u:${parsed.data.userId}` : `c:${parsed.data.contactId}`}`,
    windowMs: 10 * 60_000,
    max: PAGES_PER_PAGER_TARGET_10MIN,
  });
  if (!rlTarget.allowed) {
    return NextResponse.json({ error: `You already paged this person several times. Try again in ${rlTarget.retryAfter}s.` }, { status: 429 });
  }

  let target: { userId: string | null; contactId: string | null; label: string | null };
  if (parsed.data.userId) {
    const user = await db.user.findFirst({
      where: { id: parsed.data.userId, organizationId: orgId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!user) return NextResponse.json({ error: "User not found in your organization" }, { status: 400 });
    target = { userId: user.id, contactId: null, label: user.name ?? user.email };
  } else {
    const contact = await db.escalationContact.findFirst({
      where: { id: parsed.data.contactId, organizationId: orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (!contact) return NextResponse.json({ error: "Contact not found in your organization" }, { status: 400 });
    target = { userId: null, contactId: contact.id, label: contact.name };
  }

  const pagerName = session.user.name ?? session.user.email ?? "A responder";
  const note = parsed.data.note?.trim() || null;

  // Persistent page record so the escalation engine can re-page up the call
  // tree if this isn't acknowledged within the window.
  const page = await db.incidentPage.create({
    data: {
      organizationId: orgId,
      incidentId: id,
      targetUserId: target.userId,
      targetContactId: target.contactId,
      targetLabel: target.label,
      message: note,
      priority: incident.severity === "critical" ? "critical" : "high",
      status: "sent",
      ackDeadlineAt: new Date(Date.now() + ACK_WINDOW_MINUTES * 60_000),
      createdById: session.user.id,
    },
    select: { id: true },
  });

  if (target.userId) {
    // Locked incident + a member the lock excludes: never refused, but the
    // in-app page is REDACTED (no title / note / deep link), like every
    // out-of-band channel (lib/delivery/redaction).
    const redacted = await isRedactedTarget({
      organizationId: orgId,
      incidentId: id,
      targetUserId: target.userId,
      targetContactId: null,
      incident: { restricted: incident.restricted },
    }).catch(() => true); // fail closed: redacted, but still paged
    if (redacted) {
      const r = redactedInAppPage(page.id, 0, incident.severity, "page");
      await createNotification(target.userId, "incident_page", r.title, r.body, r.metadata, r.link);
    } else {
      await createNotification(
        target.userId,
        "incident_page",
        `Paged to incident: ${incident.title}`,
        `${pagerName} paged you to a ${incident.severity} incident.${note ? ` Note: ${note}` : ""}`,
        { incidentId: id, pagedById: session.user.id, pageId: page.id },
        `/incidents/${id}`,
      );
    }
  }

  await db.$transaction(async (tx) => {
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "page_sent",
      actorUserId: session.user.id,
      actorLabel: pagerName,
      payload: {
        pageId: page.id,
        targetUserId: target.userId,
        targetContactId: target.contactId,
        targetName: target.label,
        note,
      },
    });
  });

  // Out-of-band fan-out. Awaited so the caller sees the honest per-channel
  // result; every provider is bounded by a hard timeout. A delivery failure
  // never fails the page itself: the in-app page and escalation still stand,
  // and failed channels retry on the cron.
  const delivery = await deliverPage(page.id, { kind: "page", pagerName }).catch((err) => {
    console.error(`[page] out-of-band delivery failed for page ${page.id}:`, err);
    return { outcomes: [] as Awaited<ReturnType<typeof deliverPage>>["outcomes"], warning: undefined };
  });

  return NextResponse.json({
    ok: true,
    pageId: page.id,
    deliveries: delivery.outcomes.map((o) => ({ provider: o.provider, channel: o.channel, status: o.status, error: o.error ?? null })),
    // Set when no email/SMS/voice channel could reach the target at all (the
    // IC + admins also get an in-app alert). The UI shows it to the pager.
    warning: delivery.warning ?? null,
  });
}
