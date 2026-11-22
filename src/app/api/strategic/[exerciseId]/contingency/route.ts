// POST /api/strategic/{exerciseId}/contingency {title, narrativeMd, artifacts?, targetTeamIds[], questions?}
// Drivers only. Publishes a contingency inject when no inject is open or held (else 409).
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { contingencyInputSchema, publishContingency } from "@/lib/exercise/strategic/contingency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ exerciseId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const { exerciseId } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(exerciseId, principal, "driver");
    const parsed = await parseJsonBody(req, contingencyInputSchema);
    if (!parsed.ok) return parsed.response;
    const actor = actorOf(principal, participant);
    const { injectId } = await publishContingency(exerciseId, parsed.data, actor);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "inject.contingency",
      targetType: "Inject",
      targetId: injectId,
      data: { exerciseId, teams: parsed.data.targetTeamIds.length, questions: parsed.data.questions.length },
      req,
    });
    return NextResponse.json({ injectId }, { status: 201 });
  });
}
