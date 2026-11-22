// PATCH /api/exercises/{id}/document/entries/{responseId}   {status: confirmed | denied | submitted}
// Document TTX entry moderation. Control room only. Audited.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { entryStatusSchema, setEntryStatus } from "@/lib/exercise/grading/human";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; responseId: string }> }) {
  return withErrors(async () => {
    const { id, responseId } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "control");
    const parsed = await parseJsonBody(req, entryStatusSchema);
    if (!parsed.ok) return parsed.response;
    const { version, from } = await setEntryStatus(id, responseId, parsed.data.status);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: `entry.${parsed.data.status === "submitted" ? "reset" : parsed.data.status}`,
      targetType: "Response",
      targetId: responseId,
      data: { exerciseId: id, from, to: parsed.data.status },
      req,
    });
    notifyChanged(id, version);
    return NextResponse.json({ ok: true });
  });
}
