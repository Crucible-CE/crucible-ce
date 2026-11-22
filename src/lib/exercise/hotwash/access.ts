// Access for after-action routes (hotwash, ratings, feedback summary, AAR
// sign-off and exports). Signed-in users only; guests never reach these.

import { db } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/exercise/auth/session";
import { managesAllExercises } from "@/lib/exercise/auth/rbac";
import { AccessError } from "@/lib/exercise/runtime/view";
import type { ParticipantRow, Viewer } from "@/lib/exercise/runtime/types";
import { requireAccess, type AccessNeed } from "@/lib/exercise/access";

export interface UserAccess {
  user: SessionUser;
  participant: ParticipantRow | null;
  viewer: Viewer;
  /** Exercise owner, administrator or exercise director. */
  isOwnerOrAdmin: boolean;
}

export async function userAccess(exerciseId: string, need: AccessNeed): Promise<UserAccess> {
  const user = await getSessionUser();
  if (!user) throw new AccessError(401, "Sign in to continue.");
  const { participant, viewer } = await requireAccess(exerciseId, { kind: "user", userId: user.id, accountRole: user.role }, need);
  let isOwnerOrAdmin = managesAllExercises(user.role);
  if (!isOwnerOrAdmin) {
    const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { createdById: true } });
    isOwnerOrAdmin = ex?.createdById === user.id;
  }
  return { user, participant, viewer, isOwnerOrAdmin };
}
