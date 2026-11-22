// Escalation-contact verification links ("are your details still current?").
//
// Two kinds, verified SEPARATELY: the EMAILED link (32 random bytes, 64 hex)
// proves the mailbox and sets emailVerifiedAt; the SMS link (16 random bytes,
// 32 hex, shorter for a text message) proves the phone and sets
// phoneVerifiedAt. Both are stored only as sha256 hashes.
//
// The link is single-use and expires: the campaign stamps verificationSentAt
// when it mints a token, and the token stops working VERIFY_TOKEN_TTL_DAYS
// later. Confirming is a POST from a confirm page — never a GET — so mail
// scanners and link-preview bots that pre-fetch URLs can't confirm on the
// contact's behalf.

export const VERIFY_TOKEN_TTL_DAYS = 14;
const TTL_MS = VERIFY_TOKEN_TTL_DAYS * 86_400_000;

/** Email tokens are 32 random bytes, hex; SMS tokens 16. Reject anything else cheaply. */
export function isWellFormedVerifyToken(token: string | null | undefined): token is string {
  return typeof token === "string" && (/^[0-9a-f]{64}$/i.test(token) || /^[0-9a-f]{32}$/i.test(token));
}

/** Which channel a well-formed token verifies (by its length). */
export function verifyTokenChannel(token: string): "email" | "phone" {
  return token.length === 32 ? "phone" : "email";
}

export const EMAIL_VERIFY_TOKEN_BYTES = 32;
export const PHONE_VERIFY_TOKEN_BYTES = 16;

/** The oldest `verificationSentAt` a still-valid token can have. */
export function verifyTokenCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - TTL_MS);
}

/** Has a token minted at `sentAt` expired? A missing timestamp counts as expired. */
export function isVerifyTokenExpired(sentAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!sentAt) return true;
  return sentAt.getTime() < verifyTokenCutoff(now).getTime();
}
