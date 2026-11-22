import { db } from "@/lib/db";

// Activity badges for war-room nav items. Two kinds:
//  - "new":    items created in a section since the viewer last opened it
//              (last-seen is tracked client-side; clears when you open it).
//  - "action": outstanding things that need YOU (unacked pages, open unacked
//              tasks) — independent of last-seen; clears when you act.
export type BadgeKind = "new" | "action";
export interface Badge { count: number; kind: BadgeKind }
export type BadgeMap = Record<string, Badge>;

export const NEW_SECTIONS = ["chat", "comms", "evidence", "sitrep", "intel", "decisions", "calendar"] as const;
export type NewSection = (typeof NEW_SECTIONS)[number];

// `since` maps a section -> the ISO timestamp the user last viewed it. A missing
// or invalid value is treated as "now", so a first-time viewer isn't flooded
// with everything that already existed before they arrived.
export async function computeIncidentBadges(
  userId: string,
  incidentId: string,
  since: Partial<Record<NewSection, string>>,
): Promise<BadgeMap> {
  const at = (s: NewSection): Date => {
    const v = since[s];
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : new Date();
  };

  const [chat, comms, evidence, sitrep, intel, decisions, calendar, pages, tasks] = await Promise.all([
    // Exclude the viewer's own chat messages from their "new" count.
    db.incidentChatMessage.count({ where: { incidentId, createdAt: { gt: at("chat") }, userId: { not: userId } } }),
    db.incidentStakeholderNotification.count({ where: { incidentId, createdAt: { gt: at("comms") } } }),
    db.incidentEvidence.count({ where: { incidentId, createdAt: { gt: at("evidence") } } }),
    db.incidentSitrep.count({ where: { incidentId, createdAt: { gt: at("sitrep") } } }),
    db.incidentIntelPost.count({ where: { incidentId, createdAt: { gt: at("intel") } } }),
    db.incidentDecision.count({ where: { incidentId, createdAt: { gt: at("decisions") } } }),
    db.incidentCalendarEvent.count({ where: { incidentId, createdAt: { gt: at("calendar") } } }),
    db.incidentPage.count({ where: { incidentId, targetUserId: userId, status: "sent" } }),
    db.incidentTask.count({ where: { incidentId, assigneeId: userId, status: { not: "done" }, acknowledgedAt: null } }),
  ]);

  return {
    chat: { count: chat, kind: "new" },
    comms: { count: comms, kind: "new" },
    evidence: { count: evidence, kind: "new" },
    sitrep: { count: sitrep, kind: "new" },
    intel: { count: intel, kind: "new" },
    decisions: { count: decisions, kind: "new" },
    calendar: { count: calendar, kind: "new" },
    escalation: { count: pages, kind: "action" },
    tasks: { count: tasks, kind: "action" },
  };
}
