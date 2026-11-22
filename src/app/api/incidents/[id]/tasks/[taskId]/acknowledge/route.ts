import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

// POST /api/incidents/[id]/tasks/[taskId]/acknowledge — the assignee accepts the
// action. Stamps who/when, advances status open → acknowledged, and ledgers it.
export async function POST(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, taskId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const task = await db.incidentTask.findFirst({
    where: { id: taskId, incidentId: id, organizationId: orgId },
    select: { id: true, title: true, assigneeId: true, status: true, acknowledgedAt: true },
  });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (task.acknowledgedAt) return NextResponse.json({ error: "Already acknowledged" }, { status: 409 });
  // The assigned responder accepts the action. (An unassigned ticket can be
  // acknowledged by whoever picks it up.)
  if (task.assigneeId && task.assigneeId !== session.user.id) {
    return NextResponse.json({ error: "Only the assignee can acknowledge this action" }, { status: 403 });
  }

  const updated = await db.$transaction(async (tx) => {
    const t = await tx.incidentTask.update({
      where: { id: taskId },
      data: {
        acknowledgedById: session.user.id,
        acknowledgedAt: new Date(),
        status: task.status === "open" ? "acknowledged" : task.status,
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "task_acknowledged",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: { taskId, title: task.title },
    });
    return t;
  });

  return NextResponse.json(updated);
}
