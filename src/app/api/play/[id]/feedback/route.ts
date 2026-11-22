// GET /api/play/{id}/feedback   participant (user or guest): {exercise, feedback, closedReason, scales}
// PUT /api/play/{id}/feedback   participant: save the HSEEP feedback form (one per participant, editable until the AAR is final)
// Guests are scoped by their cookie to their own exercise and participant row.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { FEEDBACK_SCALES, feedbackClosedReason, feedbackInputSchema, getFeedback, saveFeedback } from "@/lib/exercise/hotwash/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { participant } = await requireAccess(id, principal, "participant");
    const [exercise, feedback, closedReason] = await Promise.all([
      db.exercise.findUnique({ where: { id }, select: { id: true, title: true, status: true } }),
      getFeedback(id, participant!.id),
      feedbackClosedReason(id),
    ]);
    return NextResponse.json({ exercise, feedback, closedReason, scales: FEEDBACK_SCALES }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { participant } = await requireAccess(id, principal, "participant");
    const parsed = await parseJsonBody(req, feedbackInputSchema);
    if (!parsed.ok) return parsed.response;
    const res = await saveFeedback(id, participant!.id, parsed.data);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: res.created ? "feedback.submitted" : "feedback.updated",
      targetType: "Exercise",
      targetId: id,
      req,
    });
    return NextResponse.json({ ok: true, created: res.created });
  });
}
