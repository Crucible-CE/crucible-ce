// GET   /api/exercises/{id}   setup record for the lobby editor (control)
// PATCH /api/exercises/{id}   lobby edits (driver; draft or lobby only)
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { requestPrincipal, requireAccess, actorOf } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { loadSetup, updateExercise } from "@/lib/exercise/lobby";
import { updateExerciseSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { viewer } = await requireAccess(id, principal, "control");
    const setup = await loadSetup(id, { includeJoinCode: viewer.isDriver });
    return NextResponse.json(setup, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, updateExerciseSchema);
    if (!parsed.ok) return parsed.response;
    const version = await updateExercise(id, parsed.data);
    const actor = actorOf(principal, participant);
    if (parsed.data.guestJoin !== undefined) {
      audit({
        actorUserId: actor.userId,
        actorParticipantId: actor.participantId,
        action: parsed.data.guestJoin ? "exercise.join_by_code_enabled" : "exercise.join_by_code_disabled",
        targetType: "Exercise",
        targetId: id,
        req,
      });
    }
    notifyChanged(id, version);
    return NextResponse.json({ ok: true });
  });
}
