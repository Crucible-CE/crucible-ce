// POST /api/exercises/{id}/aar/refresh   {sections?: string[], force?: boolean}
// Rebuild the record sections from the exercise. Sections a person edited stay
// unless force is set. The narrative is never touched. Control only.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller } from "@/lib/exercise/aar/http";
import { refreshFromRecord, refreshSchema } from "@/lib/exercise/aar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "control");
    const parsed = await parseJsonBody(req, refreshSchema);
    if (!parsed.ok) return parsed.response;
    const { aarId, changed } = await refreshFromRecord(id, parsed.data, caller.userId);
    audit({
      actorUserId: caller.actor.userId,
      actorParticipantId: caller.actor.participantId,
      action: "aar.refreshed",
      targetType: "AfterActionReport",
      targetId: aarId,
      data: { sections: changed, force: Boolean(parsed.data.force) },
      req,
    });
    return NextResponse.json({ ok: true, id: aarId, changed });
  });
}
