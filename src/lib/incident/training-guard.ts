// Fail-closed egress guard for training incidents (lib/incident/training).
// Every path that reaches a person or a system outside the war room (in-app
// notifications, push, email, SMS, pages and their webhooks, status pages,
// guest links, exports) asks here first. Kept tiny and import-free beyond the
// db client so the notification and delivery layers can use it without cycles.

import { db } from "@/lib/db";

/** True when the incident is a training incident. Unknown ids are not training. */
export async function isTrainingIncident(incidentId: string | null | undefined): Promise<boolean> {
  if (!incidentId) return false;
  const row = await db.incident.findUnique({ where: { id: incidentId }, select: { isTraining: true } });
  return row?.isTraining === true;
}

/**
 * The incident a notification is about: metadata.incidentId, else an
 * /incidents/<id> link. Null when it is not about an incident.
 */
export function notificationIncidentId(metadata: unknown, link: string | null | undefined): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const id = (metadata as Record<string, unknown>).incidentId;
    if (typeof id === "string" && id) return id;
  }
  const m = typeof link === "string" ? /^\/incidents\/([^/?#]+)/.exec(link) : null;
  return m ? m[1] : null;
}
