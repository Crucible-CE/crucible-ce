// POST /api/exercises/{id}/aar/sign   {aarId, role: facilitator|sponsor, name, title, onBehalf?}
// Facilitator first (lead facilitator, controller, owner or admin, in person).
// Sponsor second when the organization requires it: the sponsor signs in person,
// or a facilitator enters it when the sponsor has no account (recorded as enteredBy).
// The last required signature makes the version final and signs the document.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { signAar, signInputSchema } from "@/lib/exercise/aar/finalize";
import { aarInExercise } from "@/lib/exercise/aar/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "any");
    const parsed = await parseJsonBody(req, signInputSchema);
    if (!parsed.ok) return parsed.response;
    const aar = await aarInExercise(id, parsed.data.aarId);
    const res = await signAar({ ...parsed.data, aarId: aar.id }, { userId: a.user.id, accountRole: a.user.role, name: a.user.name });
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "aar.signed",
      targetType: "AfterActionReport",
      targetId: aar.id,
      data: {
        exerciseId: id,
        version: aar.version,
        role: res.role,
        name: parsed.data.name,
        title: parsed.data.title,
        keyId: res.keyId,
        final: res.final,
        ...(res.contentHash ? { contentHash: res.contentHash } : {}),
        ...(res.enteredBy ? { enteredBy: res.enteredBy.userId } : {}),
      },
      req,
    });
    if (res.final) {
      audit({
        actorUserId: a.user.id,
        action: "aar.finalized",
        targetType: "AfterActionReport",
        targetId: aar.id,
        data: { exerciseId: id, version: aar.version, contentHash: res.contentHash, keyId: res.keyId },
        req,
      });
    }
    return NextResponse.json({ ok: true, final: res.final, contentHash: res.contentHash });
  });
}
