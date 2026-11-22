// Who may read and change improvement plan rows.
//   Program-wide (the /action-items page, CSV export): facilitators and admins
//   (permission reports.view).
//   One exercise: its control team reads; its drivers (lead facilitator,
//   controller, owner) and admins change rows. A facilitator seated as a
//   player never writes that exercise's plan.
//   Own items: anyone whose account email is the item's POC email sees the
//   item on /action-items and changes its status and closure evidence. Not
//   its other fields, not a rejection, and not once it is rejected.

import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import { getSessionUser, type SessionUser } from "@/lib/exercise/auth/session";
import { AccessError } from "@/lib/exercise/runtime/view";
import { requireAccess } from "@/lib/exercise/access";

export async function planUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AccessError(401, "Sign in to continue.");
  return user;
}

export function isProgramUser(user: SessionUser): boolean {
  return hasPermission(user, "reports.view");
}

/** Read access: program users, or control for the given exercise. */
export async function assertPlanRead(user: SessionUser, exerciseId: string | null | undefined): Promise<void> {
  if (isProgramUser(user)) return;
  if (!exerciseId) throw new AccessError(403, "You do not have access to the improvement plan.");
  await requireAccess(exerciseId, { kind: "user", userId: user.id, accountRole: user.role }, "control");
}

export type PlanWriteScope = "plan" | "item";

/**
 * Write access.
 *   No exercise: program users.
 *   An exercise, scope "plan" (the default; AFI resolve, reject, reopen,
 *   carry and links from the report): its drivers and admins only.
 *   An exercise, scope "item" (action item fields and status from the
 *   program-wide list): also program users who hold no seat in the exercise.
 */
export async function assertPlanWrite(
  user: SessionUser,
  exerciseId: string | null | undefined,
  opts: { scope?: PlanWriteScope } = {},
): Promise<{ participantId: string | null }> {
  if (!exerciseId) {
    if (isProgramUser(user)) return { participantId: null };
    throw new AccessError(403, "You do not have access to the improvement plan.");
  }
  try {
    const { participant } = await requireAccess(exerciseId, { kind: "user", userId: user.id, accountRole: user.role }, "driver");
    return { participantId: participant?.id ?? null };
  } catch (e) {
    if (!(e instanceof AccessError) || e.status !== 403) throw e;
    if (opts.scope === "item" && isProgramUser(user)) {
      const seats = await db.participant.count({ where: { exerciseId, userId: user.id, removedAt: null } });
      if (seats === 0) return { participantId: null };
    }
    throw new AccessError(403, "Only a facilitator or controller of this exercise can change its improvement plan.");
  }
}

/** The user owns this work item: its POC email is their account email. */
export function ownsItem(user: Pick<SessionUser, "email">, item: { pocEmail: string | null }): boolean {
  const mine = user.email.trim().toLowerCase();
  return Boolean(mine) && item.pocEmail?.trim().toLowerCase() === mine;
}

/** Fields an owner may change on their own item. */
const OWNER_FIELDS: readonly string[] = ["status", "closureEvidence"];

/** Throws unless an owner with no plan write access asks only for status and closure evidence. */
export function assertOwnerUpdate(input: Record<string, unknown>, current: { status: string }): void {
  const keys = Object.keys(input).filter((k) => input[k] !== undefined);
  if (keys.some((k) => !OWNER_FIELDS.includes(k))) {
    throw new ServiceError(403, "You can change the status and closure evidence of your own work items.");
  }
  if (input.status === "rejected") throw new ServiceError(403, "Only the exercise team can reject a work item.");
  if (current.status === "rejected") throw new ServiceError(409, "This work item was rejected. Ask the exercise team to reopen it.");
}
