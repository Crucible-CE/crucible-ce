// GET  /api/exercises/{id}/hotwash   control: {exercise, objectives, items, canWrite, canModerate, canRate, me}
// POST /api/exercises/{id}/hotwash   driver, after ENDEX: {kind, objectiveId?, text}
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { addHotwashItem, hotwashCreateSchema, listHotwash } from "@/lib/exercise/hotwash/hotwash";
import { canRate } from "@/lib/exercise/hotwash/ratings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    const [exercise, objectives, items] = await Promise.all([
      db.exercise.findUnique({ where: { id }, select: { id: true, title: true, status: true, isPractice: true, endedAt: true } }),
      db.objective.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" }, select: { id: true, seq: true, text: true } }),
      listHotwash(id),
    ]);
    const ended = exercise?.status === "ended";
    return NextResponse.json(
      {
        exercise,
        objectives,
        items,
        me: a.participant?.id ?? null,
        canWrite: ended && a.viewer.isDriver,
        canModerate: ended && a.isOwnerOrAdmin,
        canRate: ended && canRate(a.viewer, a.participant, a.isOwnerOrAdmin),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    if (!a.viewer.isDriver) throw new AccessError(403, "Only a facilitator or controller can add hotwash items.");
    const parsed = await parseJsonBody(req, hotwashCreateSchema);
    if (!parsed.ok) return parsed.response;
    const itemId = await addHotwashItem(id, a.participant?.id ?? null, parsed.data);
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "hotwash.added",
      targetType: "Exercise",
      targetId: id,
      data: { itemId, kind: parsed.data.kind },
      req,
    });
    notifyChanged(id, undefined, "control");
    return NextResponse.json({ id: itemId }, { status: 201 });
  });
}
