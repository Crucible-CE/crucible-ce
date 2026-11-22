// POST /api/exercises/{id}/invites   {emails, note?} -> {sent, failed}
// Driver only. One plain-text email per address with the join link. Rate
// limited per exercise. The audit row holds counts, never addresses.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { emailConfigured } from "@/lib/exercise/email";
import { parseJsonBody } from "@/lib/http/parse-body";
import { checkRateLimit, tooManyRequests } from "@/lib/exercise/rate-limit";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";
import { EMAIL_OFF, checkInviteRequest, inviteLimit, inviteRequestSchema, sendExerciseInvites } from "@/lib/exercise/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, inviteRequestSchema, { maxBytes: 128 * 1024 });
    if (!parsed.ok) return parsed.response;
    const emails = checkInviteRequest(parsed.data);
    if (!emailConfigured()) return NextResponse.json({ error: EMAIL_OFF, emailEnabled: false }, { status: 409 });
    const limit = await checkRateLimit(inviteLimit(id));
    if (!limit.allowed) {
      const t = tooManyRequests(limit.retryAfter);
      return NextResponse.json(t.body, t.init);
    }
    const result = await sendExerciseInvites(id, emails, parsed.data.note, new URL(req.url).origin);
    const actor = actorOf(principal, participant);
    audit({
      actorUserId: actor.userId,
      actorParticipantId: actor.participantId,
      action: "exercise.invites_sent",
      targetType: "Exercise",
      targetId: id,
      data: { count: emails.length, sent: result.sent, failed: result.failed },
      req,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
