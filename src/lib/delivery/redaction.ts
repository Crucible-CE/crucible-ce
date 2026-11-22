// Redacted pages for LOCKED incidents (founder decision, final).
//
// Paging is never refused or skipped because the target can't see a locked
// incident: a silently skipped escalation during an insider-threat incident is
// worse than a leak. Instead, a target the lock excludes (an org member who is
// not a participant / administrator / IC, or an external contact without a
// linked account that can see it) receives a REDACTED page: severity + ack
// link only, no incident title, no pager note, no incident deep link. That
// holds on every channel (email, SMS, voice, webhook/plugins with
// `restricted: true`, in-app), on the inbound-SMS ACK reply and on the public
// ack landing page.

import { db } from "@/lib/db";
import { canUserSeeIncident } from "@/lib/incident/access";
import { NOT_DELETED } from "@/lib/incident/live";
import { createAckToken } from "./ack-token";

export interface RedactionTarget {
  organizationId: string;
  incidentId: string;
  targetUserId: string | null;
  targetContactId: string | null;
  /** Pass it when already loaded; otherwise it is read from the incident. */
  incident?: { restricted?: boolean | null } | null;
}

async function isRestricted(page: RedactionTarget): Promise<boolean> {
  if (page.incident && typeof page.incident.restricted === "boolean") return page.incident.restricted;
  const inc = await db.incident.findUnique({ where: { id: page.incidentId, ...NOT_DELETED }, select: { restricted: true } });
  // Unknown / deleted incident: fail closed (redacted; nothing is paged for it anyway).
  return inc ? inc.restricted : true;
}

/** Must this page be redacted for its current target? */
export async function isRedactedTarget(page: RedactionTarget): Promise<boolean> {
  if (!(await isRestricted(page))) return false;
  if (page.targetUserId) return !(await canUserSeeIncident(page.targetUserId, page.incidentId));
  if (page.targetContactId) {
    const c = await db.escalationContact.findFirst({
      where: { id: page.targetContactId, organizationId: page.organizationId },
      select: { userId: true },
    });
    if (!c?.userId) return true; // a pure external contact can never see a locked incident
    return !(await canUserSeeIncident(c.userId, page.incidentId));
  }
  return true;
}

/** Shown in place of the incident title wherever a page is redacted. */
export const RESTRICTED_INCIDENT_TITLE = "Restricted incident";

/**
 * The in-app notification for a redacted target: no title, no note, no
 * incident id or deep link. Its link is the page's signed ack landing page.
 */
export function redactedInAppPage(
  pageId: string,
  level: number,
  severity: string,
  kind: "page" | "escalation" = "page",
): { title: string; body: string; link: string; metadata: { pageId: string; restricted: true } } {
  let link = "/";
  try {
    link = `/api/public/page-ack/${createAckToken(pageId, level)}`;
  } catch (err) {
    console.error(`[delivery] could not sign the ack link for page ${pageId}:`, err);
  }
  return {
    title: kind === "escalation" ? "Escalated page: restricted incident" : "Paged: restricted incident",
    body: `${redactedPageSentence(severity, kind)} Open this notification to acknowledge.`,
    link,
    metadata: { pageId, restricted: true },
  };
}

/** The one sentence a redacted page says (plus its ack link). */
export function redactedPageSentence(severity: string, kind: "page" | "escalation" = "page"): string {
  return kind === "escalation"
    ? `Crucible: an unacknowledged page for a restricted incident (severity ${severity}) was escalated to you.`
    : `Crucible: you are paged for a restricted incident (severity ${severity}).`;
}
