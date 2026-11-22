// Who is asking, and what may they do in this exercise. Route handlers call
// these; the decisions themselves live in src/runtime/view.ts (viewerFor).
//
//   const principal = await requestPrincipal(req, { allowGuest: true });   // 401 if none
//   const { participant, viewer } = await requireAccess(id, principal, "driver");  // 403 if not

import { db } from "@/lib/db";
import { resolvePrincipal, type Principal as AuthPrincipal } from "@/lib/exercise/auth/guest";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { actingParticipant, AccessError, type Principal } from "@/lib/exercise/runtime/view";
import { CONTROL_ROLES, type ParticipantRow, type Viewer } from "@/lib/exercise/runtime/types";

export type { Principal };

/** Convert the auth-layer principal into the runtime's Principal. */
export function toRuntimePrincipal(p: AuthPrincipal): Principal {
  if (p.kind === "user") return { kind: "user", userId: p.user.id, accountRole: p.user.role };
  return { kind: "guest", exerciseId: p.exerciseId, participantId: p.participantId };
}

/** The caller as a runtime principal. Guests only when allowGuest. Throws AccessError(401). */
export async function requestPrincipal(
  req: Request,
  opts: { allowGuest: boolean },
): Promise<Principal> {
  if (!opts.allowGuest) {
    const user = await getSessionUser();
    if (!user) throw new AccessError(401, "Sign in to continue.");
    return { kind: "user", userId: user.id, accountRole: user.role };
  }
  const p = await resolvePrincipal(req);
  if (!p) throw new AccessError(401, "Sign in to continue.");
  return toRuntimePrincipal(p);
}

export type AccessNeed = "any" | "control" | "driver" | "participant";

const DENIED: Record<Exclude<AccessNeed, "any">, string> = {
  control: "Only the control team can do this.",
  driver: "Only a facilitator or controller can do this.",
  participant: "Join the exercise first.",
};

/**
 * Resolve the viewer and check the need. "participant" means the caller has
 * a live Participant row (needed to post chat or respond).
 */
export async function requireAccess(
  exerciseId: string,
  principal: Principal,
  need: AccessNeed = "any",
): Promise<{ participant: ParticipantRow | null; viewer: Viewer }> {
  const res = await actingParticipant(exerciseId, principal);
  if (need === "control" && !res.viewer.isControl) throw new AccessError(403, DENIED.control);
  if (need === "driver" && !res.viewer.isDriver) throw new AccessError(403, DENIED.driver);
  if (need === "participant" && !res.participant) throw new AccessError(403, DENIED.participant);
  return res;
}

/** Actor for engine calls. */
export function actorOf(principal: Principal, participant: ParticipantRow | null): { userId: string | null; participantId: string | null } {
  return { userId: principal.kind === "user" ? principal.userId : null, participantId: participant?.id ?? null };
}

/**
 * May this user read a template's hidden content (quality tables, expected
 * actions, secrets)? No when they hold a non-control seat in a lobby, live or
 * paused exercise that runs this template: a player must not read ahead.
 * Template GET and export routes call this after their own role checks and
 * answer 403 when it returns false.
 */
export async function canReadTemplateSecrets(userId: string, templateId: string): Promise<boolean> {
  const seats = await db.participant.findMany({
    where: {
      userId,
      removedAt: null,
      exercise: { templateId, status: { in: ["lobby", "live", "paused"] } },
    },
    select: { roles: true },
  });
  return seats.every((s) => s.roles.some((r) => (CONTROL_ROLES as readonly string[]).includes(r)));
}
