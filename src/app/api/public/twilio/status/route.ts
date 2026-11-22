import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nextRetryAt } from "@/lib/delivery/config";
import { validateTwilioRequest } from "@/lib/delivery/twilio-webhook";

// POST /api/public/twilio/status — Twilio delivery-status callback.
// Wired only when PUBLIC_URL is https (the Twilio provider attaches
// StatusCallback); otherwise this route is simply never called. Validates
// X-Twilio-Signature so a forged POST can't rewrite delivery rows.
//
// Downgrades the matching PageDelivery row (by Twilio SID in providerRef) when
// the carrier reports a final failure (failed / undelivered / busy /
// no-answer / canceled) and schedules a retry on the normal backoff. Success
// and interim statuses are no-ops (the row is already "sent" from the API
// accept). Unknown SIDs -> 200 no-op (Twilio retries on non-2xx).

const FAILED = new Set(["failed", "undelivered", "busy", "no-answer", "canceled"]);

export async function POST(req: Request) {
  const v = await validateTwilioRequest(req, "/api/public/twilio/status");
  if (!v.ok) {
    return v.status === 200
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  const sid = v.params.MessageSid ?? v.params.CallSid;
  const status = (v.params.MessageStatus ?? v.params.CallStatus ?? "").toLowerCase();
  if (!sid || !FAILED.has(status)) return NextResponse.json({ ok: true });

  const rows = await db.pageDelivery
    .findMany({ where: { providerRef: sid, channel: { in: ["sms", "voice"] }, status: "sent" }, select: { id: true, attempt: true } })
    .catch(() => []);
  for (const row of rows) {
    await db.pageDelivery
      .updateMany({
        where: { id: row.id, status: "sent" },
        data: { status: "failed", error: `Twilio reported ${status}`, nextRetryAt: nextRetryAt(row.attempt, new Date()) },
      })
      .catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
