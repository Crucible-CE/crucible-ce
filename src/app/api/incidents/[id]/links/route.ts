import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

const RELATIONS = ["related", "duplicate", "parent", "child"] as const;

// GET — incidents linked to this one (either direction), with the other side's summary.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await db.incidentLink.findMany({ where: { organizationId: orgId, OR: [{ incidentId: id }, { relatedIncidentId: id }] }, orderBy: { createdAt: "desc" } });
  const otherIds = links.map((l) => (l.incidentId === id ? l.relatedIncidentId : l.incidentId));
  // Only the linked incidents the caller may see get a summary (a locked one
  // they're not on shows as "(no access)").
  const others = await db.incident.findMany({ where: { id: { in: otherIds }, ...accessibleIncidentsWhere(session.user, { excludeTraining: true }) }, select: { id: true, title: true, severity: true, status: true } });
  const byId = new Map(others.map((o) => [o.id, o]));

  const result = links.map((l) => {
    const outward = l.incidentId === id;
    const otherId = outward ? l.relatedIncidentId : l.incidentId;
    // Show the relation from THIS incident's perspective (parent<->child flip).
    let relation = l.relationType;
    if (!outward && l.relationType === "parent") relation = "child";
    else if (!outward && l.relationType === "child") relation = "parent";
    return { linkId: l.id, relation, incident: byId.get(otherId) ?? { id: otherId, title: "(no access)", severity: "", status: "" } };
  });
  return NextResponse.json({ links: result }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({ relatedIncidentId: z.string().min(1).max(LIMITS.ID), relationType: z.enum(RELATIONS) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  if (parsed.data.relatedIncidentId === id) return NextResponse.json({ error: "Can't link an incident to itself." }, { status: 400 });

  // The other incident must be in the same org.
  // ...and visible to the caller (no linking to, or learning about, a locked incident they're not on).
  const other = await db.incident.findFirst({ where: { id: parsed.data.relatedIncidentId, organizationId: orgId, ...accessibleIncidentsWhere(session.user, { excludeTraining: true }) }, select: { id: true, title: true } });
  if (!other) return NextResponse.json({ error: "Related incident not found" }, { status: 404 });

  const link = await db.$transaction(async (tx) => {
    const l = await tx.incidentLink.upsert({
      where: { incidentId_relatedIncidentId_relationType: { incidentId: id, relatedIncidentId: other.id, relationType: parsed.data.relationType } },
      create: { organizationId: orgId, incidentId: id, relatedIncidentId: other.id, relationType: parsed.data.relationType, createdById: session.user.id },
      update: {},
    });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "incident_linked", actorUserId: session.user.id, actorLabel: session.user.name ?? null, payload: { relatedIncidentId: other.id, relationType: parsed.data.relationType } });
    return l;
  });
  return NextResponse.json({ link });
}
