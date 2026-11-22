import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { appendLedger } from "@/lib/ledger/append";
import { findAccessibleIncident } from "@/lib/incident/access";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/http/parse-body";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

async function loadTask(orgId: string, incidentId: string, taskId: string) {
  return db.incidentTask.findFirst({
    where: { id: taskId, incidentId, organizationId: orgId },
    select: { id: true, title: true, assigneeId: true },
  });
}

// GET /api/incidents/[id]/tasks/[taskId]/comments — the response thread.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, taskId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await loadTask(session.user.organizationId, id, taskId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const comments = await db.incidentTaskComment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({ comments }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({ body: z.string().min(1).max(5000) });

// POST /api/incidents/[id]/tasks/[taskId]/comments — respond to the ticket.
export async function POST(req: Request, context: RouteContext) {
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
  const task = await loadTask(orgId, id, taskId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  const authorName = session.user.name ?? session.user.email ?? "Unknown";
  const comment = await db.$transaction(async (tx) => {
    const c = await tx.incidentTaskComment.create({
      data: { organizationId: orgId, incidentId: id, taskId, authorId: session.user.id, authorName, body: parsed.data.body },
    });
    await appendLedger(tx, {
      incidentId: id,
      organizationId: orgId,
      eventType: "task_commented",
      actorUserId: session.user.id,
      actorLabel: session.user.name ?? null,
      payload: { taskId, commentId: c.id, title: task.title },
    });
    return c;
  });

  // Notify the assignee of a new response (unless they wrote it).
  if (task.assigneeId && task.assigneeId !== session.user.id) {
    await createNotification(
      task.assigneeId,
      "incident_task_comment",
      `New comment on: ${task.title}`,
      parsed.data.body.slice(0, 160),
      { incidentId: id, taskId },
      `/incidents/${id}/tasks/${taskId}`
    ).catch(() => {});
  }

  return NextResponse.json(comment, { status: 201 });
}
