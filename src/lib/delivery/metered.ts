// =============================================================================
// Metered channels (SMS / voice): the one anti toll-fraud gate.
// =============================================================================
// Every SMS or voice call Crucible places goes through these limits, whatever
// sent it: page deliveries (PageDelivery rows, src/lib/delivery/engine) and
// everything else, notify() SMS, phone verification codes and contact
// verification links (MeteredSend rows, sendMeteredSms below). Both tables are
// counted together, per E.164 number and per org, over a rolling hour:
//   - per number  DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR (10); escalations and
//     critical-severity pages are EXEMPT (`exemptPerNumber`),
//   - per org     DELIVERY_RATE_LIMIT_PER_ORG_HOUR (100), always,
//   - per number  DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR (60): the abuse
//     ceiling, always.
// =============================================================================

import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone/e164";
import { twilioConfigured, twilioSendSms } from "./providers/twilio";
import { numberCeilingHourlyLimit, orgHourlyLimit, recipientHourlyLimit } from "./config";

export interface RateLimitHit {
  reason: string;
  /** When the rolling window frees enough for this send (retry then). */
  retryAt: Date;
}

/**
 * Anti toll-fraud gate for ONE metered channel (SMS and voice are counted
 * separately). The number is compared in E.164. A hit carries the time the
 * window frees (oldest counted send + 1h), so a skipped page attempt is
 * retried then.
 */
export async function checkMeteredRateLimit(
  organizationId: string,
  phone: string,
  channel: string,
  now: Date,
  opts: { exemptPerNumber?: boolean } = {},
): Promise<RateLimitHit | null> {
  const number = toE164(phone) ?? phone;
  const since = new Date(now.getTime() - 60 * 60_000);
  const pageBase = { channel, status: { in: ["sent", "pending"] }, createdAt: { gte: since } };
  const sendBase = { channel, createdAt: { gte: since } };
  const scopes = {
    number: { page: { ...pageBase, organizationId, destination: number }, other: { ...sendBase, organizationId, destination: number } },
    org: { page: { ...pageBase, organizationId }, other: { ...sendBase, organizationId } },
  };
  const [pagesToNumber, otherToNumber, pagesOrg, otherOrg] = await Promise.all([
    db.pageDelivery.count({ where: scopes.number.page }),
    db.meteredSend.count({ where: scopes.number.other }),
    db.pageDelivery.count({ where: scopes.org.page }),
    db.meteredSend.count({ where: scopes.org.other }),
  ]);
  const toNumber = pagesToNumber + otherToNumber;
  const orgWide = pagesOrg + otherOrg;
  const label = channel === "voice" ? "voice calls" : "SMS";
  const perNumber = recipientHourlyLimit();
  const perOrg = orgHourlyLimit();
  const ceiling = numberCeilingHourlyLimit();
  let hit: { reason: string; where: (typeof scopes)[keyof typeof scopes] } | null = null;
  if (!opts.exemptPerNumber && toNumber >= perNumber) {
    hit = { reason: `rate limited: ${toNumber} ${label} to this number in the last hour (limit ${perNumber})`, where: scopes.number };
  } else if (orgWide >= perOrg) {
    hit = { reason: `rate limited: ${orgWide} ${label} for the organization in the last hour (limit ${perOrg})`, where: scopes.org };
  } else if (toNumber >= ceiling) {
    hit = { reason: `rate limited: ${toNumber} ${label} to this number in the last hour (abuse ceiling ${ceiling})`, where: scopes.number };
  }
  if (!hit) return null;
  const [oldestPage, oldestOther] = await Promise.all([
    db.pageDelivery
      .findFirst({ where: hit.where.page, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
      .catch(() => null),
    db.meteredSend
      .findFirst({ where: hit.where.other, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
      .catch(() => null),
  ]);
  const oldest = [oldestPage?.createdAt, oldestOther?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const frees = oldest ? oldest.getTime() + 60 * 60_000 + 5_000 : now.getTime() + 5 * 60_000;
  return { reason: hit.reason, retryAt: new Date(Math.max(frees, now.getTime() + 60_000)) };
}

export type MeteredPurpose = "notify" | "phone_otp" | "contact_verify" | "test_page" | "broadcast";

export interface MeteredSmsResult {
  ok: boolean;
  /** Deliberately not sent: no number, SMS not configured, or rate limited. */
  skipped?: boolean;
  detail?: string;
}

/**
 * Send one non-page SMS through the metered gate: E.164 only, Twilio must be
 * configured, the rate limits above apply, and the attempt is recorded (as a
 * MeteredSend row, BEFORE the provider call, so concurrent sends count it).
 * Callers are responsible for the destination being a verified number (or
 * one being verified right now, for the verification messages themselves).
 */
export async function sendMeteredSms(args: {
  organizationId: string;
  to: string | null | undefined;
  body: string;
  purpose: MeteredPurpose;
  now?: Date;
}): Promise<MeteredSmsResult> {
  const number = toE164(args.to);
  if (!number) return { ok: false, skipped: true, detail: "No valid (E.164) phone number" };
  if (!twilioConfigured()) return { ok: false, skipped: true, detail: "SMS provider not configured (Twilio)" };
  const now = args.now ?? new Date();
  const hit = await checkMeteredRateLimit(args.organizationId, number, "sms", now);
  if (hit) return { ok: false, skipped: true, detail: hit.reason };
  await db.meteredSend.create({
    data: { organizationId: args.organizationId, channel: "sms", destination: number, purpose: args.purpose, createdAt: now },
  });
  const r = await twilioSendSms(number, args.body);
  return r.ok ? { ok: true, detail: r.sid } : { ok: false, detail: r.detail ?? "Twilio send failed" };
}
