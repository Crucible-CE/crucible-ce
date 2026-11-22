import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { assertIncidentWritable } from "@/lib/incident/lock";
import { parseJsonBody } from "@/lib/http/parse-body";

const patchSchema = z.object({
  headline: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
});

// PATCH — edit a published status update's headline/body. The edit is
// ledgered (status_update_edited, with the prior text in the payload) so the
// original wording stays reconstructable; unpublished updates can't be edited.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; updateId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, updateId } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;
  const existing = await db.incidentStatusUpdate.findFirst({ where: { id: updateId, incidentId: id, organizationId: orgId }, select: { id: true, headline: true, body: true, audience: true, unpublishedAt: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.unpublishedAt) return NextResponse.json({ error: "This update is unpublished. Publish a new one instead." }, { status: 409 });

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  if (!parsed.data.headline && !parsed.data.body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update = await db.$transaction(async (tx) => {
    const u = await tx.incidentStatusUpdate.update({
      where: { id: updateId },
      data: { ...parsed.data, editedAt: new Date() },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "status_update_edited",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: {
        updateId,
        audience: existing.audience,
        previousHeadline: existing.headline,
        previousBody: existing.body,
        headline: parsed.data.headline ?? existing.headline,
      },
    });
    return u;
  });
  return NextResponse.json({ update });
}
