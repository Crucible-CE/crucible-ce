import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { findAccessibleIncident } from "@/lib/incident/access";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type CalKind = "milestone" | "task" | "event";

interface CalEvent {
  id: string;
  kind: CalKind;
  title: string;
  date: string; // ISO
  status: string | null;
  meta?: string | null;
  // For user-created events (#1): the editable source row + assignee.
  eventId?: string;
  eventType?: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  notes?: string | null;
}

// GET /api/incidents/[id]/calendar — every dated item for one incident in a
// single timeline (#1): milestones (declared/contained/resolved) and task due
// dates. Powers the per-incident calendar/agenda tab.
export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.view")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const incident = await findAccessibleIncident(session.user, id, {
    id: true,
    createdAt: true,
    declaredAt: true,
    containedAt: true,
    resolvedAt: true,
  });
  if (!incident) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [tasks, userEvents] = await Promise.all([
    db.incidentTask.findMany({
      where: { incidentId: id, dueAt: { not: null } },
      select: { id: true, title: true, dueAt: true, status: true, priority: true },
    }),
    db.incidentCalendarEvent.findMany({
      where: { incidentId: id },
      select: {
        id: true,
        title: true,
        startAt: true,
        eventType: true,
        status: true,
        assigneeId: true,
        assigneeName: true,
        notes: true,
      },
    }),
  ]);

  const events: CalEvent[] = [];

  events.push({ id: `m-created-${id}`, kind: "milestone", title: "Incident reported", date: incident.createdAt.toISOString(), status: null });
  if (incident.declaredAt)
    events.push({ id: `m-declared-${id}`, kind: "milestone", title: "Declared", date: incident.declaredAt.toISOString(), status: null });
  if (incident.containedAt)
    events.push({ id: `m-contained-${id}`, kind: "milestone", title: "Contained", date: incident.containedAt.toISOString(), status: null });
  if (incident.resolvedAt)
    events.push({ id: `m-resolved-${id}`, kind: "milestone", title: "Resolved", date: incident.resolvedAt.toISOString(), status: null });

  for (const t of tasks) {
    if (!t.dueAt) continue;
    events.push({
      id: `t-${t.id}`,
      kind: "task",
      title: t.title,
      date: t.dueAt.toISOString(),
      status: t.status,
      meta: t.priority,
    });
  }
  for (const e of userEvents) {
    events.push({
      id: `c-${e.id}`,
      kind: "event",
      title: e.title,
      date: e.startAt.toISOString(),
      status: e.status,
      meta: e.assigneeName,
      eventId: e.id,
      eventType: e.eventType,
      assigneeId: e.assigneeId,
      assigneeName: e.assigneeName,
      notes: e.notes,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
