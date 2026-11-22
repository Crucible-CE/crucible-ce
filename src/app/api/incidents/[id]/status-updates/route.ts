import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { postUpdateToStatusPage } from "@/lib/incident/status-page";

// GET — customer/public status updates (external comms cadence).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updates = await db.incidentStatusUpdate.findMany({ where: { incidentId: id }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ updates }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  audience: z.enum(["customer", "public", "internal"]).default("customer"),
  headline: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  /** Also put it on the incident status page (and email its subscribers). */
  postToStatusPage: z.boolean().optional(),
});

// POST — publish a status update (legal-defensible external comms record).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const update = await db.$transaction(async (tx) => {
    const u = await tx.incidentStatusUpdate.create({
      data: { organizationId: orgId, incidentId: id, audience: parsed.data.audience, headline: parsed.data.headline, body: parsed.data.body, publishedById: session.user.id, publishedByName: session.user.name ?? session.user.email ?? null },
    });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "status_update_published", actorUserId: session.user.id, actorLabel: session.user.name ?? null, payload: { audience: parsed.data.audience, headline: parsed.data.headline } });
    return u;
  });
  let statusPage: { posted: boolean; error?: string } | undefined;
  if (parsed.data.postToStatusPage && parsed.data.audience !== "internal") {
    const r = await postUpdateToStatusPage({ incidentId: id, organizationId: orgId, updateId: update.id, actor: { id: session.user.id, label: session.user.name ?? session.user.email ?? null } });
    statusPage = r.ok ? { posted: true } : { posted: false, error: r.error };
  }
  return NextResponse.json({ update, ...(statusPage ? { statusPage } : {}) });
}
