import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { toE164 } from "@/lib/phone/e164";
import { parseJsonBody } from "@/lib/http/parse-body";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { OTP_MAX_ATTEMPTS, isWellFormedOtp, otpMatches } from "@/lib/phone/otp";

const schema = z.object({ code: z.string().max(16) });

const CLEARED = { phoneOtpHash: null, phoneOtpPhone: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 } as const;

// POST /api/notifications/phone-verification/confirm { code } — check the
// texted code. Success stamps notificationPhoneVerifiedAt, which lets the
// delivery engine and notify() text / call the number. Max 5 wrong guesses per
// code (counted atomically), 10-minute expiry, and the code is bound to the
// exact number it was sent to: changing the number in between voids it.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const rl = await checkRateLimit({ namespace: "phone-otp:confirm", identifier: userId, windowMs: 10 * 60_000, max: 20 });
  if (!rl.allowed) {
    return NextResponse.json({ error: `Too many attempts. Try again in ${rl.retryAfter}s.` }, { status: 429 });
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const code = parsed.data.code.replace(/\s+/g, "");
  if (!isWellFormedOtp(code)) {
    return NextResponse.json({ error: "Enter the 6-digit code from the text message.", code: "malformed" }, { status: 400 });
  }

  const s = await db.userNotificationSetting.findUnique({
    where: { userId },
    select: { notificationPhone: true, phoneOtpHash: true, phoneOtpPhone: true, phoneOtpExpiresAt: true, phoneOtpAttempts: true },
  });
  const now = new Date();
  const current = toE164(s?.notificationPhone);
  if (!s?.phoneOtpHash || !s.phoneOtpPhone || !s.phoneOtpExpiresAt || s.phoneOtpExpiresAt < now || s.phoneOtpPhone !== current) {
    return NextResponse.json({ error: "Code expired. Send a new code.", code: "expired" }, { status: 400 });
  }

  // Count the attempt BEFORE comparing (atomic): parallel guesses can't
  // exceed the cap.
  const claimed = await db.userNotificationSetting.updateMany({
    where: { userId, phoneOtpHash: s.phoneOtpHash, phoneOtpAttempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { phoneOtpAttempts: { increment: 1 } },
  });
  if (claimed.count !== 1) {
    await db.userNotificationSetting.updateMany({ where: { userId, phoneOtpHash: s.phoneOtpHash }, data: CLEARED });
    return NextResponse.json({ error: "Too many wrong codes. Send a new code.", code: "too_many_attempts" }, { status: 429 });
  }

  if (!otpMatches(s.phoneOtpHash, userId, s.phoneOtpPhone, code)) {
    const left = Math.max(0, OTP_MAX_ATTEMPTS - (s.phoneOtpAttempts + 1));
    if (left === 0) await db.userNotificationSetting.updateMany({ where: { userId, phoneOtpHash: s.phoneOtpHash }, data: CLEARED });
    return NextResponse.json(
      { error: left > 0 ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong codes. Send a new code.", code: "wrong_code", attemptsLeft: left },
      { status: 400 },
    );
  }

  // Single use: only the request that still sees this code (and this number) wins.
  const done = await db.userNotificationSetting.updateMany({
    where: { userId, phoneOtpHash: s.phoneOtpHash, notificationPhone: s.notificationPhone },
    data: { ...CLEARED, notificationPhoneVerifiedAt: now },
  });
  if (done.count !== 1) {
    return NextResponse.json({ error: "Code expired. Send a new code.", code: "expired" }, { status: 400 });
  }
  return NextResponse.json({ verified: true, phone: s.phoneOtpPhone });
}
