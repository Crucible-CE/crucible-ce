import crypto from "crypto";

/**
 * Returns a SHA-256 hex digest of a bearer verification token.
 *
 * We email the plaintext token to the user and store only this digest in
 * `VerificationToken.token`. A read-only DB disclosure (backup snapshot,
 * replica misconfiguration, forensic artifact) therefore cannot be replayed
 * into an account takeover — the attacker still needs the plaintext that
 * only ever reached the user's inbox.
 *
 * Tokens are 32-byte `crypto.randomBytes` hex strings (256 bits of entropy),
 * so preimage search on the hash is not a concern; we use SHA-256 (fast) on
 * purpose rather than bcrypt — the input is already high-entropy and this
 * path runs on every reset/verification click.
 */
export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}
