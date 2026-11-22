// GET  /api/exercises/{id}/ratings   control: {objectives:[{current, ai, history}], capabilities, canRate}
// POST /api/exercises/{id}/ratings   evaluator or lead facilitator, after ENDEX: {objectiveId, rating: P|S|M|U|not_evaluated, rationale, capabilityId?}
// Refused while the latest report is in review or final.
// Append-only; the latest evaluator rating for an objective wins.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { addRating, canRate, listRatings, ratingInputSchema } from "@/lib/exercise/hotwash/ratings";
import { ratingsClosedReason } from "@/lib/exercise/aar/ratings-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    const [data, ex, closedReason] = await Promise.all([listRatings(id), db.exercise.findUnique({ where: { id }, select: { status: true } }), ratingsClosedReason(id)]);
    return NextResponse.json(
      { ...data, closedReason, canRate: ex?.status === "ended" && !closedReason && canRate(a.viewer, a.participant, a.isOwnerOrAdmin) },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    if (!canRate(a.viewer, a.participant, a.isOwnerOrAdmin)) throw new AccessError(403, "Only evaluators and the lead facilitator can rate objectives.");
    const parsed = await parseJsonBody(req, ratingInputSchema);
    if (!parsed.ok) return parsed.response;
    const ratingId = await addRating(id, a.user.id, parsed.data);
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "rating.added",
      targetType: "Exercise",
      targetId: id,
      data: { ratingId, objectiveId: parsed.data.objectiveId, rating: parsed.data.rating },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ id: ratingId }, { status: 201 });
  });
}
