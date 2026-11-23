// Incident lock (`Incident.restricted`) semantics.
//
// A locked incident has TWO effects:
//   1. Visibility: only named participants can see it — enforced by
//      `@/lib/incident/access`. The incident commander and org administrators
//      are exempt and always see it. The reporter and assignee have NO
//      implicit access: they are auto-enrolled as ordinary, removable
//      participants at creation, on assignment and at lock time
//      (`@/lib/incident/participants`), so nobody locks themselves out but
//      the allowlist stays the single source of truth.
//   2. Read-only: those who can see it may NOT change it — EXCEPT the incident
//      commander (IncidentRoleAssignment role "incident_commander") and org
//      administrators, who keep full edit rights so the response can still run.
//
// Locking captures the seated IC in `Incident.lockedIcUserId` (+ `lockedAt`).
// Unlocking is administrators, or that same IC while still seated (M7).
//
// EVERY incident write route funnels its lock check through
// {@link assertIncidentWritable} so the exemption can't drift between
// surfaces. Call it AFTER the route's own access check (404) — it does not
// itself hide existence.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOT_DELETED } from "@/lib/incident/live";
import {
  INCIDENT_LOCKED_CODE,
  INCIDENT_LOCKED_ERROR,
  INCIDENT_LOCKED_MESSAGE,
  canManageLock,
  canUnlockIncident,
  canWriteLockedIncident,
  type LockUser,
} from "./lock-shared";

export {
  INCIDENT_LOCKED_CODE,
  INCIDENT_LOCKED_MESSAGE,
  canAssignIncidentCommander,
  canUnlockIncident,
  canWriteLockedIncident,
  isLockExemptAdmin,
  type LockUser,
} from "./lock-shared";

/** The uniform 403 response for a write blocked by the lock. */
export function incidentLockedResponse(): NextResponse {
  return NextResponse.json(
    { error: INCIDENT_LOCKED_ERROR, code: INCIDENT_LOCKED_CODE, message: INCIDENT_LOCKED_MESSAGE },
    { status: 403 },
  );
}

async function isIncidentCommander(userId: string | null | undefined, incidentId: string): Promise<boolean> {
  if (!userId) return false;
  const ic = await db.incidentRoleAssignment.findFirst({
    where: { incidentId, role: "incident_commander", userId },
    select: { id: true },
  });
  return !!ic;
}

/**
 * Is this incident read-only for `user` because of the lock? False when the
 * incident is unlocked, doesn't exist (the caller's access check owns the
 * 404), or `user` is its incident commander or an org admin. Pass
 * `restricted` when already loaded to skip the extra read.
 */
export async function isIncidentReadOnlyFor(
  user: LockUser,
  incident: { id: string; restricted?: boolean | null },
): Promise<boolean> {
  let restricted = incident.restricted;
  if (restricted === undefined || restricted === null) {
    const row = await db.incident.findUnique({ where: { id: incident.id }, select: { restricted: true } });
    if (!row) return false;
    restricted = row.restricted;
  }
  if (canWriteLockedIncident(user, { restricted }, false)) return false;
  const ic = await isIncidentCommander(user.id, incident.id);
  return !canWriteLockedIncident(user, { restricted }, ic);
}

/**
 * Route guard: returns the 403 `incident_locked` response when the incident is
 * locked and `user` is neither its incident commander nor an org admin;
 * otherwise null. Call it AFTER the route's access check.
 *
 *   const locked = await assertIncidentWritable(session.user, incident);
 *   if (locked) return locked;
 */
export async function assertIncidentWritable(
  user: LockUser,
  incident: { id: string; restricted?: boolean | null },
): Promise<NextResponse | null> {
  return (await isIncidentReadOnlyFor(user, incident)) ? incidentLockedResponse() : null;
}

/**
 * May `user` toggle the lock or change the participant allowlist? See
 * {@link canManageLock}: IC + admins always; the reporter only while unlocked.
 */
export async function canManageIncidentLock(
  user: LockUser & { organizationId?: string | null },
  incidentId: string,
): Promise<boolean> {
  const incident = await db.incident.findUnique({
    where: { id: incidentId, ...NOT_DELETED },
    select: { organizationId: true, restricted: true, reportedById: true },
  });
  if (!incident || incident.organizationId !== user.organizationId) return false;
  const ic = await isIncidentCommander(user.id, incidentId);
  return canManageLock(user, incident, ic);
}

/**
 * May `user` unlock this (locked) incident? See {@link canUnlockIncident}:
 * administrators, or the IC captured at lock time while still seated.
 */
export async function canUnlockIncidentFor(
  user: LockUser & { organizationId?: string | null },
  incidentId: string,
): Promise<boolean> {
  const incident = await db.incident.findUnique({
    where: { id: incidentId, ...NOT_DELETED },
    select: { organizationId: true, restricted: true, lockedIcUserId: true },
  });
  if (!incident || incident.organizationId !== user.organizationId) return false;
  const ic = await isIncidentCommander(user.id, incidentId);
  return canUnlockIncident(user, incident, ic);
}
