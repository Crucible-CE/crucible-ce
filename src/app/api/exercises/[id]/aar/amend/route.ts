// POST /api/exercises/{id}/aar/amend   driver: {aarId, reason}  -> {id, version}
// Starts a new draft version linked to the final one. Signatures start over.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { AccessError } from "@/lib/exercise/runtime/view";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { amendAar, amendInputSchema } from "@/lib/exercise/aar/finalize";
import { aarInExercise } from "@/lib/exercise/aar/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const a = await userAccess(id, "control");
    if (!a.viewer.isDriver) throw new AccessError(403, "Only a facilitator or controller can amend the report.");
    const parsed = await parseJsonBody(req, amendInputSchema);
    if (!parsed.ok) return parsed.response;
    const aar = await aarInExercise(id, parsed.data.aarId);
    const created = await amendAar(aar.id, parsed.data.reason);
    audit({
      actorUserId: a.user.id,
      actorParticipantId: a.participant?.id ?? null,
      action: "aar.amended",
      targetType: "AfterActionReport",
      targetId: created.id,
      data: { exerciseId: id, previousId: aar.id, version: created.version, reason: parsed.data.reason },
      req,
    });
    return NextResponse.json(created, { status: 201 });
  });
}
