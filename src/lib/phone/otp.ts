// Phone ownership verification by SMS code (member notification phones).
//
// A 6-digit code is texted to the number; the member types it back in
// Settings. Only an HMAC of the code is stored (keyed from MASTER_KEK and bound
// to the user + the exact number it was sent to), it expires after
// OTP_TTL_MINUTES, and at most OTP_MAX_ATTEMPTS wrong guesses are allowed per
// code. Proving the code proves the member holds the phone, which is what the
// toll-fraud rule (lib/delivery/phone-gate) needs before SMS/voice may go there.

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { deriveMasterSubkey } from "@/lib/crypto/org-crypto";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;

/** A uniformly random 6-digit code ("000000"–"999999"). */
export function generateOtp(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

export function isWellFormedOtp(code: unknown): code is string {
  return typeof code === "string" && new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

/** Keyed, user- and number-bound hash of a code. */
export function hashOtp(userId: string, phone: string, code: string): string {
  return createHmac("sha256", deriveMasterSubkey("phone-otp-v1"))
    .update(JSON.stringify(["crucible-phone-otp", userId, phone, code]), "utf8")
    .digest("hex");
}

/** Constant-time comparison of a stored hash with the hash of a submitted code. */
export function otpMatches(storedHash: string, userId: string, phone: string, code: string): boolean {
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashOtp(userId, phone, code), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function otpExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OTP_TTL_MINUTES * 60_000);
}

export function otpSmsBody(code: string): string {
  return `Crucible verification code: ${code}. Expires in ${OTP_TTL_MINUTES} minutes. Didn't request it? Ignore this message.`;
}

/** Shown wherever SMS-based verification is offered on a server without Twilio. */
export const SMS_NOT_CONFIGURED_MESSAGE =
  "SMS is not set up on this server. An administrator can allow SMS/voice to this number.";
