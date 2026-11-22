// POST /api/exercises/{id}/join-code: rotate the join code (driver). Resets the failure count.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { rotateJoinCode } from "@/lib/exercise/lobby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const code = await rotateJoinCode(id);
    const actor = actorOf(principal, participant);
    audit({ actorUserId: actor.userId, actorParticipantId: actor.participantId, action: "exercise.join_code_rotated", targetType: "Exercise", targetId: id, req });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ code }, { headers: { "Cache-Control": "no-store" } });
  });
}
