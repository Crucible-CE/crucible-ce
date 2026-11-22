// POST /api/join {code, displayName, title?, teamId?}: public.
// Guests get a Participant and an httpOnly guest cookie; signed-in users get a
// user Participant. Rate limited per IP and per code; see src/exercises/join.ts.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { issueGuestSession } from "@/lib/exercise/auth/guest";
import { parseJsonBody } from "@/lib/http/parse-body";
import { notifyChanged } from "@/lib/exercise/runtime/engine";
import { toHttpError } from "@/lib/exercise/errors";
import { joinByCode, RateLimitedError } from "@/lib/exercise/join";
import { joinSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await parseJsonBody(req, joinSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const user = await getSessionUser();
    const result = await joinByCode(req, parsed.data, user);
    const res = NextResponse.json({ exerciseId: result.exerciseId }, { headers: { "Cache-Control": "no-store" } });
    if (result.kind === "guest") {
      await issueGuestSession(result.exerciseId, result.participantId, { response: res });
      audit({
        actorParticipantId: result.participantId,
        action: "exercise.guest_joined",
        targetType: "Exercise",
        targetId: result.exerciseId,
        data: { displayName: result.displayName, teamId: result.teamId },
        req,
      });
    } else if (result.created) {
      audit({
        actorUserId: user?.id ?? null,
        actorParticipantId: result.participantId,
        action: "exercise.joined_by_code",
        targetType: "Exercise",
        targetId: result.exerciseId,
        req,
      });
    }
    notifyChanged(result.exerciseId);
    return res;
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.max(1, e.retryAfter)) } });
    }
    return toHttpError(e);
  }
}
