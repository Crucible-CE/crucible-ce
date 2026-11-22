import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";
import { createNotification } from "@/lib/notifications";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { assertIncidentWritable } from "@/lib/incident/lock";

interface RouteContext {
  params: Promise<{ id: string; eventId: string }>;
}

const EVENT_TYPES = ["meeting", "deadline", "reminder", "review", "milestone", "other"] as const;

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  notes: z.string().max(2000).optional().nullable(),
  eventType: z.enum(EVENT_TYPES).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional().nullable(),
  assigneeId: z.string().max(LIMITS.ID).optional().nullable(),
  status: z.enum(["scheduled", "done", "cancelled"]).optional(),
});

// PATCH /api/incidents/[id]/calendar-events/[eventId] — edit, reassign, or set status.
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, eventId } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const existing = await db.incidentCalendarEvent.findFirst({
    where: { id: eventId, incidentId: id },
    select: { id: true, assigneeId: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes || null;
  if (parsed.data.eventType !== undefined) data.eventType = parsed.data.eventType;
  if (parsed.data.startAt !== undefined) data.startAt = new Date(parsed.data.startAt);
  if (parsed.data.endAt !== undefined) data.endAt = parsed.data.endAt ? new Date(parsed.data.endAt) : null;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  let notifyAssignee: string | null = null;
  if (parsed.data.assigneeId !== undefined) {
    if (parsed.data.assigneeId) {
      const member = await db.user.findFirst({
        where: { id: parsed.data.assigneeId, organizationId: orgId, isActive: true },
        select: { id: true, name: true, email: true },
      });
      if (!member) return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
      data.assigneeId = member.id;
      data.assigneeName = member.name ?? member.email ?? "Unknown";
      if (member.id !== existing.assigneeId && member.id !== session.user.id) notifyAssignee = member.id;
    } else {
      data.assigneeId = null;
      data.assigneeName = null;
    }
  }

  const updated = await db.incidentCalendarEvent.update({ where: { id: eventId }, data });

  if (notifyAssignee) {
    await createNotification(
      notifyAssignee,
      "incident_calendar_assigned",
      "You were assigned a calendar item",
      `${updated.title}, ${new Date(updated.startAt).toLocaleString()}`,
      { incidentId: id, eventId },
      `/incidents/${id}/calendar`
    ).catch(() => {});
  }

  return NextResponse.json(updated);
}

// DELETE /api/incidents/[id]/calendar-events/[eventId]
export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id, eventId } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;
  const existing = await db.incidentCalendarEvent.findFirst({ where: { id: eventId, incidentId: id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.incidentCalendarEvent.delete({ where: { id: eventId } });
  return NextResponse.json({ ok: true });
}
