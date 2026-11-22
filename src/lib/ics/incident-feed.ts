// Shared event assembly for the incident ICS export + subscription feed.
// Mirrors /api/incidents/[id]/calendar's timeline: milestones,
// task due dates, and user-created calendar events.

import { db } from "@/lib/db";
import { buildIcsCalendar, type IcsEvent } from "./ics";
import { liveIncidentWhere } from "@/lib/incident/live";

export async function buildIncidentIcs(incidentId: string): Promise<string | null> {
  // Soft-deleted incidents produce no feed (callers also gate on access).
  const incident = await db.incident.findFirst({
    where: liveIncidentWhere({ id: incidentId, isTraining: false }),
    select: {
      id: true,
      title: true,
      createdAt: true,
      declaredAt: true,
      containedAt: true,
      resolvedAt: true,
    },
  });
  if (!incident) return null;

  const [tasks, userEvents] = await Promise.all([
    db.incidentTask.findMany({
      where: { incidentId, dueAt: { not: null } },
      select: { id: true, title: true, dueAt: true, status: true },
    }),
    db.incidentCalendarEvent.findMany({
      where: { incidentId },
      select: { id: true, title: true, startAt: true, status: true, notes: true },
    }),
  ]);

  const events: IcsEvent[] = [];
  events.push({ uid: `m-created-${incident.id}`, title: "Incident reported", start: incident.createdAt });
  if (incident.declaredAt)
    events.push({ uid: `m-declared-${incident.id}`, title: "Declared", start: incident.declaredAt });
  if (incident.containedAt)
    events.push({ uid: `m-contained-${incident.id}`, title: "Contained", start: incident.containedAt });
  if (incident.resolvedAt)
    events.push({ uid: `m-resolved-${incident.id}`, title: "Resolved", start: incident.resolvedAt });

  for (const t of tasks) {
    if (!t.dueAt) continue;
    events.push({ uid: `t-${t.id}`, title: `Task due: ${t.title}`, start: t.dueAt, meta: t.status });
  }
  for (const e of userEvents) {
    events.push({
      uid: `c-${e.id}`,
      title: e.title,
      start: e.startAt,
      description: e.notes,
      meta: e.status,
    });
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return buildIcsCalendar({ name: `Crucible: ${incident.title}`, events });
}
