// One-time password reset links. Used by the forgot-password page, the admin
// "Email reset link" and "Copy reset link" actions, and the server recovery
// command (scripts/reset-password.ts).
//
// The plaintext token (32 random bytes, hex) goes only into the link. The
// database keeps its SHA-256 digest in VerificationToken, under the
// identifier "reset:<email>". Issuing a new link deletes the user's earlier
// unused links, so only the latest one works. /api/public/reset-password
// consumes it once, within 1 hour.

import crypto from "crypto";
import { db } from "@/lib/db";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { hashToken } from "./verification-token";

export const RESET_TOKEN_TTL_MS = 60 * 60_000;

/** Shown on the forgot-password page when no email transport is configured. */
export const NO_EMAIL_MESSAGE = "Email isn't set up on this server. Ask an administrator to reset your password.";

export const resetIdentifier = (email: string): string => `reset:${email.toLowerCase().trim()}`;

/** The page a reset token is opened on, under PUBLIC_URL. */
export function resetLinkFor(token: string): string {
  return `${getPublicBaseUrl()}/reset-password?token=${token}`;
}

export interface IssuedResetLink {
  token: string;
  url: string;
  expiresAt: Date;
}

/** Create a reset link for `email`, replacing any earlier unused one. */
export async function issuePasswordResetLink(email: string, now: number = Date.now()): Promise<IssuedResetLink> {
  const identifier = resetIdentifier(email);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(now + RESET_TOKEN_TTL_MS);
  await db.$transaction([
    db.verificationToken.deleteMany({ where: { identifier } }),
    db.verificationToken.create({ data: { identifier, token: hashToken(token), expires: expiresAt } }),
  ]);
  return { token, url: resetLinkFor(token), expiresAt };
}
