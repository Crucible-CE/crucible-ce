// Client-safe half of the incident lock semantics (no server imports): the
// constants and pure decisions shared by API routes and UI. See ./lock.ts for
// the rationale and the route guard.

export const INCIDENT_LOCKED_CODE = "incident_locked";
export const INCIDENT_LOCKED_ERROR = "Incident is locked";
export const INCIDENT_LOCKED_MESSAGE =
  "Locked. Only the incident commander or an Org admin can edit it.";

export interface LockUser {
  id?: string | null;
  role?: string | null;
}

/** Org administrators are exempt from the lock (visibility and read-only). */
export function isLockExemptAdmin(user: LockUser): boolean {
  return user.role === "administrator";
}

/**
 * Pure decision: may `user` write to an incident with this lock state?
 * Unlocked incidents are always writable (permission checks still apply).
 * Locked incidents are writable only by the incident commander and admins.
 */
export function canWriteLockedIncident(
  user: LockUser,
  incident: { restricted: boolean },
  isIncidentCommander: boolean,
): boolean {
  if (!incident.restricted) return true;
  if (isLockExemptAdmin(user)) return true;
  return isIncidentCommander;
}

/**
 * Pure decision: may `user` lock the incident or change its participant
 * allowlist? On a LOCKED incident only the IC and admins may (the lock is
 * read-only for everyone else, the reporter included). On an UNLOCKED incident
 * the reporter, the IC, and admins may lock it / pre-stage participants.
 * UNLOCKING is narrower — see {@link canUnlockIncident}.
 */
export function canManageLock(
  user: LockUser,
  incident: { restricted: boolean; reportedById: string },
  isIncidentCommander: boolean,
): boolean {
  if (isLockExemptAdmin(user) || isIncidentCommander) return true;
  if (incident.restricted) return false;
  return !!user.id && incident.reportedById === user.id;
}

/**
 * Pure decision (M7): may `user` UNLOCK a locked incident? Administrators
 * always may. Otherwise only the incident commander who held the seat AT LOCK
 * TIME (captured in `Incident.lockedIcUserId`) and still holds it — a later IC
 * may run the response and manage the allowlist, but not lift the lock.
 * An incident locked before the capture existed (lockedIcUserId null) is
 * admin-only to unlock.
 */
export function canUnlockIncident(
  user: LockUser,
  incident: { restricted: boolean; lockedIcUserId?: string | null },
  isCurrentIncidentCommander: boolean,
): boolean {
  if (!incident.restricted) return false;
  if (isLockExemptAdmin(user)) return true;
  return (
    isCurrentIncidentCommander &&
    !!user.id &&
    !!incident.lockedIcUserId &&
    incident.lockedIcUserId === user.id
  );
}

/**
 * Pure decision (M7): may `user` assign/clear the incident-commander seat?
 * The IC seat carries lock exemption, so:
 *   - EMPTY seat    -> only the reporter or an administrator may fill it;
 *   - OCCUPIED seat -> the current IC, the reporter, or an administrator.
 */
export function canAssignIncidentCommander(
  user: LockUser,
  incident: { reportedById: string },
  seat: { occupied: boolean; currentIcUserId?: string | null },
): boolean {
  if (isLockExemptAdmin(user)) return true;
  if (!user.id) return false;
  if (incident.reportedById === user.id) return true;
  return seat.occupied && !!seat.currentIcUserId && seat.currentIcUserId === user.id;
}

/** Does an API error body indicate the read-only lock? */
export function isIncidentLockedError(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    (body as { code?: unknown }).code === INCIDENT_LOCKED_CODE
  );
}

/**
 * Pull a user-facing message out of a failed API response body, preferring the
 * lock message so every write surface explains a locked incident the same way.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (isIncidentLockedError(body)) return INCIDENT_LOCKED_MESSAGE;
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.error === "string" && b.error) return b.error;
  }
  return fallback;
}
