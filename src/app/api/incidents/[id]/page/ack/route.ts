import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { z } from "zod";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { acknowledgePage } from "@/lib/escalation/engine";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/incidents/[id]/page/ack — acknowledge pages. Never lock-blocked:
// acking must always work.
//   no body            -> the caller acks every open page targeting THEM.
//   { pageId }         -> ack one page: allowed for the paged person, or for a
//                         contributor+ acking on someone's behalf (e.g. an
//                         external contact who phoned in). Readers can only
//                         ever ack their own pages.
// Each ack is a guarded sent -> acked transition (stops escalation and pending
// delivery retries) with a page_acked ledger entry. 404 when nothing to ack.
const bodySchema = z.object({ pageId: z.string().min(1).max(64).optional() });

export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let pageId: string | undefined;
  // No body (the in-app "Acknowledge" button) = ack my own pages. Any body
  // that IS sent goes through the shared parser (JSON Content-Type, size cap,
  // NUL guard) with a small cap: it only ever carries a page id.
  const hasBody = req.body !== null && req.headers.get("content-length") !== "0";
  if (hasBody) {
    const parsed = await parseJsonBody(req, bodySchema, { maxBytes: 4096 });
    if (!parsed.ok) return parsed.response;
    pageId = parsed.data.pageId;
  }

  let open: { id: string; escalationLevel: number }[];
  if (pageId) {
    const page = await db.incidentPage.findFirst({
      where: { id: pageId, incidentId: id, organizationId: orgId, status: "sent" },
      select: { id: true, escalationLevel: true, targetUserId: true },
    });
    if (!page) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (page.targetUserId !== session.user.id && !hasPermission(session.user, "incidents.edit")) {
      return NextResponse.json({ error: "Only the paged person or a contributor can acknowledge this page" }, { status: 403 });
    }
    open = [page];
  } else {
    open = await db.incidentPage.findMany({
      where: { incidentId: id, organizationId: orgId, targetUserId: session.user.id, status: "sent" },
      select: { id: true, escalationLevel: true },
    });
  }

  let acked = 0;
  for (const p of open) {
    const won = await acknowledgePage(p.id, {
      userId: session.user.id,
      via: "app",
      level: p.escalationLevel,
      actorLabel: session.user.name ?? null,
    });
    if (won) acked += 1;
  }

  if (acked === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, acked });
}
