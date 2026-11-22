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
  params: Promise<{ id: string }>;
}

const EVENT_TYPES = ["meeting", "deadline", "reminder", "review", "milestone", "other"] as const;

// GET /api/incidents/[id]/calendar-events — user-created calendar items (#1).
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const events = await db.incidentCalendarEvent.findMany({
    where: { incidentId: id },
    orderBy: { startAt: "asc" },
  });
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  title: z.string().min(1).max(300),
  notes: z.string().max(2000).optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime().optional(),
  assigneeId: z.string().max(LIMITS.ID).optional().nullable(),
});

// POST /api/incidents/[id]/calendar-events — add an event (optionally assigned).
export async function POST(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const orgId = session.user.organizationId;
  if (!(await findAccessibleIncident(session.user, id, { id: true }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const locked = await assertIncidentWritable(session.user, { id });
  if (locked) return locked;

  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;

  // Resolve an assignee (must be an org member).
  let assigneeName: string | null = null;
  if (parsed.data.assigneeId) {
    const member = await db.user.findFirst({
      where: { id: parsed.data.assigneeId, organizationId: orgId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!member) return NextResponse.json({ error: "Assignee not found" }, { status: 400 });
    assigneeName = member.name ?? member.email ?? "Unknown";
  }

  const event = await db.incidentCalendarEvent.create({
    data: {
      organizationId: orgId,
      incidentId: id,
      title: parsed.data.title,
      notes: parsed.data.notes || null,
      eventType: parsed.data.eventType ?? "meeting",
      startAt: new Date(parsed.data.startAt),
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
      assigneeId: parsed.data.assigneeId || null,
      assigneeName,
      createdById: session.user.id,
      createdByName: session.user.name ?? null,
    },
  });

  if (parsed.data.assigneeId && parsed.data.assigneeId !== session.user.id) {
    await createNotification(
      parsed.data.assigneeId,
      "incident_calendar_assigned",
      "You were assigned a calendar item",
      `${event.title}, ${new Date(event.startAt).toLocaleString()}`,
      { incidentId: id, eventId: event.id },
      `/incidents/${id}/calendar`
    ).catch(() => {});
  }

  return NextResponse.json(event, { status: 201 });
}
