// =============================================================================
// Notification catalog — the single source of truth for what can be notified,
// how urgent it is, and which channels deliver it by default.
//
// The unit a user (and an org admin) configures is a CATEGORY, not a raw event.
// Many low-level events map onto one category so the settings UI stays legible
// (e.g. every task field-change rolls up to "Activity on your tasks").
//
// This catalog governs the incident/war-room notification system.
// =============================================================================

export const CHANNELS = ["in_app", "push", "email", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];

// Urgency drives delivery behavior, independent of channel:
//   critical — breaks Do-Not-Disturb / quiet hours, eligible for escalation
//   high     — delivered immediately on every enabled channel
//   normal   — delivered immediately in-app; other channels only if opted in
//   low      — eligible for digest batching instead of an individual ping
export const URGENCIES = ["critical", "high", "normal", "low"] as const;
export type Urgency = (typeof URGENCIES)[number];

// How recipients are resolved for an event (the dispatcher implements each).
export type AudienceKind =
  | "direct" //   an explicit user (assignee, paged, mentioned)
  | "roster" //   all incident participants + role holders
  | "watchers" // users who chose to follow the incident
  | "command"; //  the command roster (role holders) only

export interface NotificationCategory {
  code: string;
  group: string; // settings-UI section header
  label: string;
  description: string;
  urgency: Urgency;
  /** Channels enabled by default for a fresh user. */
  defaultChannels: Channel[];
  /** Channels the user is even allowed to pick (the rest are hidden/disabled). */
  availableChannels: Channel[];
  audience: AudienceKind;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const CATEGORIES: NotificationCategory[] = [
  // ---- Paging (always loud) ----
  {
    code: "incident.paged",
    group: "Paging",
    label: "You're paged",
    description: "A page or emergency broadcast sent to you. Breaks Do-Not-Disturb.",
    urgency: "critical",
    defaultChannels: ["in_app", "push", "sms"],
    availableChannels: ["in_app", "push", "sms"],
    audience: "direct",
  },
  {
    code: "incident.declared",
    group: "Paging",
    label: "Critical incident declared",
    description: "A critical or high incident is declared.",
    urgency: "critical",
    defaultChannels: ["in_app", "push"],
    availableChannels: ["in_app", "push", "sms", "email"],
    audience: "roster",
  },

  // ---- Assignments (about you) ----
  {
    code: "incident.role_assigned",
    group: "Assigned to you",
    label: "You're assigned a command role",
    description: "You're named to a command role, like Incident Commander.",
    urgency: "high",
    defaultChannels: ["in_app", "push"],
    availableChannels: ["in_app", "push", "email"],
    audience: "direct",
  },
  {
    code: "incident.task_assigned",
    group: "Assigned to you",
    label: "A task is assigned to you",
    description: "You own a new incident task.",
    urgency: "high",
    defaultChannels: ["in_app", "push"],
    availableChannels: ["in_app", "push", "email"],
    audience: "direct",
  },
  {
    code: "incident.mention",
    group: "Assigned to you",
    label: "You're @mentioned",
    description: "Someone @mentions you in chat, a note or a decision.",
    urgency: "high",
    defaultChannels: ["in_app", "push"],
    availableChannels: ["in_app", "push"],
    audience: "direct",
  },
  {
    code: "incident.task_activity",
    group: "Assigned to you",
    label: "Activity on your tasks",
    description: "Status changes, comments or files on your tasks.",
    urgency: "normal",
    defaultChannels: ["in_app"],
    availableChannels: ["in_app", "push"],
    audience: "direct",
  },

  // ---- Incident progress (the room) ----
  {
    code: "incident.status",
    group: "Incident progress",
    label: "Status changes",
    description: "An incident you're on is contained, resolved or reopened.",
    urgency: "high",
    defaultChannels: ["in_app", "push"],
    availableChannels: ["in_app", "push", "email"],
    audience: "roster",
  },
  {
    code: "incident.evidence_decisions",
    group: "Incident progress",
    label: "Evidence and decisions",
    description: "New evidence or decisions in an incident you're on.",
    urgency: "normal",
    defaultChannels: ["in_app"],
    availableChannels: ["in_app", "push"],
    audience: "roster",
  },
  {
    code: "incident.collaboration",
    group: "Incident progress",
    label: "Notes, SITREPs and participants",
    description: "Notes, SITREPs and people joining or leaving. Usually batched.",
    urgency: "low",
    defaultChannels: ["in_app"],
    availableChannels: ["in_app", "push"],
    audience: "watchers",
  },
];

export const CATEGORY_BY_CODE: Record<string, NotificationCategory> = Object.fromEntries(
  CATEGORIES.map((c) => [c.code, c]),
);

// ---------------------------------------------------------------------------
// Event -> category mapping
//
// Low-level event keys (the dispatcher's `event` arg, aligned with ledger
// event types where possible) resolve to a category. Unmapped events fall back
// to a sensible default at the call site.
// ---------------------------------------------------------------------------

export const EVENT_TO_CATEGORY: Record<string, string> = {
  page_sent: "incident.paged",
  oob_broadcast: "incident.paged",
  declared: "incident.declared",
  status_changed: "incident.status",
  role_assigned: "incident.role_assigned",
  task_assigned: "incident.task_assigned",
  task_acknowledged: "incident.task_activity",
  task_status_changed: "incident.task_activity",
  task_commented: "incident.task_activity",
  task_attachment_added: "incident.task_activity",
  mention: "incident.mention",
  evidence_added: "incident.evidence_decisions",
  decision_made: "incident.evidence_decisions",
  note_added: "incident.collaboration",
  participant_added: "incident.collaboration",
  participant_removed: "incident.collaboration",
};
