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

const schema = z.object({
  op: z.enum(["status", "approve", "reject", "edit"]),
  status: z.enum(["proposed", "in_progress", "done", "verified", "cancelled"]).optional(),
  reason: z.string().max(1000).optional(),
  verificationNote: z.string().max(1000).optional(),
  assignedToId: z.string().max(LIMITS.ID).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assetIds: z.array(z.string().max(40)).max(100).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; actionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, actionId } = await params;
  const orgId = session.user.organizationId;
  const actorLabel = session.user.name ?? session.user.email ?? null;

  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const action = await db.incidentAction.findFirst({ where: { id: actionId, incidentId: id, organizationId: orgId, deletedAt: null } });
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { op } = parsed.data;

  // ---- approve / reject: require IC or Exec Sponsor authority ----
  if (op === "approve" || op === "reject") {
    if (!action.highRisk || action.approvalStatus !== "pending") return NextResponse.json({ error: "This action doesn't need approval." }, { status: 400 });
    if (!(await canApproveActions(session.user, id))) {
      return NextResponse.json({ error: "Only the Incident Commander or Executive Sponsor can approve high-risk actions" }, { status: 403 });
    }
    await db.$transaction(async (tx) => {
      if (op === "approve") {
        await tx.incidentAction.update({ where: { id: actionId }, data: { approvalStatus: "approved", approvedById: session.user.id, approvedByName: actorLabel, approvedAt: new Date(), status: "approved" } });
        await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "action_approved", actorUserId: session.user.id, actorLabel, payload: { actionId, title: action.title } });
      } else {
        await tx.incidentAction.update({ where: { id: actionId }, data: { approvalStatus: "rejected", status: "rejected", rejectedReason: parsed.data.reason ?? null } });
        await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "action_rejected", actorUserId: session.user.id, actorLabel, payload: { actionId, title: action.title, reason: parsed.data.reason ?? null } });
      }
    });
    return NextResponse.json({ ok: true });
  }

  // ---- status update ----
  if (op === "status" && parsed.data.status) {
    const toStatus = parsed.data.status;
    await db.$transaction(async (tx) => {
      await tx.incidentAction.update({ where: { id: actionId }, data: { status: toStatus, verificationNote: parsed.data.verificationNote ?? action.verificationNote } });
      await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "task_status_changed", actorUserId: session.user.id, actorLabel, payload: { actionId, from: action.status, to: toStatus, title: action.title } });
    });
    return NextResponse.json({ ok: true });
  }

  // ---- edit: assignee / ETA / linked assets ----
  if (op === "edit") {
    const changed = (["assignedToId", "dueAt", "assetIds"] as const).filter((k) => parsed.data[k] !== undefined);
    await db.$transaction(async (tx) => {
      await tx.incidentAction.update({
        where: { id: actionId },
        data: {
          ...(parsed.data.assignedToId !== undefined ? { assignedToId: parsed.data.assignedToId } : {}),
          ...(parsed.data.dueAt !== undefined ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null } : {}),
          ...(parsed.data.assetIds !== undefined ? { assetIdsJson: parsed.data.assetIds as unknown as object[] } : {}),
        },
      });
      await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "task_updated", actorUserId: session.user.id, actorLabel, payload: { actionId, title: action.title, kind: "edited", changed } });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
}

// DELETE — soft-delete: sets deletedAt so the undo toast can restore.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; actionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user, "incidents.edit")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, actionId } = await params;
  const orgId = session.user.organizationId;
  const incident = await db.incident.findFirst({ where: { id, ...accessibleIncidentsWhere(session.user) }, select: { id: true, restricted: true } });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, incident);
  if (locked) return locked;
  const action = await db.incidentAction.findFirst({ where: { id: actionId, incidentId: id, organizationId: orgId, deletedAt: null }, select: { id: true, title: true, phase: true } });
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.$transaction(async (tx) => {
    await tx.incidentAction.update({ where: { id: actionId }, data: { deletedAt: new Date() } });
    await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "response_action_deleted", actorUserId: session.user.id, actorLabel: session.user.name ?? session.user.email ?? null, payload: { actionId, title: action.title, phase: action.phase } });
  });
  return NextResponse.json({ ok: true, undoToken: actionId });
}
