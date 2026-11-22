import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { appendLedger } from "@/lib/ledger/append";
import { canApproveActions } from "@/lib/incident/action-approval";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

const PHASES = ["containment", "eradication", "recovery"] as const;

// GET — the response-action board (containment / eradication / recovery).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [actions, canApprove] = await Promise.all([
    db.incidentAction.findMany({ where: { incidentId: id, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    canApproveActions(session.user, id),
  ]);
  return NextResponse.json({ actions, canApprove, canEdit: hasPermission(session.user, "incidents.edit") }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  phase: z.enum(PHASES),
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  highRisk: z.boolean().default(false),
  assignedToId: z.string().max(LIMITS.ID).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assetIds: z.array(z.string().max(40)).max(100).optional(),
});

// POST — propose a response action. High-risk actions enter pending-approval.
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
  const d = parsed.data;

  const action = await db.$transaction(async (tx) => {
    const a = await tx.incidentAction.create({
      data: {
        organizationId: orgId, incidentId: id, phase: d.phase, title: d.title, description: d.description ?? null,
        highRisk: d.highRisk, approvalStatus: d.highRisk ? "pending" : "not_required",
        requestedById: session.user.id, assignedToId: d.assignedToId ?? null,
        dueAt: d.dueAt ? new Date(d.dueAt) : null,
        assetIdsJson: (d.assetIds ?? []) as unknown as object[],
      },
    });
    await appendLedger(tx, {
      incidentId: id, organizationId: orgId, eventType: "action_proposed", actorUserId: session.user.id, actorLabel: session.user.name ?? null,
      payload: { actionId: a.id, phase: d.phase, title: d.title, highRisk: d.highRisk },
    });
    return a;
  });
  return NextResponse.json({ action });
}
