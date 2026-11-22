// POST /api/play/{id}/respond {injectId, kind, data}: a player's vote, answer,
// entry or deliverable. The mode validates; a response after close is a 409.
// Limited to RESPOND_LIMIT per participant per minute.
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { submitResponse } from "@/lib/exercise/runtime/engine";
import { checkRateLimit, tooManyRequests } from "@/lib/exercise/rate-limit";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { respondLimit, respondSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { participant } = await requireAccess(id, principal, "participant");
    const limit = await checkRateLimit(respondLimit(participant!.id));
    if (!limit.allowed) {
      const r = tooManyRequests(limit.retryAfter);
      return NextResponse.json(r.body, r.init);
    }
    const parsed = await parseJsonBody(req, respondSchema);
    if (!parsed.ok) return parsed.response;
    const { responseId } = await submitResponse({
      exerciseId: id,
      injectId: parsed.data.injectId,
      participant: participant!,
      kind: parsed.data.kind,
      raw: parsed.data.data,
    });
    return NextResponse.json({ responseId }, { status: 201 });
  });
}
