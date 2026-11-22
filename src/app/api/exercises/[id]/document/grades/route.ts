// GET  /api/exercises/{id}/document/grades   entry grades and rubric criteria (control)
// POST /api/exercises/{id}/document/grades   {responseId, score 0-4, rating, rationale} evaluator grade (control)
// Grades Playbook Exercise entries and Crisis Sim written deliverables. A change is a new Grade row.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { addHumanGrade, gradeDetails, humanGradeSchema } from "@/lib/exercise/grading/human";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const { id } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    await requireAccess(id, principal, "control");
    return NextResponse.json(await gradeDetails(id), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const { id } = await ctx.params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "control");
    const parsed = await parseJsonBody(req, humanGradeSchema);
    if (!parsed.ok) return parsed.response;
    const actor = actorOf(principal, participant);
    const grade = await addHumanGrade(id, parsed.data, actor.userId);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "grade.recorded",
      targetType: "Response",
      targetId: parsed.data.responseId,
      data: { exerciseId: id, gradeId: grade.id, score: parsed.data.score, rating: parsed.data.rating },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ id: grade.id }, { status: 201 });
  });
}
