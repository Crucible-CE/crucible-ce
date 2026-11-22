// GET  /api/exercises/{id}/aar/finalize?aarId=   control: sign-off state {status, problems, required, next, signatures, contentHash, keyId}
// POST /api/exercises/{id}/aar/finalize          driver: {aarId, to: "review" | "draft"}
//   review: open the report for sign-off (after-action meeting). draft: back to editing; clears signatures.
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { setReviewStatus, signoffState } from "@/lib/exercise/aar/finalize";
import { aarInExercise } from "@/lib/exercise/aar/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({ aarId: z.string().min(1).max(40), to: z.enum(["review", "draft"]) });

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    const aar = await aarInExercise(id, new URL(req.url).searchParams.get("aarId"));
    const state = await signoffState(aar.id);
    return NextResponse.json(
      { ...state, me: { userId: a.user.id, name: a.user.name, canDrive: a.viewer.isDriver } },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    if (!a.viewer.isDriver) throw new AccessError(403, "Only a facilitator or controller can change the report status.");
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const aar = await aarInExercise(id, parsed.data.aarId);
    const res = await setReviewStatus(aar.id, parsed.data.to);
    if (res.from !== res.to) {
      audit({
        actorUserId: a.user.id,
        actorParticipantId: a.participant?.id ?? null,
        action: parsed.data.to === "review" ? "aar.sent_to_review" : "aar.returned_to_draft",
        targetType: "AfterActionReport",
        targetId: aar.id,
        data: { exerciseId: id, version: aar.version, clearedSignatures: res.clearedSignatures },
        req,
      });
    }
    return NextResponse.json({ ok: true, status: res.to, clearedSignatures: res.clearedSignatures });
  });
}
