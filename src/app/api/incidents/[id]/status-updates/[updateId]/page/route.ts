import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { postUpdateToStatusPage } from "@/lib/incident/status-page";
import { appendLedger } from "@/lib/ledger/append";

interface RouteContext {
  params: Promise<{ id: string; updateId: string }>;
}

async function gate(id: string) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  if (!hasPermission(session.user, "incidents.edit")) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  const incident = await findAccessibleIncident(session.user, id, { id: true, restricted: true });
  if (!incident) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) } as const;
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return { error: locked } as const;
  return { session, orgId: session.user.organizationId } as const;
}

// POST: put a published update on the incident's status page and email its
// confirmed subscribers. Exactly once per update.
export async function POST(_req: Request, context: RouteContext) {
  const { id, updateId } = await context.params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  const r = await postUpdateToStatusPage({
    incidentId: id,
    organizationId: g.orgId,
    updateId,
    actor: { id: g.session.user.id, label: g.session.user.name ?? g.session.user.email ?? null },
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, notified: r.notifyQueued });
}

// DELETE: take an update off the status page (it stays in the incident record).
export async function DELETE(_req: Request, context: RouteContext) {
  const { id, updateId } = await context.params;
  const g = await gate(id);
  if ("error" in g) return g.error;
  const update = await db.incidentStatusUpdate.findFirst({
    where: { id: updateId, incidentId: id, organizationId: g.orgId, publishedToPageAt: { not: null } },
    select: { id: true, headline: true },
  });
  if (!update) return NextResponse.json({ error: "Not on the status page." }, { status: 404 });
  await db.$transaction(async (tx) => {
    const { count } = await tx.incidentStatusUpdate.updateMany({ where: { id: updateId, publishedToPageAt: { not: null } }, data: { publishedToPageAt: null, publishedToPageById: null } });
    if (count === 0) return;
    await appendLedger(tx, {
      incidentId: id,
      organizationId: g.orgId,
      eventType: "status_page_update_removed",
      actorUserId: g.session.user.id,
      actorLabel: g.session.user.name ?? null,
      payload: { updateId, headline: update.headline },
    });
  });
  return NextResponse.json({ ok: true });
}
