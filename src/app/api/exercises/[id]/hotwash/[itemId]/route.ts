// PATCH  /api/exercises/{id}/hotwash/{itemId}  {kind?, objectiveId?, text?}  own items (owner and admins: any)
// DELETE /api/exercises/{id}/hotwash/{itemId}  hard delete, audited with the text
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { deleteHotwashItem, hotwashUpdateSchema, updateHotwashItem } from "@/lib/exercise/hotwash/hotwash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

async function driver(id: string) {
  const a = await userAccess(id, "control");
  if (!a.viewer.isDriver) throw new AccessError(403, "Only a facilitator or controller can change hotwash items.");
  return a;
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id, itemId } = await params;
    const a = await driver(id);
    const parsed = await parseJsonBody(req, hotwashUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const res = await updateHotwashItem(id, itemId, { participantId: a.participant?.id ?? null, canModerate: a.isOwnerOrAdmin }, parsed.data);
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "hotwash.edited",
      targetType: "Exercise",
      targetId: id,
      data: { itemId, before: res.before },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id, itemId } = await params;
    const a = await driver(id);
    const removed = await deleteHotwashItem(id, itemId, { participantId: a.participant?.id ?? null, canModerate: a.isOwnerOrAdmin });
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "hotwash.deleted",
      targetType: "Exercise",
      targetId: id,
      data: { itemId, ...removed },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ ok: true });
  });
}
