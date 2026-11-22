// PATCH /api/action-items/{itemId}   any IP field. After the report version is
// final, only status, closure evidence and rejection reason change (live tracking).
// The item's owner (POC email = their account email) with no plan write
// access changes status and closure evidence only.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { AccessError } from "@/lib/exercise/runtime/view";
import { assertOwnerUpdate, assertPlanWrite, ownsItem, planUser } from "@/lib/exercise/improvement/access";
import { actionItemUpdateSchema, updateActionItem } from "@/lib/exercise/improvement/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  return withErrors(async () => {
    const { itemId } = await params;
    const user = await planUser();
    const row = await db.actionItem.findUnique({ where: { id: itemId }, select: { exerciseId: true, pocEmail: true, status: true } });
    if (!row) throw new ServiceError(404, "Work item not found.");
    let participantId: string | null = null;
    let asOwner = false;
    try {
      ({ participantId } = await assertPlanWrite(user, row.exerciseId, { scope: "item" }));
    } catch (e) {
      if (!(e instanceof AccessError) || e.status !== 403 || !ownsItem(user, row)) throw e;
      asOwner = true;
    }
    const parsed = await parseJsonBody(req, actionItemUpdateSchema);
    if (!parsed.ok) return parsed.response;
    if (asOwner) assertOwnerUpdate(parsed.data, row);
    const res = await updateActionItem(itemId, parsed.data);
    if (res.changed.length) {
      audit({
        actorUserId: user.id,
        actorParticipantId: participantId,
        action: "action_item.updated",
        targetType: "ActionItem",
        targetId: itemId,
        data: JSON.parse(JSON.stringify({ changed: res.changed, before: res.before, ...(asOwner ? { asOwner: true } : {}) })),
        req,
      });
    }
    return NextResponse.json({ ok: true, changed: res.changed });
  });
}
