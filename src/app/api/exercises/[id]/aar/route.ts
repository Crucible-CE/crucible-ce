// GET   /api/exercises/{id}/aar            latest report (or ?version=N) and versions (control)
// POST  /api/exercises/{id}/aar            create draft v1 from the record (control)
// PATCH /api/exercises/{id}/aar            {status: "review"|"draft"} after-action meeting status (driver, audited)
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller, NO_STORE } from "@/lib/exercise/aar/http";
import { createAar, getAarView, setAarStatus, statusSchema } from "@/lib/exercise/aar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "control");
    const raw = new URL(req.url).searchParams.get("version");
    const version = raw && /^\d{1,4}$/.test(raw) ? Number(raw) : null;
    const view = await getAarView(id, version);
    return NextResponse.json({ ...view, canDrive: caller.isDriver }, { headers: NO_STORE });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "control");
    const { aarId } = await createAar(id);
    audit({
      actorUserId: caller.actor.userId,
      actorParticipantId: caller.actor.participantId,
      action: "aar.created",
      targetType: "AfterActionReport",
      targetId: aarId,
      data: { exerciseId: id },
      req,
    });
    return NextResponse.json({ id: aarId }, { status: 201 });
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "driver");
    const parsed = await parseJsonBody(req, statusSchema);
    if (!parsed.ok) return parsed.response;
    const res = await setAarStatus(id, parsed.data.status);
    audit({
      actorUserId: caller.actor.userId,
      actorParticipantId: caller.actor.participantId,
      action: "aar.status_changed",
      targetType: "AfterActionReport",
      targetId: res.aarId,
      data: { from: res.from, to: res.to },
      req,
    });
    return NextResponse.json({ ok: true, status: res.to });
  });
}
