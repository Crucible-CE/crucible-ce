import { NextResponse } from "next/server";
import { accessibleIncidentsWhere } from "@/lib/incident/access";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { notify } from "@/lib/notifications/dispatch";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

// GET /api/incidents/[id]/tasks
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
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tasks = await db.incidentTask.findMany({
    where: { incidentId: id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  assigneeId: z.string().max(LIMITS.ID).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  dueAt: z.string().datetime().optional(),
});

// POST /api/incidents/[id]/tasks
export async function POST(
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
  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;

  const { id } = await params;
  const orgId = session.user.organizationId;
  const userId = session.user.id;
  const incident = await db.incident.findFirst({
    where: { id, ...accessibleIncidentsWhere(session.user) },
    select: { id: true },
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const assignedNow = !!parsed.data.assigneeId;
  const created = await db.$transaction(async (tx) => {
    const t = await tx.incidentTask.create({
      data: {
        organizationId: orgId,
        incidentId: id,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        assigneeId: parsed.data.assigneeId ?? null,
        assignedById: assignedNow ? userId : null,
        assignedAt: assignedNow ? new Date() : null,
        priority: parsed.data.priority ?? "medium",
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "task_updated",
      actorUserId: userId,
      actorLabel: session.user.name ?? session.user.email ?? null,
      payload: { taskId: t.id, title: t.title, kind: "created" },
    });
    if (assignedNow) {
      await appendLedger(tx, {
        incidentId: id,
        organizationId: orgId,
        eventType: "task_assigned",
        actorUserId: userId,
        actorLabel: session.user.name ?? null,
        payload: { taskId: t.id, assigneeId: parsed.data.assigneeId, title: t.title },
      });
    }
    return t;
  });

  // Notify (and page, for high/critical) the assignee via the dispatcher.
  if (assignedNow && parsed.data.assigneeId && parsed.data.assigneeId !== userId) {
    const link = `/incidents/${id}/tasks/${created.id}`;
    const priority = parsed.data.priority ?? "medium";
    const isPage = priority === "high" || priority === "critical";
    await notify({
      event: isPage ? "page_sent" : "task_assigned",
      organizationId: orgId,
      incidentId: id,
      actorUserId: userId,
      recipientIds: [parsed.data.assigneeId],
      title: isPage ? `Action assigned: ${created.title}` : "You were assigned an action",
      body: isPage ? `Priority ${priority}. Acknowledge it in the incident.` : `${created.title}. Acknowledge and respond.`,
      link,
      metadata: { incidentId: id, taskId: created.id },
    }).catch(() => {});
  }

  return NextResponse.json(created, { status: 201 });
}
