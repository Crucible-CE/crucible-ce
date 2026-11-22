// Ops Room "Needs you now": what the signed-in member personally has to act on.
//   pages     pages sent to ME awaiting my ack (plus my own pending test page)
//   roles     active incidents where I hold a command role or am the assignee,
//             with the SLA headline
//   tasks     my open tasks that are overdue or due within 24h
//   mentions  unread @mention notifications
// Every incident read goes through accessibleIncidentsWhere (lock rules). A
// page for a LOCKED incident the member cannot see is still listed, redacted,
// with its signed ack link (same as the paging popup does).

import { db } from "@/lib/db";
import { accessibleIncidentsWhere, type AccessUser } from "@/lib/incident/access";
import { ACTIVE_STATUS_FILTER } from "@/lib/incident/status";
import { ackUrlFor } from "@/lib/delivery/engine";
import { RESTRICTED_INCIDENT_TITLE } from "@/lib/delivery/redaction";
import { TEST_PAGE_KEY, readTestPage } from "@/lib/onboarding/state";
import { loadSlaHeadlines } from "./sla-summary";
import type { SlaHeadline } from "./sla-headline";
import { TASK_DUE_SOON_HOURS, classifyTaskDue, myRoles, type TaskDue } from "./rules";

export interface PageNeed {
  id: string;
  incidentId: string | null;
  title: string;
  severity: string;
  createdAt: string;
  ackDeadlineAt: string | null;
  /** Locked incident the member can't open: acknowledge through the signed link. */
  restricted: boolean;
  ackUrl: string | null;
}

export interface TestPageNeed {
  sentAt: string;
}

export interface RoleNeed {
  incidentId: string;
  title: string;
  severity: string;
  status: string;
  roles: string[];
  sla: SlaHeadline;
}

export interface TaskNeed {
  id: string;
  incidentId: string;
  incidentTitle: string;
  title: string;
  priority: string;
  dueAt: string;
  due: Exclude<TaskDue, null>;
}

export interface MentionNeed {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
}

export interface NeedsYou {
  pages: PageNeed[];
  testPage: TestPageNeed | null;
  roles: RoleNeed[];
  tasks: TaskNeed[];
  mentions: MentionNeed[];
  /** Total actionable items (roles are context, not counted). */
  count: number;
}

// In-app notifications carry the catalog category code as their type.
const MENTION_TYPE = "incident.mention";

export async function loadNeedsYou(user: AccessUser & { organizationId: string }, now: Date = new Date()): Promise<NeedsYou> {
  const soon = new Date(now.getTime() + TASK_DUE_SOON_HOURS * 3_600_000);
  const [pages, roleIncidents, tasks, mentions, testRow] = await Promise.all([
    db.incidentPage.findMany({
      where: { organizationId: user.organizationId, targetUserId: user.id, status: "sent", incident: { deletedAt: null, status: ACTIVE_STATUS_FILTER } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        escalationLevel: true,
        createdAt: true,
        ackDeadlineAt: true,
        incidentId: true,
        incident: { select: { title: true, severity: true } },
      },
    }),
    db.incident.findMany({
      where: {
        AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { status: ACTIVE_STATUS_FILTER }],
        OR: [{ roleAssignments: { some: { userId: user.id } } }, { assignedToId: user.id }],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        createdAt: true,
        declaredAt: true,
        containedAt: true,
        resolvedAt: true,
        closedAt: true,
        assignedToId: true,
        roleAssignments: { where: { userId: user.id }, select: { role: true } },
      },
    }),
    db.incidentTask.findMany({
      where: {
        organizationId: user.organizationId,
        assigneeId: user.id,
        status: { not: "done" },
        dueAt: { not: null, lte: soon },
        incident: { AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { status: ACTIVE_STATUS_FILTER }] },
      },
      orderBy: { dueAt: "asc" },
      take: 10,
      select: { id: true, title: true, priority: true, dueAt: true, incidentId: true, incident: { select: { title: true } } },
    }),
    db.notification.findMany({
      where: { userId: user.id, type: MENTION_TYPE, read: false, dismissedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, body: true, link: true, createdAt: true },
    }),
    db.onboardingState.findUnique({
      where: { scope_subjectId_key: { scope: "user", subjectId: user.id, key: TEST_PAGE_KEY } },
      select: { id: true, value: true },
    }),
  ]);

  // Which paged incidents may this member open?
  const pagedIds = [...new Set(pages.map((p) => p.incidentId))];
  const openable = pagedIds.length
    ? new Set((await db.incident.findMany({ where: { AND: [accessibleIncidentsWhere(user, { excludeTraining: true }), { id: { in: pagedIds } }] }, select: { id: true } })).map((i) => i.id))
    : new Set<string>();

  const slas = await loadSlaHeadlines(user.organizationId, roleIncidents, now);
  const test = testRow ? readTestPage(testRow.id, testRow.value) : null;

  const out: NeedsYou = {
    pages: pages.map((p) => {
      const ok = openable.has(p.incidentId);
      return {
        id: p.id,
        incidentId: ok ? p.incidentId : null,
        title: ok ? p.incident.title : RESTRICTED_INCIDENT_TITLE,
        severity: p.incident.severity,
        createdAt: p.createdAt.toISOString(),
        ackDeadlineAt: p.ackDeadlineAt?.toISOString() ?? null,
        restricted: !ok,
        ackUrl: ok ? null : ackUrlFor(p.id, p.escalationLevel, now),
      };
    }),
    testPage: test && !test.ackedAt ? { sentAt: test.sentAt } : null,
    roles: roleIncidents.map((i) => ({
      incidentId: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      roles: myRoles(i.roleAssignments, i.assignedToId === user.id),
      sla: slas.get(i.id) ?? { state: "none", label: null, deadline: null, remainingMinutes: null },
    })),
    tasks: tasks
      .map((t) => ({ t, due: classifyTaskDue(t.dueAt, now) }))
      .filter((x): x is { t: (typeof tasks)[number]; due: Exclude<TaskDue, null> } => x.due !== null)
      .map(({ t, due }) => ({
        id: t.id,
        incidentId: t.incidentId,
        incidentTitle: t.incident.title,
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt!.toISOString(),
        due,
      })),
    mentions: mentions.map((m) => ({ id: m.id, title: m.title, body: m.body, link: m.link, createdAt: m.createdAt.toISOString() })),
    count: 0,
  };
  out.count = out.pages.length + (out.testPage ? 1 : 0) + out.tasks.length + out.mentions.length;
  return out;
}
