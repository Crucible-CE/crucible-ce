// TOTP (RFC 6238) over HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30 s steps, the
// parameters every authenticator app defaults to. node:crypto only, no
// dependencies and no "@/" imports, so the e2e suite can import it directly to
// compute codes from the manual-entry key.
//
// verifyTotp accepts the current step and one step either side (clock skew)
// and returns the matched step counter. The caller persists the highest
// accepted counter and passes it back as `lastCounter`: a counter at or below
// it is refused, so a code can't be replayed inside its window.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_PERIOD_SEC = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted either side of "now". */
export const TOTP_SKEW_STEPS = 1;
/** 20 random bytes = 160 bits, the RFC 4226 recommended secret length. */
const SECRET_BYTES = 20;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Decode base32 (case-insensitive; spaces, dashes and '=' padding ignored). Throws on other characters. */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh random secret, base32-encoded (what the user types or scans). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** HOTP value for one counter (RFC 4226 section 5.3). */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Time-step counter for a moment (ms since epoch). */
export function totpCounter(nowMs: number = Date.now(), periodSec: number = TOTP_PERIOD_SEC): number {
  return Math.floor(nowMs / 1000 / periodSec);
}

/** The code for `nowMs` (default: now). `secret` is base32. */
export function generateTotp(secret: string, nowMs: number = Date.now()): string {
  return hotp(base32Decode(secret), totpCounter(nowMs));
}

/** The code for an explicit counter. `secret` is base32. */
export function totpAt(secret: string, counter: number): string {
  return hotp(base32Decode(secret), counter);
}

/** Strip spaces / dashes a user may type ("123 456"). */
export function normalizeTotpInput(code: string): string {
  return code.replace(/[\s-]/g, "");
}

/**
 * Verify a code. Returns the matched step counter, or null. Checks every step
 * in the window (no early exit) with a constant-time compare.
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { nowMs?: number; lastCounter?: number | null; skew?: number } = {},
): number | null {
  const given = normalizeTotpInput(code);
  if (!/^\d{6}$/.test(given)) return null;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return null;
  }
  if (key.length === 0) return null;
  const now = totpCounter(opts.nowMs ?? Date.now());
  const skew = opts.skew ?? TOTP_SKEW_STEPS;
  const last = opts.lastCounter ?? null;
  let matched: number | null = null;
  const givenBuf = Buffer.from(given);
  for (let c = now - skew; c <= now + skew; c++) {
    if (c < 0) continue;
    const ok = timingSafeEqual(Buffer.from(hotp(key, c)), givenBuf);
    if (ok && matched === null && (last === null || c > last)) matched = c;
  }
  return matched;
}

/** otpauth:// URI for the QR code (Key Uri Format). */
export function totpUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** "ABCD EFGH ..." for the manual-entry key. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
