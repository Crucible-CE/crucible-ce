import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { notify } from "@/lib/notifications/dispatch";
import { containsNulByte, parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { appendLedger } from "@/lib/ledger/append";
import { ledgerEventForTransition, statusTransitionSideEffects, isClosedStatus, incidentStatusSchema } from "@/lib/incident/status";
import { bridgeUrlSchema } from "@/lib/incident/bridge-url";
import { evaluateClosureGate, type ClosureBlocker } from "@/lib/incident/closure-gate";
import { DISPOSITIONS } from "@/lib/incident/disposition";
import { assertIncidentWritable, isIncidentReadOnlyFor } from "@/lib/incident/lock";
import { cancelOpenPagesForIncident } from "@/lib/escalation/engine";
import { ensureIncidentParticipants } from "@/lib/incident/participants";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { evictFromIncidentRoom } from "@/lib/socket/evict";
import { liveIncidentWhere } from "@/lib/incident/live";

const updateSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional(),
  status: incidentStatusSchema.optional(),
  // soft-block closing on a missing postmortem, set to override with an
  // explicit acknowledgement (recorded on the ledger).
  overrideClosureGate: z.boolean().optional(),
  // Required with overrideClosureGate: why the responder is closing over the
  // gate's blockers. Ledgered (closure_gate_overridden) with the blocker codes.
  overrideReason: z.string().trim().min(1).max(2000).optional(),
  // Closure classification — REQUIRED when transitioning into "closed".
  closureDisposition: z.enum(DISPOSITIONS).optional(),
  closureNote: z.string().trim().max(2000).optional(),
  category: z.string().max(LIMITS.SHORT_LABEL).optional(),
  assignedToId: z.string().max(LIMITS.ID).nullable().optional(),
  affectedSystems: z.array(z.string().max(LIMITS.NAME)).max(LIMITS.ARRAY).optional(),
  mitreJson: z.array(z.string().max(LIMITS.SHORT_LABEL)).max(LIMITS.ARRAY).optional(),
  // https-only bridge link (null clears it). Rejects javascript:/data:/etc.
  bridgeUrl: bridgeUrlSchema.nullable().optional(),
  // Structured business impact (#8).
  recordsAffected: z.number().int().min(0).max(LIMITS.INT32_MAX).nullable().optional(),
  customersAffected: z.number().int().min(0).max(LIMITS.INT32_MAX).nullable().optional(),
  downtimeMinutes: z.number().int().min(0).max(LIMITS.INT32_MAX).nullable().optional(),
  estimatedCostUsd: z.number().int().min(0).max(LIMITS.INT32_MAX).nullable().optional(),
  impactDataTypesJson: z.array(z.string().max(LIMITS.SHORT_LABEL)).max(LIMITS.ARRAY).optional(),
  timelineEntry: z.string().max(LIMITS.NOTES).optional(), // append a new timeline event
});

// GET /api/incidents/[id]
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    include: {
      reportedBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      activityLog: { orderBy: { timestamp: "asc" } },
    },
  });

  if (!incident) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The UI hides edit controls and shows the "Locked — read-only" banner off
  // this flag; the write routes enforce the same rule (assertIncidentWritable).
  const lockReadOnly = await isIncidentReadOnlyFor(session.user, incident);
  const viewerCanEdit = hasPermission(session.user, "incidents.edit") && !lockReadOnly;
  // Soft delete is administrator-only (DELETE below); the UI offers it off this.
  const viewerCanDelete = session.user.role === "administrator" && hasPermission(session.user, "incidents.delete");

  return NextResponse.json({ ...incident, lockReadOnly, viewerCanEdit, viewerCanDelete });
}

