// Central access control for incidents ("lock to specific parties").
//
// Default incidents are org-scoped: any org member with the right permission may
// see them. A *restricted* (locked) incident is hidden from the org at large.
// Strict lock rule (final): a locked incident is visible ONLY to
//   - its participants (the allowlist),
//   - org ADMINISTRATORS (who also edit it, lib/incident/lock), and
//   - the incident commander (who also edits it).
// The reporter and assignee get NO implicit access: they are auto-added as
// ordinary, removable participants at creation, on assignment and at the
// moment of locking (lib/incident/participants), so the allowlist is the
// single source of truth and anyone on it can be taken off it.
//
// Soft-deleted incidents (deletedAt set, admin-only delete) are invisible to
// everyone through these helpers.
//
// EVERY incident route and every place that lists incidents must funnel through
// here so a privileged incident (insider-threat, exec, legal-privileged) never
// leaks via an unguarded endpoint, the list, search, sockets, or paging.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { isLockExemptAdmin } from "./lock-shared";

export interface AccessUser {
  id: string;
  organizationId?: string | null;
  role?: string | null;
}

export interface GateFields {
  organizationId: string;
  restricted: boolean;
  reportedById?: string;
  assignedToId?: string | null;
  deletedAt?: Date | null;
}

/**
 * The pure access decision given the gate fields + whether the user is a
 * participant (or the incident commander). Exported for unit testing; routes
 * go through {@link findAccessibleIncident}.
 *
 * Locked incident, same org:
 *   administrator       -> sees (and edits)
 *   incident commander  -> sees (and edits)
 *   participant         -> sees, read-only
 *   anyone else (incl. a reporter/assignee removed from the allowlist) -> hidden
 */
export function decideIncidentAccess(
  user: AccessUser,
  incident: GateFields,
  isParticipant: boolean,
  isIncidentCommander = false,
): boolean {
  if (incident.organizationId !== user.organizationId) return false;
  if (incident.deletedAt) return false;
  if (!incident.restricted) return true;
  if (isLockExemptAdmin(user) || isIncidentCommander) return true;
  return isParticipant;
}

/**
 * Load an incident only if `user` may access it, applying the restricted gate.
 * Returns null for both "not found" and "not allowed" so callers respond with a
 * uniform 404 and never reveal the existence of a restricted incident.
 *
 * Pass the `select` your route needs; gate fields are merged in automatically.
 */
export async function findAccessibleIncident<T extends Prisma.IncidentSelect>(
  user: AccessUser,
  incidentId: string,
  select: T,
): Promise<Prisma.IncidentGetPayload<{ select: T }> | null> {
  // Widen to Prisma.IncidentSelect so the generic `T` doesn't collide with
  // Prisma's structural select type when merged with the gate fields.
  const mergedSelect: Prisma.IncidentSelect = {
    ...select,
    organizationId: true,
    restricted: true,
    reportedById: true,
    assignedToId: true,
    deletedAt: true,
    participants: { where: { userId: user.id }, select: { id: true } },
    roleAssignments: {
      where: { role: "incident_commander", userId: user.id },
      select: { id: true },
    },
  };
  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    select: mergedSelect,
  });
  if (!incident) return null;

  const gate = incident as unknown as GateFields & {
    participants?: { id: string }[];
    roleAssignments?: { id: string }[];
  };
  const isParticipant = (gate.participants?.length ?? 0) > 0;
  const isIc = (gate.roleAssignments?.length ?? 0) > 0;
  if (!decideIncidentAccess(user, gate, isParticipant, isIc)) return null;

  return incident as unknown as Prisma.IncidentGetPayload<{ select: T }>;
}

/**
 * A `where` fragment that limits `incident.findMany`/`count` to the incidents the
 * user may see. Use this anywhere incidents are listed, searched, or counted so
 * restricted (and soft-deleted) incidents stay out of org-wide views.
 */
export function accessibleIncidentsWhere(user: AccessUser, opts: { excludeTraining?: boolean } = {}): Prisma.IncidentWhereInput {
  const organizationId = user.organizationId ?? "__no_org__";
  // Lists, counts, metrics and reports pass excludeTraining: a training
  // incident (lib/incident/training) is reached only by its own link.
  const training = opts.excludeTraining ? { isTraining: false } : {};
  if (isLockExemptAdmin(user)) return { organizationId, deletedAt: null, ...training };
  return {
    organizationId,
    deletedAt: null,
    ...training,
    OR: [
      { restricted: false },
      { participants: { some: { userId: user.id } } },
      { roleAssignments: { some: { role: "incident_commander", userId: user.id } } },
    ],
  };
}

/**
 * Can this org member see the incident (same rule as {@link findAccessibleIncident})?
 * Used where someone ELSE is pulled in (paging, escalation) to decide whether
 * their page must be REDACTED (lib/delivery/redaction).
 */
export async function canUserSeeIncident(userId: string, incidentId: string): Promise<boolean> {
  const [user, incident] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, organizationId: true, role: true, isActive: true } }),
    db.incident.findUnique({
      where: { id: incidentId },
      select: {
        organizationId: true,
        restricted: true,
        deletedAt: true,
        participants: { where: { userId }, select: { id: true } },
        roleAssignments: { where: { role: "incident_commander", userId }, select: { id: true } },
      },
    }),
  ]);
  if (!user || !user.isActive || !incident) return false;
  return decideIncidentAccess(
    user,
    incident,
    (incident.participants?.length ?? 0) > 0,
    (incident.roleAssignments?.length ?? 0) > 0,
  );
}
