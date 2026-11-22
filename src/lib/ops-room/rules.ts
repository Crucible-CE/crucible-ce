// Pure Ops Room rules shared by the loaders and the UI (no I/O, unit-tested):
// role labels, the member's roles on an incident, task due classification,
// active-incident ordering and escalation-contact statistics.

import { CONTACT_VERIFY_STALE_DAYS } from "@/lib/escalation/contact-fields";

/** Tasks due within this window count as "due soon". */
export const TASK_DUE_SOON_HOURS = 24;

export const ROLE_LABELS: Record<string, string> = {
  incident_commander: "Incident Commander",
  comms_lead: "Comms Lead",
  legal_lead: "Legal Lead",
  tech_lead: "Tech Lead",
  exec_sponsor: "Exec Sponsor",
  scribe: "Scribe",
  assignee: "Assignee",
};

export type TaskDue = "overdue" | "due_soon" | null;

/** Overdue, due within 24h, or neither (pure). */
export function classifyTaskDue(dueAt: Date | null, now: Date): TaskDue {
  if (!dueAt) return null;
  const ms = dueAt.getTime() - now.getTime();
  if (ms < 0) return "overdue";
  if (ms <= TASK_DUE_SOON_HOURS * 3_600_000) return "due_soon";
  return null;
}

/** The member's roles on an incident, command roles first, then "assignee" (pure). */
export function myRoles(roleAssignments: { role: string }[], assignedToMe: boolean): string[] {
  const order = Object.keys(ROLE_LABELS);
  const roles = [...new Set(roleAssignments.map((r) => r.role))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (assignedToMe && !roles.includes("assignee")) roles.push("assignee");
  return roles;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Most severe first, then newest (pure). */
export function sortActive<T extends { severity: string; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

// Escalation contact statistics

export interface ContactRow {
  tier: number;
  email: string | null;
  phone: string | null;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  allowUnverifiedPhone: boolean;
}

export interface ContactStats {
  total: number;
  tiers: number;
  withEmail: number;
  emailVerified: number;
  withPhone: number;
  /** Phones SMS/voice may dial: verified, or overridden by an administrator. */
  phoneVerified: number;
  /** Contacts with at least one verified channel. */
  verifiedAny: number;
  /** Contacts whose every channel that matters is verified (phone only counts with SMS configured). */
  fullyVerified: number;
  /** Contacts with a VERIFIED channel older than the re-verify threshold. */
  stale: number;
}

export function contactStats(rows: ContactRow[], opts: { sms: boolean; now?: Date }): ContactStats {
  const staleBefore = (opts.now ?? new Date()).getTime() - CONTACT_VERIFY_STALE_DAYS * 86_400_000;
  const s: ContactStats = { total: rows.length, tiers: new Set(rows.map((r) => r.tier)).size, withEmail: 0, emailVerified: 0, withPhone: 0, phoneVerified: 0, verifiedAny: 0, fullyVerified: 0, stale: 0 };
  for (const r of rows) {
    const emailOk = !!r.email && !!r.emailVerifiedAt;
    // Same rule as lib/delivery/phone-gate contactPhoneAllowed (that module
    // reads the database, so it is not imported into this client-safe file).
    const phoneOk = !!r.phone && (r.phoneVerifiedAt != null || r.allowUnverifiedPhone);
    if (r.email) s.withEmail += 1;
    if (emailOk) s.emailVerified += 1;
    if (r.phone) s.withPhone += 1;
    if (phoneOk) s.phoneVerified += 1;
    if (emailOk || (!!r.phone && !!r.phoneVerifiedAt)) s.verifiedAny += 1;
    const needsPhone = opts.sms && !!r.phone;
    const reachable = !!r.email || needsPhone;
    if (reachable && (!r.email || emailOk) && (!needsPhone || phoneOk)) s.fullyVerified += 1;
    const staleEmail = !!r.emailVerifiedAt && r.emailVerifiedAt.getTime() < staleBefore;
    const stalePhone = !!r.phoneVerifiedAt && r.phoneVerifiedAt.getTime() < staleBefore;
    if (staleEmail || stalePhone) s.stale += 1;
  }
  return s;
}
