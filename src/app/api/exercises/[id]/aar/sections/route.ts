// PATCH /api/exercises/{id}/aar/sections   {section, path?, value}
// One human edit. The whole report is validated after the change and the
// edit log records it (origin human). Latest version in draft or review only. Control only.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller } from "@/lib/exercise/aar/http";
import { editSection, sectionEditSchema } from "@/lib/exercise/aar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const caller = await aarCaller(req, id, "control");
    const parsed = await parseJsonBody(req, sectionEditSchema);
    if (!parsed.ok) return parsed.response;
    const res = await editSection(id, parsed.data, caller.userId);
    audit({
      actorUserId: caller.actor.userId,
      actorParticipantId: caller.actor.participantId,
      action: "aar.section_edited",
      targetType: "AfterActionReport",
      targetId: res.aarId,
      data: { section: parsed.data.section, path: parsed.data.path ?? null },
      req,
    });
    return NextResponse.json({ ok: true });
  });
}