// PATCH /api/incidents/[id]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = await parseJsonBody(req, updateSchema);
  if (!parsed.ok) return parsed.response;

  const existing = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Locked incidents are read-only except for the IC and administrators.
  const locked = await assertIncidentWritable(session.user, existing);
  if (locked) return locked;

  const data = parsed.data;
  const { timelineEntry, overrideClosureGate, overrideReason, closureDisposition, closureNote, ...updateFields } = data;

  // False positive has a dedicated flow (reason code for detection tuning,
  // false_positive_marked ledger event, its own notification) — PATCH must not
  // be a way around it.
  if (closureDisposition === "false_positive") {
    return NextResponse.json(
      {
        error: "use_false_positive_route",
        message: "Use POST /api/incidents/[id]/false-positive to close as a false positive.",
      },
      { status: 400 },
    );
  }

  const closing = isClosedStatus(data.status ?? "") && !isClosedStatus(existing.status);
  if (closing && !closureDisposition) {
    return NextResponse.json(
      { error: "disposition_required", message: "Select a disposition." },
      { status: 400 },
    );
  }
  if (closing && overrideClosureGate && !overrideReason) {
    return NextResponse.json(
      { error: "override_reason_required", message: "Enter a reason for the override." },
      { status: 400 },
    );
  }

  // Closing gate, evaluated on every close: without an override it blocks and
  // hands the client the blocker list; with one, the blockers being waved
  // through are recorded on the ledger.
  let overriddenBlockers: ClosureBlocker[] = [];
  if (closing) {
    const gate = await evaluateClosureGate(id);
    if (gate.requiresOverride && !overrideClosureGate) {
      return NextResponse.json(
        { error: "closure_blocked", message: "Resolve these before closing, or close with an override.", blockers: gate.blockers },
        { status: 409 },
      );
    }
    if (gate.requiresOverride) overriddenBlockers = gate.blockers;
  }
  const gateOverridden = closing && overriddenBlockers.length > 0;
  // Closure classification only applies on the transition into closed.
  const closureFields: Record<string, unknown> = closing
    ? {
        closedById: session.user.id,
        closureDisposition,
        closureReason: null,
        closureNote: closureNote || null,
      }
    : {};

  if (data.assignedToId) {
    const assignee = await db.user.findUnique({
      where: { id: data.assignedToId },
      select: { id: true, organizationId: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return NextResponse.json({ error: "Assigned user not found" }, { status: 400 });
    }

    if (assignee.organizationId !== session.user.organizationId) {
      return NextResponse.json(
        { error: "Assignee must be in your organization." },
        { status: 403 }
      );
    }
  }

  // Status-transition side-effects (auto-timestamps, reopen clears closure)
  // come from the shared status module so every surface agrees.
  const extraFields = statusTransitionSideEffects(existing, data.status);

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  const statusChanged = !!data.status && data.status !== existing.status;

  // Interactive tx: the incident update, activity rows, and the ledger event
  // for a status transition commit or roll back together — a status change can
  // no longer land without its tamper-evident record.
  const updated = await db.$transaction(async (tx) => {
    // Timeline is a JSON read-merge-write: re-read under a row lock inside
    // the tx so concurrent PATCHes can't drop each other's entries.
    let timelineJson: Array<{ timestamp: string; event: string; userId: string }> | undefined;
    if (timelineEntry) {
      const [fresh] = await tx.$queryRaw<Array<{ timelineJson: unknown }>>`
        SELECT "timelineJson" FROM "Incident" WHERE "id" = ${id} FOR UPDATE`;
      const current = (fresh?.timelineJson ?? []) as Array<{ timestamp: string; event: string; userId: string }>;
      timelineJson = [
        ...current,
        { timestamp: new Date().toISOString(), event: timelineEntry, userId: session.user.id },
      ];
    }

    const u = await tx.incident.update({
      where: { id },
      data: { ...updateFields, ...extraFields, ...closureFields, ...(timelineJson ? { timelineJson } : {}) },
    });

    // Founder lock rule: the assignee gets no implicit access to a locked
    // incident; they are enrolled as an ordinary (removable) participant on
    // (re)assignment instead.
    if (data.assignedToId && data.assignedToId !== existing.assignedToId) {
      await ensureIncidentParticipants(
        {
          organizationId: existing.organizationId,
          incidentId: id,
          userIds: [data.assignedToId],
          addedBy: { id: session.user.id, name: user?.name ?? session.user.name ?? null },
        },
        tx,
      );
    }

    // Closing stops paging in the same transaction: no escalation or delivery
    // retry may fire for a closed incident.
    if (closing) await cancelOpenPagesForIncident(id, tx);

    if (statusChanged && data.status) {
      await tx.incidentActivity.create({
        data: {
          incidentId: id,
          userId: session.user.id,
          userName: user?.name ?? null,
          action: "status_changed",
          notes: `Status changed from ${existing.status} to ${data.status}.`,
          metadata: { from: existing.status, to: data.status },
        },
      });
      await appendLedger(tx, {
        incidentId: id,
        organizationId: session.user.organizationId!,
        eventType: ledgerEventForTransition(existing.status, data.status),
        actorUserId: session.user.id,
        actorLabel: user?.name ?? null,
        // Record the disposition and whether a close bypassed the closure
        // gate so the override is auditable.
        payload: {
          from: existing.status,
          to: data.status,
          ...(closing ? { disposition: closureDisposition } : {}),
          ...(gateOverridden ? { closureGateOverridden: true } : {}),
        },
      });
    }

    if (gateOverridden) {
      // The override itself is a first-class, tamper-evident record — who
      // overrode, why, and exactly which blockers were waved through.
      const blockerCodes = overriddenBlockers.map((b) => b.code);
      await appendLedger(tx, {
        incidentId: id,
        organizationId: session.user.organizationId!,
        eventType: "closure_gate_overridden",
        actorUserId: session.user.id,
        actorLabel: user?.name ?? null,
        payload: { reason: overrideReason, blockers: blockerCodes },
      });
      await tx.incidentActivity.create({
        data: {
          incidentId: id,
          userId: session.user.id,
          userName: user?.name ?? null,
          action: "closure_gate_overridden",
          notes: `Closed with override (${overriddenBlockers.map((b) => b.message).join(" ")}). Reason: ${overrideReason}`,
          metadata: { reason: overrideReason, blockers: blockerCodes },
        },
      });
    }

    if (timelineEntry) {
      await tx.incidentActivity.create({
        data: {
          incidentId: id,
          userId: session.user.id,
          userName: user?.name ?? null,
          action: "note_added",
          notes: timelineEntry,
        },
      });
    }

    // audit who set/cleared the war-room bridge link.
    if (data.bridgeUrl !== undefined && data.bridgeUrl !== existing.bridgeUrl) {
      await tx.incidentActivity.create({
        data: {
          incidentId: id,
          userId: session.user.id,
          userName: user?.name ?? null,
          action: "bridge_updated",
          notes: data.bridgeUrl ? "War-room bridge link set." : "War-room bridge link cleared.",
        },
      });
    }

    return u;
  });

  // Notify the roster on a real status change (resolver picks each person's
  // channels; the actor is excluded).
  if (data.status && data.status !== existing.status) {
    await notify({
      event: "status_changed",
      organizationId: session.user.organizationId,
      incidentId: id,
      actorUserId: session.user.id,
      title: `Incident status: ${data.status}`,
      body: `"${existing.title}" moved from ${existing.status} to ${data.status}.`,
      link: `/incidents/${id}`,
      metadata: { from: existing.status, to: data.status, incidentId: id },
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}

const deleteSchema = z.object({ reason: z.string().trim().max(2000).optional() });

// DELETE /api/incidents/[id] — administrator-only SOFT delete (M6).
// Sets deletedAt/deletedById; the row, its children and its hash-chained
// ledger are preserved (an `incident_deleted` entry is appended) and the
// action is recorded in the admin audit log. Every list/lookup excludes
// deleted incidents (lib/incident/access + explicit `deletedAt: null`
// filters), open pages are cancelled, and live war-room sockets are evicted.
// There is no purge in v0.1.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Administrators only (the role, not just the permission bit).
  if (session.user.role !== "administrator" || !hasPermission(session.user, "incidents.delete")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = session.user.organizationId;

  // Optional body: { reason }.
  let reason: string | undefined;
  const raw = await req.text().catch(() => "");
  if (raw.trim()) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (containsNulByte(json)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const parsedBody = deleteSchema.safeParse(json);
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    reason = parsedBody.data.reason || undefined;
  }

  const existing = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true, title: true, status: true, organizationId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await db.$transaction(async (tx) => {
    // Conditional update: a concurrent delete can't double-ledger.
    const res = await tx.incident.updateMany({
      where: liveIncidentWhere({ id, organizationId: orgId }),
      data: { deletedAt: new Date(), deletedById: session.user.id },
    });
    if (res.count === 0) return false;
    // A deleted incident must not keep paging anyone.
    await cancelOpenPagesForIncident(id, tx, "incident_deleted");
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "incident_deleted",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { title: existing.title, status: existing.status, ...(reason ? { reason } : {}) },
    });
    return true;
  });
  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await recordAdminAuditLog({
      actorUserId: session.user.id,
      actorEmail: session.user.email ?? null,
      actorName: session.user.name ?? null,
      organizationId: orgId,
      action: "incident.delete",
      targetType: "incident",
      targetId: id,
      targetLabel: existing.title,
      metadata: { soft: true, status: existing.status, ...(reason ? { reason } : {}) },
    });
  } catch (auditError) {
    console.error("[admin-audit] Failed to record incident.delete", auditError);
  }

  // Nobody can see a deleted incident: drop every live war-room socket and
  // every calendar-feed link for it. Neither helper throws.
  void evictFromIncidentRoom(id, { recheckAll: true });
  // (verifyIcsToken already refuses a deleted incident; this makes it explicit.)
  await db.icsFeedToken
    .updateMany({ where: { incidentId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    .catch((err) => console.error("[ics] token revoke on delete failed:", err));

  return NextResponse.json({ deleted: true, soft: true });
}
