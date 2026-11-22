import { db } from "@/lib/db";
import { verifyAckToken } from "@/lib/delivery/ack-token";
import { acknowledgePage } from "@/lib/escalation/engine";
import { ackBroadcastRecipient, findBroadcastRecipient } from "@/lib/broadcast/ack";
import { twimlResponse, validateTwilioRequest } from "@/lib/delivery/twilio-webhook";

// POST /api/public/twilio/voice?t=<ack token> — the <Gather> action of a voice
// page (only emitted when PUBLIC_URL is https). Twilio posts the pressed digit;
// "1" redeems the call's signed ack token. Signature-validated over the full
// public URL including the query string.

export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const v = await validateTwilioRequest(req, `/api/public/twilio/voice${url.search}`);
  if (!v.ok) {
    return v.status === 200 ? twimlResponse("<Hangup/>") : new Response("Invalid signature", { status: 403 });
  }
  if ((v.params.Digits ?? "").trim() !== "1") {
    return twimlResponse("<Say>Not acknowledged. Goodbye.</Say><Hangup/>");
  }
  const t = verifyAckToken(token);
  if (!t.ok) return twimlResponse("<Say>This page can no longer be acknowledged by phone. Goodbye.</Say><Hangup/>");

  const page = await db.incidentPage.findUnique({ where: { id: t.pageId }, select: { targetUserId: true } });
  if (!page && t.level === 0) {
    // A broadcast call (lib/broadcast): the token's id is the recipient.
    const recipient = await findBroadcastRecipient(t.pageId);
    if (recipient) {
      const acked = await ackBroadcastRecipient(recipient.recipientId, "voice");
      return twimlResponse(acked ? "<Say>Acknowledged. Goodbye.</Say><Hangup/>" : "<Say>Already acknowledged. Goodbye.</Say><Hangup/>");
    }
  }
  const won = page
    ? await acknowledgePage(t.pageId, { userId: page.targetUserId, via: "voice", level: t.level })
    : false;
  return twimlResponse(
    won
      ? "<Say>Acknowledged. Escalation stopped. Goodbye.</Say><Hangup/>"
      : "<Say>This page was already handled. Goodbye.</Say><Hangup/>",
  );
}
