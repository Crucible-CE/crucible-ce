// Internal response SLAs (distinct from statutory notification deadlines). Org admins
// configure a severity x milestone matrix of target durations; we compute live
// status against incident timestamps for the command hub + metrics.
import { db } from "@/lib/db";

export const SLA_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const SLA_MILESTONES = ["ack", "contain", "resolve", "first_update"] as const;
export type SlaSeverity = (typeof SLA_SEVERITIES)[number];
export type SlaMilestone = (typeof SLA_MILESTONES)[number];

export const MILESTONE_LABELS: Record<SlaMilestone, string> = {
  ack: "Acknowledge",
  contain: "Contain",
  resolve: "Resolve",
  first_update: "First stakeholder update",
};

// Industry-standard defaults (minutes). 0 = not tracked for that cell.
export const DEFAULT_SLA: Record<SlaSeverity, Record<SlaMilestone, number>> = {
  critical: { ack: 15, contain: 240, resolve: 1440, first_update: 60 },
  high: { ack: 30, contain: 480, resolve: 4320, first_update: 240 },
  medium: { ack: 240, contain: 1440, resolve: 7200, first_update: 1440 },
  low: { ack: 1440, contain: 4320, resolve: 14400, first_update: 0 },
};

export type SlaMatrix = Record<string, Record<string, number>>;

// Effective matrix = configured rows overlaid on the defaults.
export async function getOrgSlaMatrix(organizationId: string): Promise<SlaMatrix> {
  const rows = await db.orgIncidentSla.findMany({ where: { organizationId } });
  const matrix: SlaMatrix = JSON.parse(JSON.stringify(DEFAULT_SLA));
  for (const r of rows) {
    if (matrix[r.severity]) matrix[r.severity][r.milestone] = r.targetMinutes;
  }
  return matrix;
}

export type SlaState = "on_track" | "at_risk" | "breached" | "met" | "met_late" | "pending" | "not_tracked";

export interface SlaStatus {
  milestone: SlaMilestone;
  label: string;
  targetMinutes: number;
  deadline: string | null;
  completedAt: string | null;
  state: SlaState;
  remainingMinutes: number | null; // negative = overdue
}

// Compute SLA status for one incident. `ts` carries the milestone completion
// timestamps the caller resolves (acknowledge/contain/resolve/first update).
export function computeSlaStatuses(
  severity: string,
  createdAt: Date,
  declaredAt: Date | null,
  ts: { ack: Date | null; contain: Date | null; resolve: Date | null; first_update: Date | null },
  matrix: SlaMatrix,
  now: Date = new Date(),
): SlaStatus[] {
  const targets = matrix[severity] ?? DEFAULT_SLA.medium;
  // The clock starts at declaration where present, else creation. Acknowledge is
  // always measured from creation (how fast did we engage?).
  const baseStart = declaredAt ?? createdAt;

  return SLA_MILESTONES.map((m) => {
    const targetMinutes = targets[m] ?? 0;
    const start = m === "ack" ? createdAt : baseStart;
    const completedAt = ts[m];
    if (targetMinutes <= 0) {
      return { milestone: m, label: MILESTONE_LABELS[m], targetMinutes, deadline: null, completedAt: completedAt?.toISOString() ?? null, state: "not_tracked", remainingMinutes: null };
    }
    const deadline = new Date(start.getTime() + targetMinutes * 60_000);
    let state: SlaState;
    let remainingMinutes: number | null;
    if (completedAt) {
      state = completedAt.getTime() <= deadline.getTime() ? "met" : "met_late";
      remainingMinutes = null;
    } else {
      const remMs = deadline.getTime() - now.getTime();
      remainingMinutes = Math.round(remMs / 60_000);
      if (remMs < 0) state = "breached";
      else if (remMs < targetMinutes * 60_000 * 0.25) state = "at_risk";
      else state = "on_track";
    }
    return { milestone: m, label: MILESTONE_LABELS[m], targetMinutes, deadline: deadline.toISOString(), completedAt: completedAt?.toISOString() ?? null, state, remainingMinutes };
  });
}

/**
 * Milestone completion timestamps for {@link computeSlaStatuses}, from the
 * incident row plus the two related facts: when the first incident commander
 * was assigned and when the first status update went out. Acknowledged =
 * earliest of formal declaration or first IC assignment. Shared by the
 * per-incident SLA route and the Ops Room so the two can never disagree.
 */
export function slaMilestoneTimestamps(
  incident: { declaredAt: Date | null; containedAt: Date | null; resolvedAt: Date | null; closedAt: Date | null },
  icAssignedAt: Date | null,
  firstUpdateAt: Date | null,
): { ack: Date | null; contain: Date | null; resolve: Date | null; first_update: Date | null } {
  const ackCandidates = [incident.declaredAt, icAssignedAt].filter((d): d is Date => !!d);
  const ack = ackCandidates.length ? new Date(Math.min(...ackCandidates.map((d) => d.getTime()))) : null;
  return {
    ack,
    contain: incident.containedAt,
    resolve: incident.resolvedAt ?? incident.closedAt,
    first_update: firstUpdateAt,
  };
}
