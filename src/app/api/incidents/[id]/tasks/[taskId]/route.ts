import { NextResponse } from "next/server";
import { findAccessibleIncident } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { notify } from "@/lib/notifications/dispatch";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().max(LIMITS.ID).nullable().optional(),
  status: z.enum(["open", "acknowledged", "in_progress", "blocked", "done"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

// GET /api/incidents/[id]/tasks/[taskId] — the full action ticket: the task,
// its response thread, attachments, and the per-ticket audit trail.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, taskId } = await params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const task = await db.incidentTask.findFirst({
    where: { id: taskId, incidentId: id, organizationId: session.user.organizationId },
    include: {
      comments: { orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" }, select: { id: true, filename: true, mimeType: true, sizeBytes: true, sha256: true, uploadedByName: true, createdAt: true } },
    },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Per-ticket audit trail = ledger entries that reference this task.
  const ledger = await db.incidentLedgerEntry.findMany({
    where: { incidentId: id, eventType: { startsWith: "task_" } },
    orderBy: { seq: "asc" },
    select: { seq: true, eventType: true, actorLabel: true, payloadJson: true, createdAt: true },
  });
  const audit = ledger.filter((l) => {
    const p = l.payloadJson as Record<string, unknown> | null;
    return p && p.taskId === taskId;
  });

  return NextResponse.json({ task, audit }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH /api/incidents/[id]/tasks/[taskId] — edit the action ticket. Emits
// granular, per-action ledger events (assign / status change / edit) and
// notifies (and pages, for high/critical) a newly-assigned responder.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const { id, taskId } = await params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const userId = session.user.id;
  const actorLabel = session.user.name ?? null;

  const existing = await db.incidentTask.findFirst({
    where: { id: taskId, incidentId: id, organizationId: orgId },
    select: { id: true, assigneeId: true, status: true, priority: true, title: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const d = parsed.data;
  const assigneeChanged = d.assigneeId !== undefined && d.assigneeId !== existing.assigneeId;
  const statusChanged = d.status !== undefined && d.status !== existing.status;
  const done = d.status === "done";
  const effectivePriority = d.priority ?? existing.priority;

  const updated = await db.$transaction(async (tx) => {
    const t = await tx.incidentTask.update({
      where: { id: taskId },
      data: {
        title: d.title,
        description: d.description,
        assigneeId: d.assigneeId === undefined ? undefined : d.assigneeId,
        priority: d.priority,
        status: d.status,
        dueAt: d.dueAt === undefined ? undefined : d.dueAt ? new Date(d.dueAt) : null,
        completedAt: done ? new Date() : d.status ? null : undefined,
        // Assignment provenance; reassigning clears a stale acknowledgement.
        ...(assigneeChanged
          ? { assignedById: userId, assignedAt: new Date(), acknowledgedById: null, acknowledgedAt: null }
          : {}),
      },
    });

    if (assigneeChanged) {
      await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "task_assigned", actorUserId: userId, actorLabel, payload: { taskId, assigneeId: d.assigneeId, title: existing.title } });
    }
    if (statusChanged) {
      await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "task_status_changed", actorUserId: userId, actorLabel, payload: { taskId, from: existing.status, to: d.status, title: existing.title } });
    }
    if (!assigneeChanged && !statusChanged) {
      await appendLedger(tx, { incidentId: id, organizationId: orgId, eventType: "task_updated", actorUserId: userId, actorLabel, payload: { taskId, status: t.status, kind: "edited" } });
    }
    return t;
  });

  // Notify (and page, for high/critical) the newly-assigned responder via the
  // preference-aware dispatcher.
  if (assigneeChanged && d.assigneeId && d.assigneeId !== userId) {
    const link = `/incidents/${id}/tasks/${taskId}`;
    const isPage = effectivePriority === "high" || effectivePriority === "critical";
    await notify({
      event: isPage ? "page_sent" : "task_assigned",
      organizationId: orgId,
      incidentId: id,
      actorUserId: userId,
      recipientIds: [d.assigneeId],
      title: isPage ? `Action assigned: ${existing.title}` : "You were assigned an action",
      body: isPage ? `Priority ${effectivePriority}. Acknowledge it in the incident.` : `${existing.title}. Acknowledge and respond.`,
      link,
      metadata: { incidentId: id, taskId },
    }).catch(() => {});
  }

  return NextResponse.json(updated);
}
