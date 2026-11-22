import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone/e164";
import { twilioConfigured } from "@/lib/delivery/providers/twilio";
import { sendMeteredSms } from "@/lib/delivery/metered";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  OTP_TTL_MINUTES,
  SMS_NOT_CONFIGURED_MESSAGE,
  generateOtp,
  hashOtp,
  otpExpiry,
  otpSmsBody,
} from "@/lib/phone/otp";

/** Codes one member may request per hour (each is a paid SMS). */
const SENDS_PER_HOUR = 5;

// POST /api/notifications/phone-verification — text a 6-digit code to the
// caller's saved notification phone. Confirm it with POST ./confirm. The code
// is stored hashed (lib/phone/otp), expires after 10 minutes, and a new send
// replaces any earlier code. The SMS goes through the metered toll-fraud gate.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  if (!twilioConfigured()) {
    return NextResponse.json({ error: SMS_NOT_CONFIGURED_MESSAGE, code: "sms_not_configured" }, { status: 409 });
  }

  const setting = await db.userNotificationSetting.findUnique({
    where: { userId },
    select: { notificationPhone: true, notificationPhoneVerifiedAt: true },
  });
  const phone = toE164(setting?.notificationPhone);
  if (!phone) {
    return NextResponse.json({ error: "Save a mobile number first.", code: "no_phone" }, { status: 400 });
  }
  if (setting?.notificationPhoneVerifiedAt) {
    return NextResponse.json({ sent: false, alreadyVerified: true });
  }

  const rl = await checkRateLimit({ namespace: "phone-otp:send", identifier: userId, windowMs: 60 * 60_000, max: SENDS_PER_HOUR });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many codes requested. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const code = generateOtp();
  const now = new Date();
  const expiresAt = otpExpiry(now);
  await db.userNotificationSetting.update({
    where: { userId },
    data: { phoneOtpHash: hashOtp(userId, phone, code), phoneOtpPhone: phone, phoneOtpExpiresAt: expiresAt, phoneOtpAttempts: 0 },
  });

  const sent = await sendMeteredSms({
    organizationId: session.user.organizationId,
    to: phone,
    body: otpSmsBody(code),
    purpose: "phone_otp",
    now,
  });
  if (!sent.ok) {
    // Nothing was delivered: drop the code so it can't be guessed at.
    await db.userNotificationSetting.update({
      where: { userId },
      data: { phoneOtpHash: null, phoneOtpPhone: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 },
    });
    const limited = (sent.detail ?? "").startsWith("rate limited");
    return NextResponse.json(
      { error: limited ? `SMS to this number is rate limited right now (${sent.detail}). Try again later.` : "The verification SMS could not be sent. Check the number and try again." },
      { status: limited ? 429 : 502 },
    );
  }
  return NextResponse.json({ sent: true, expiresAt: expiresAt.toISOString(), ttlMinutes: OTP_TTL_MINUTES });
}
