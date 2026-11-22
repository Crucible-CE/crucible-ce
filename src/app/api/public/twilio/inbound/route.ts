import { db } from "@/lib/db";
import { acknowledgePage } from "@/lib/escalation/engine";
import { escapeXml } from "@/lib/delivery/providers/twilio";
import { twimlResponse, validateTwilioRequest } from "@/lib/delivery/twilio-webhook";
import { isRedactedTarget } from "@/lib/delivery/redaction";
import { toE164 } from "@/lib/phone/e164";
import { liveIncidentWhere } from "@/lib/incident/live";

// POST /api/public/twilio/inbound — inbound SMS webhook (Twilio console:
// Phone Numbers -> your number -> Messaging -> "A message comes in" ->
// Webhook, HTTP POST, https://<PUBLIC_URL>/api/public/twilio/inbound).
//
// A reply of "ACK" (or "1") from a phone acknowledges the most recent OPEN
// page that was delivered to that number at the page's CURRENT escalation
// level (so a stale SMS from before an escalation can't ack on behalf of the
// new target). Signature-validated; anything else gets a short help reply.

const ACK_WORDS = new Set(["ACK", "1", "ACKNOWLEDGE", "ACKNOWLEDGED"]);

export async function POST(req: Request) {
  const v = await validateTwilioRequest(req, "/api/public/twilio/inbound");
  if (!v.ok) {
    return v.status === 200 ? twimlResponse("") : new Response("Invalid signature", { status: 403 });
  }
  // Delivery rows store the destination in E.164; compare in the same form.
  const from = toE164(v.params.From);
  const body = (v.params.Body ?? "").trim().toUpperCase().replace(/[.!]+$/, "");
  if (!from) return twimlResponse("");
  if (!ACK_WORDS.has(body)) {
    return twimlResponse(`<Message>Crucible: reply ACK to acknowledge your most recent page.</Message>`);
  }

  const recent = await db.pageDelivery.findMany({
    where: {
      destination: from,
      channel: { in: ["sms", "voice"] },
      status: "sent",
      page: { status: "sent", incident: liveIncidentWhere({ status: { not: "closed" } }) },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      pageId: true,
      level: true,
      page: {
        select: {
          organizationId: true,
          incidentId: true,
          escalationLevel: true,
          targetUserId: true,
          targetContactId: true,
          incident: { select: { title: true, restricted: true } },
        },
      },
    },
  });
  const match = recent.find((d) => d.level === d.page.escalationLevel);
  if (!match) return twimlResponse(`<Message>Crucible: no open page found for this number.</Message>`);

  const won = await acknowledgePage(match.pageId, {
    userId: match.page.targetUserId,
    via: "sms",
    level: match.level,
  });
  if (!won) return twimlResponse(`<Message>Crucible: that page was already handled.</Message>`);
  // A LOCKED incident's title never goes back to a target who was paged redacted.
  const redacted = await isRedactedTarget(match.page).catch(() => true);
  return twimlResponse(
    redacted
      ? `<Message>Crucible: acknowledged your page for a restricted incident. Escalation stopped.</Message>`
      : `<Message>Crucible: acknowledged "${escapeXml(match.page.incident.title.slice(0, 120))}". Escalation stopped.</Message>`,
  );
}
