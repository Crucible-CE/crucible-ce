// POST /api/exercises/{id}/aar/findings   {action, ...}
//   accept {ids, objectiveId?}                     proposed to accepted (in the report)
//   reject {ids, preset?, reason?, reference?}     to rejected (appendix), reason required
//   no_action {ids, preset?, reason?, reference?}  accepted with no action item, reason required
//   reopen {ids}                                   back to proposed
//   merge {primaryId, secondaryId}                 two proposed findings become one
//   add {objectiveId, title, ...}                  a finding an evaluator writes (proposed)
//   collect                                        propose findings from the record
// Writing a finding needs the control team. Decisions need a driver. Every change is audited.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller } from "@/lib/exercise/aar/http";
import { findingsAction, findingsActionSchema, type FindingsActionInput } from "@/lib/exercise/aar/findings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function detailOf(input: FindingsActionInput, proposed: number | undefined): Record<string, unknown> {
  switch (input.action) {
    case "reject":
    case "no_action":
      return { preset: input.preset ?? null, reason: input.reason ?? "", reference: input.reference ?? "" };
    case "accept":
      return { objectiveId: input.objectiveId ?? null };
    case "merge":
      return { primaryId: input.primaryId, secondaryId: input.secondaryId };
    case "collect":
      return { proposed: proposed ?? 0 };
    default:
      return {};
  }
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const parsed = await parseJsonBody(req, findingsActionSchema);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;
    const caller = await aarCaller(req, id, input.action === "add" || input.action === "collect" ? "control" : "driver");
    const res = await findingsAction(id, input, caller.userId);
    const detail = detailOf(input, res.proposed);
    const events = res.changed.length ? res.changed : input.action === "collect" ? [null] : [];
    for (const c of events) {
      audit({
        actorUserId: caller.actor.userId,
        actorParticipantId: caller.actor.participantId,
        action: `aar.finding_${input.action}`,
        targetType: "AfterActionReport",
        targetId: res.aarId,
        data: { ...(c ? { afiId: c.afiId, status: c.status, decision: c.decision } : {}), ...detail },
        req,
      });
    }
    return NextResponse.json({ ok: true, changed: res.changed, proposed: res.proposed ?? null });
  });
}
