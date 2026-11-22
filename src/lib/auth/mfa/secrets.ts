// At-rest protection for MFA material, keyed off the install master key
// (MASTER_KEK) via HKDF (src/lib/crypto/org-crypto.ts deriveMasterSubkey):
//
//   TOTP secrets    AES-256-GCM, key info "mfa-totp-v1", AAD = user id (a
//                   ciphertext copied onto another user's row won't decrypt).
//                   Format: "v1:" + base64(iv(12) || tag(16) || ct).
//   recovery codes  HMAC-SHA256, key info "mfa-recovery-v1", over
//                   "<userId>:<normalized code>". Codes carry 50 random bits,
//                   so a keyed hash is enough; without MASTER_KEK a leaked
//                   table can't be brute-forced at all.

import { createCipheriv, createDecipheriv, createHmac, randomInt, randomBytes } from "node:crypto";
import { deriveMasterSubkey } from "@/lib/crypto/org-crypto";

const TOTP_KEY_INFO = "mfa-totp-v1";
const RECOVERY_KEY_INFO = "mfa-recovery-v1";
const ENC_PREFIX = "v1:";

export function encryptTotpSecret(userId: string, secret: string): string {
  const key = deriveMasterSubkey(TOTP_KEY_INFO);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(userId, "utf8"));
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ENC_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

/** Decrypt a stored TOTP secret. Throws on tampering or a wrong key/user. */
export function decryptTotpSecret(userId: string, stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) throw new Error("unknown TOTP secret format");
  const buf = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const key = deriveMasterSubkey(TOTP_KEY_INFO);
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

// ---- Recovery codes --------------------------------------------------------

export const RECOVERY_CODE_COUNT = 10;
/** Warn the user when this many (or fewer) unused codes remain. */
export const RECOVERY_LOW_WATERMARK = 2;
// No 0/O, 1/I/L: codes get copied off paper.
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const RECOVERY_LEN = 10;

/** One code, "XXXXX-XXXXX". */
function generateRecoveryCode(): string {
  let s = "";
  for (let i = 0; i < RECOVERY_LEN; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function generateRecoveryCodes(n: number = RECOVERY_CODE_COUNT): string[] {
  const out = new Set<string>();
  while (out.size < n) out.add(generateRecoveryCode());
  return [...out];
}

/** Uppercase, strip separators; null if it can't be a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.length !== RECOVERY_LEN) return null;
  for (const ch of s) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return s;
}

/** Keyed hash of a recovery code for one user; null for malformed input. */
export function hashRecoveryCode(userId: string, input: string): string | null {
  const norm = normalizeRecoveryCode(input);
  if (!norm) return null;
  return createHmac("sha256", deriveMasterSubkey(RECOVERY_KEY_INFO)).update(`${userId}:${norm}`).digest("hex");
}

