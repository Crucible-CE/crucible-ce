import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/auth/verification-token";
import { parseJsonBody } from "@/lib/http/parse-body";
import { recordActivity } from "@/lib/security/activity-log";
import { clearLoginThrottleForEmail } from "@/lib/security/login-throttle";

const schema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  // Per-IP ceiling: 10 reset-completion attempts / hour. Prevents an attacker
  // who has scraped a large set of leaked emails from burning through stolen
  // reset links from a single origin.
  const ipLimit = await checkRateLimit({
    namespace: "reset-password:ip",
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 10,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } }
    );
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const { token, password } = parsed.data;

  // Per-token ceiling: 5 attempts per token within its 1-hour TTL. Each token
  // is cryptographically unguessable (32 random bytes) so this is a belt-and-
  // braces check against pathological abuse of a single intercepted link.
  const tokenLimit = await checkRateLimit({
    namespace: "reset-password:token",
    identifier: token,
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!tokenLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Request a new reset link." },
      { status: 429, headers: { "Retry-After": String(tokenLimit.retryAfter) } }
    );
  }

  // Hash the URL token and compare against the stored digest. Plaintext
  // tokens are never persisted.
  const tokenHash = hashToken(token);
  const record = await db.verificationToken.findUnique({
    where: { token: tokenHash },
  });

  if (!record || !record.identifier.startsWith("reset:") || record.expires < new Date()) {
    return NextResponse.json(
      { error: "This reset link is invalid or expired. Request a new one." },
      { status: 400 }
    );
  }

  const email = record.identifier.replace("reset:", "");
  const passwordHash = await bcrypt.hash(password, 12);

  // Update password, bump tokenVersion (invalidates all sessions), delete token
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { email },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.verificationToken.delete({
      where: { token: tokenHash },
    });
    return u;
  });

  // The tokenVersion bump above revoked every session of this user.
  void recordActivity({
    action: "password.reset_completed",
    userId: updated.id,
    organizationId: updated.organizationId,
    req,
  });
  void recordActivity({
    action: "session.revoked",
    userId: updated.id,
    organizationId: updated.organizationId,
    metadata: { reason: "password_reset" },
  });
  // Proving control of the mailbox also lifts any sign-in delay on the account.
  void clearLoginThrottleForEmail(email);

  return NextResponse.json({ success: true });
}
