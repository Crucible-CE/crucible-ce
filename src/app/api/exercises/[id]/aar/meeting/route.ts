// PATCH /api/exercises/{id}/aar/meeting   driver: {aamAt, aamAttendees, ipAgreedAt}
// Records the after-action meeting on the latest report. Required before signing.
// Allowed in draft and review until a signature is recorded.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller } from "@/lib/exercise/aar/http";
import { meetingSchema, updateMeeting } from "@/lib/exercise/aar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "driver");
    const parsed = await parseJsonBody(req, meetingSchema);
    if (!parsed.ok) return parsed.response;
    const res = await updateMeeting(id, parsed.data);
    audit({
      actorUserId: caller.actor.userId,
      actorParticipantId: caller.actor.participantId,
      action: "aar.meeting_recorded",
      targetType: "AfterActionReport",
      targetId: res.aarId,
      data: { aamAt: parsed.data.aamAt, ipAgreedAt: parsed.data.ipAgreedAt, attendeesChars: parsed.data.aamAttendees.length },
      req,
    });
    return NextResponse.json({ ok: true });
  });
}
