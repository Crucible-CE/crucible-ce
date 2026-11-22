// Shared incident status-transition module (foundations §2.10).
//
// The status enum, transition side-effects (auto-timestamps, reopen clearing
// closure), and the ledger event classification were previously duplicated
// inline across the incident PATCH route, false-positive.ts, and mobile.
// Every surface that changes incident status derives its side-effects from
// here so the semantics can't drift.

import { z } from "zod";

export const INCIDENT_STATUSES = [
  "open",
  "investigating",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const incidentStatusSchema = z.enum(INCIDENT_STATUSES);

// Canonical semantics: `closed` is the ONLY terminal state. `recovered` =
// "remediated but not administratively closed" and counts as ACTIVE
// everywhere. This is the single source of truth for open/closed across the
// dashboard, admin metrics, and incident lists.

/** The one status that counts as formally closed (closure disposition applies). */
export function isClosedStatus(status: string): boolean {
  return status === "closed";
}

/** Prisma `where.status` fragment selecting ACTIVE (non-terminal) incidents. */
export const ACTIVE_STATUS_FILTER: { notIn: string[] } = { notIn: ["closed"] };

/** Lifecycle position (enum order = lifecycle order). -1 for unknown. */
export function statusRank(status: string): number {
  return INCIDENT_STATUSES.indexOf(status as IncidentStatus);
}

/** A transition out of closed back to any live status. */
export function isReopen(from: string, to: string): boolean {
  return isClosedStatus(from) && !isClosedStatus(to);
}

/** Ledger event type for a status transition. */
export function ledgerEventForTransition(
  from: string,
  to: string,
): "incident_reopened" | "incident_closed" | "status_changed" {
  if (isReopen(from, to)) return "incident_reopened";
  if (isClosedStatus(to)) return "incident_closed";
  return "status_changed";
}

/**
 * Incident-field side-effects of a status transition (canonical rules):
 * - first entry into "contained" stamps containedAt
 * - first entry into "recovered" OR "closed" stamps resolvedAt (the "no longer
 *   causing harm" moment — previously "recovered" stamped nothing)
 * - entry into "closed" stamps closedAt (previously the PATCH path NEVER set it,
 *   so PATCH-closed and false-positive-closed incidents populated different
 *   fields and readers had to coalesce resolvedAt ?? closedAt)
 * - reopening a closed incident clears the closure disposition + closedAt, AND
 *   clears resolvedAt when reopening to a PRE-recovered state (open/
 *   investigating/contained/eradicated) so MTTR isn't stale; reopening to
 *   "recovered" keeps resolvedAt
 *
 * Returns a partial update payload to spread into the incident update.
 */
export function statusTransitionSideEffects(
  existing: { status: string; containedAt: Date | null; resolvedAt: Date | null; closedAt?: Date | null },
  to: string | undefined,
  now: Date = new Date(),
): Record<string, unknown> {
  if (!to || to === existing.status) return {};
  const fields: Record<string, unknown> = {};
  if (to === "contained" && !existing.containedAt) fields.containedAt = now;
  if ((to === "recovered" || isClosedStatus(to)) && !existing.resolvedAt) fields.resolvedAt = now;
  if (isClosedStatus(to) && !existing.closedAt) fields.closedAt = now;
  if (isReopen(existing.status, to)) {
    fields.closureDisposition = null;
    fields.closureReason = null;
    fields.closureNote = null;
    fields.closedById = null;
    fields.closedAt = null;
    // Reopening below "recovered" invalidates the resolve timestamp.
    if (statusRank(to) < statusRank("recovered")) fields.resolvedAt = null;
  }
  return fields;
}
