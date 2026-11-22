// GET  /api/strategic/{exerciseId}/grades   evaluator grades on team answers (control)
// POST /api/strategic/{exerciseId}/grades   {responseId, score 0-4, rating, rationale} evaluator grade (control)
// A change is a new Grade row with source 'human'. The latest one counts.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { addHumanGrade, gradeDetails, humanGradeSchema } from "@/lib/exercise/strategic/grades";
import { checkWinCondition } from "@/lib/exercise/strategic/win";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ exerciseId: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const { exerciseId } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(exerciseId, principal, "control");
    return NextResponse.json(await gradeDetails(exerciseId), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const { exerciseId } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(exerciseId, principal, "control");
    const parsed = await parseJsonBody(req, humanGradeSchema);
    if (!parsed.ok) return parsed.response;
    const actor = actorOf(principal, participant);
    const grade = await addHumanGrade(exerciseId, parsed.data, actor.userId);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "grade.recorded",
      targetType: "Response",
      targetId: parsed.data.responseId,
      data: { exerciseId, gradeId: grade.id, score: parsed.data.score, rating: parsed.data.rating },
      req,
    });
    notifyChanged(exerciseId, grade.version, "control");
    await checkWinCondition(exerciseId).catch((e) => console.error("[strategic] win check failed:", e));
    return NextResponse.json({ id: grade.id }, { status: 201 });
  });
}
