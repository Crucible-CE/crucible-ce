import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import { sha256Hex } from "@/lib/crypto/hash";
import { activeEmailTransport } from "@/lib/email/transport";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { sendEscalationVerificationEmail } from "@/lib/email/send-escalation-verification";
import { twilioConfigured } from "@/lib/delivery/providers/twilio";
import { sendMeteredSms } from "@/lib/delivery/metered";
import { EMAIL_VERIFY_TOKEN_BYTES, PHONE_VERIFY_TOKEN_BYTES } from "@/lib/contacts/verify-token";
import { CONTACT_VERIFY_STALE_DAYS, staleContactWhere } from "@/lib/escalation/contact-fields";

/**
 * Is outbound email configured (SMTP or Resend)? The send helpers no-op
 * silently without it, so the campaign checks up front and says so instead of
 * reporting "sent". Single seam: the unified transport decides.
 */
function isEmailConfigured(): boolean {
  return activeEmailTransport() !== null;
}

const isStale = (at: Date | null, before: Date) => !at || at < before;

// POST /api/escalation-contacts/verify-campaign
// Re-verifies every active contact whose email or phone is unverified or stale
// (>90 days), each channel SEPARATELY:
//   - email unverified/stale -> an emailed confirm link (proves the mailbox,
//     sets emailVerifiedAt), when email is configured;
//   - phone unverified/stale -> an SMS with a short confirm link (proves the
//     phone, sets phoneVerifiedAt, which is what opens SMS/voice paging), when
//     Twilio is configured. The SMS goes through the metered toll-fraud gate.
// Every link is single-use, expiring, and stored only as a hash.
//
// Response: { emailConfigured, smsConfigured, sent, failed, smsSent,
// smsFailed, staleCount }. Nothing is minted for a channel that isn't
// configured.
export async function POST() {
  const session = await auth();
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user, "incidents.edit")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = session.user.organizationId;

  // Each run mails/texts every stale contact: keep it from being a spam cannon.
  const rl = await checkRateLimit({ namespace: "verify-campaign:org", identifier: orgId, windowMs: 60 * 60_000, max: 3 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Verification links were sent recently. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const staleBefore = new Date(Date.now() - CONTACT_VERIFY_STALE_DAYS * 86_400_000);

  const [org, stale] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    db.escalationContact.findMany({
      where: { organizationId: orgId, ...staleContactWhere(staleBefore) },
      select: { id: true, name: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    }),
  ]);

  const emailConfigured = isEmailConfigured();
  const smsConfigured = twilioConfigured();
  const result = { emailConfigured, smsConfigured, sent: 0, failed: 0, smsSent: 0, smsFailed: 0, staleCount: stale.length };
  if (!emailConfigured && !smsConfigured) return NextResponse.json(result);

  const orgName = org?.name ?? "your organization";
  const base = getPublicBaseUrl().replace(/\/+$/, "");
  for (const c of stale) {
    if (emailConfigured && c.email && isStale(c.emailVerifiedAt, staleBefore)) {
      const token = randomBytes(EMAIL_VERIFY_TOKEN_BYTES).toString("hex");
      await db.escalationContact.update({
        where: { id: c.id },
        data: { verificationTokenHash: sha256Hex(token), verificationSentAt: new Date() },
      });
      try {
        await sendEscalationVerificationEmail({ to: c.email, contactName: c.name, orgName, token });
        result.sent++;
      } catch (err) {
        result.failed++;
        console.error("[verify-campaign] email failed for contact", c.id, err);
      }
    }
    if (smsConfigured && c.phone && isStale(c.phoneVerifiedAt, staleBefore)) {
      const token = randomBytes(PHONE_VERIFY_TOKEN_BYTES).toString("hex");
      await db.escalationContact.update({
        where: { id: c.id },
        data: { phoneVerificationTokenHash: sha256Hex(token), phoneVerificationSentAt: new Date() },
      });
      const r = await sendMeteredSms({
        organizationId: orgId,
        to: c.phone,
        body: `${orgName} lists this number as an emergency contact. Confirm it: ${base}/escalation-verify/${token}`,
        purpose: "contact_verify",
      }).catch((err) => {
        console.error("[verify-campaign] SMS failed for contact", c.id, err);
        return { ok: false };
      });
      if (r.ok) result.smsSent++;
      else result.smsFailed++;
    }
  }

  return NextResponse.json(result);
}
