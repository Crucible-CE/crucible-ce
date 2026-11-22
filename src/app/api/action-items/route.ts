// GET  /api/action-items?status=open|overdue|done|rejected|in_progress|all&exerciseId=&aarId=&capabilityId=&priority=&mine=1
//      program users see every row; others must filter to an exercise they control.
//      mine=1, or a reader with no exercise or report filter: the items the user owns (POC email).
// POST /api/action-items   create one row: {exerciseId?, aarId?, afiId?, capabilityId?, objectiveId?, afi, correctiveAction, poete?, ...}
//      With afiId, the AFI in that report is marked resolved in the same transaction.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { assertPlanRead, assertPlanWrite, isProgramUser, planUser } from "@/lib/exercise/improvement/access";
import { actionItemCreateSchema, createActionItem, filtersFromSearch, listActionItems } from "@/lib/exercise/improvement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    const params = new URL(req.url).searchParams;
    const filters = filtersFromSearch(params);
    let exerciseId = filters.exerciseId ?? null;
    if (!exerciseId && filters.aarId) {
      exerciseId = (await db.afterActionReport.findUnique({ where: { id: filters.aarId }, select: { exerciseId: true } }))?.exerciseId ?? null;
    }
    if (params.get("mine") === "1" || (!exerciseId && !filters.aarId && !isProgramUser(user))) {
      const items = await listActionItems({ ...filters, ownerEmail: user.email });
      return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
    }
    await assertPlanRead(user, exerciseId);
    const items = await listActionItems(filters);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return withErrors(async () => {
    const user = await planUser();
    const parsed = await parseJsonBody(req, actionItemCreateSchema);
    if (!parsed.ok) return parsed.response;
    let exerciseId = parsed.data.exerciseId ?? null;
    if (parsed.data.aarId) {
      exerciseId = (await db.afterActionReport.findUnique({ where: { id: parsed.data.aarId }, select: { exerciseId: true } }))?.exerciseId ?? exerciseId;
    }
    // Linking an AFI resolves it in the report: drivers and admins only.
    const { participantId } = await assertPlanWrite(user, exerciseId, { scope: parsed.data.afiId ? "plan" : "item" });
    const row = await createActionItem(parsed.data, user.id);
    audit({
      actorUserId: user.id,
      actorParticipantId: participantId,
      action: "action_item.created",
      targetType: "ActionItem",
      targetId: row.id,
      data: { exerciseId, aarId: parsed.data.aarId ?? null, afiId: parsed.data.afiId ?? null },
      req,
    });
    return NextResponse.json(row, { status: 201 });
  });
}
