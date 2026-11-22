// Access for AAR routes: signed-in users only (never guests), control team
// to read and edit, drivers for status changes and deletions.

import { actorOf, requestPrincipal, requireAccess, type Principal } from "@/lib/exercise/access";

export interface AarCaller {
  principal: Principal;
  userId: string | null;
  actor: { userId: string | null; participantId: string | null };
  isDriver: boolean;
}

export async function aarCaller(req: Request, exerciseId: string, need: "control" | "driver" = "control"): Promise<AarCaller> {
  const principal = await requestPrincipal(req, { allowGuest: false });
  const { participant, viewer } = await requireAccess(exerciseId, principal, need);
  return {
    principal,
    userId: principal.kind === "user" ? principal.userId : null,
    actor: actorOf(principal, participant),
    isDriver: viewer.isDriver,
  };
}

export const NO_STORE = { "Cache-Control": "no-store" } as const;
