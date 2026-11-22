// POST /api/action-items/afis   {aarId, afiId, action: "reject" | "no_action" | "reopen" | "carry", preset?, reason?, reference?}
//   reject:    reject the finding with a reason (out of the report, in the appendix)
//   no_action: an accepted finding needs no action item, with a reason
//   reopen:    back to proposed
//   carry:     add the AFI as a suggested objective for the next exercise
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { assertPlanWrite, planUser } from "@/lib/exercise/improvement/access";
import { applyFindings, resolveAfi } from "@/lib/exercise/improvement/afis";
import { carryAfiToNextExercise } from "@/lib/exercise/improvement/carry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  aarId: z.string().min(1).max(40),
  afiId: z.string().min(1).max(40),
  action: z.enum(["reject", "no_action", "reopen", "carry"]),
  preset: z.string().max(40).nullable().optional(),
  reason: z.string().trim().max(1000, "Use 1000 characters or fewer.").optional(),
  reference: z.string().trim().max(300, "Use 300 characters or fewer.").optional(),
});

export async function POST(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const { aarId, afiId, action, reason, preset, reference } = parsed.data;
    const aar = await db.afterActionReport.findUnique({ where: { id: aarId }, select: { exerciseId: true, exercise: { select: { isPractice: true } } } });
    if (!aar) throw new ServiceError(404, "Report not found.");
    if (aar.exercise.isPractice) throw new ServiceError(409, "Practice exercises do not get an improvement plan.");
    const { participantId } = await assertPlanWrite(user, aar.exerciseId);
    if (action === "carry") {
      const s = await carryAfiToNextExercise(aarId, afiId);
      audit({ actorUserId: user.id, actorParticipantId: participantId, action: "afi.carried", targetType: "AfterActionReport", targetId: aarId, data: { afiId, suggestionId: s.id }, req });
      return NextResponse.json({ ok: true, suggestion: s });
    }
    if (action === "reject") {
      if (!reason && !preset) throw new ServiceError(400, "Give a reason for the rejection.");
      await applyFindings(aarId, { kind: "reject", ids: [afiId], preset: preset ?? null, reason: reason ?? "", reference: reference ?? "" }, user.id);
    } else if (action === "no_action") {
      await resolveAfi(aarId, afiId, { noAction: { preset: preset ?? null, reason: reason ?? "", reference: reference ?? "" } }, user.id);
    } else {
      await resolveAfi(aarId, afiId, { reopen: true }, user.id);
    }
    audit({
      actorUserId: user.id,
      actorParticipantId: participantId,
      action: action === "reject" ? "afi.rejected" : action === "no_action" ? "afi.no_action" : "afi.reopened",
      targetType: "AfterActionReport",
      targetId: aarId,
      data: { afiId, ...(preset ? { preset } : {}), ...(reason ? { reason } : {}), ...(reference ? { reference } : {}) },
      req,
    });
    return NextResponse.json({ ok: true });
  });
}
