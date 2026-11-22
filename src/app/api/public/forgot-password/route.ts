import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset";
import { activeEmailTransport } from "@/lib/email/transport";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { NO_EMAIL_MESSAGE, issuePasswordResetLink } from "@/lib/auth/password-reset";
import { parseJsonBody } from "@/lib/http/parse-body";
import { recordActivity } from "@/lib/security/activity-log";

const schema = z.object({
  email: z.string().email().max(320),
});

const SENT_MESSAGE = "If that email has an account, we sent a reset link.";

export async function POST(req: Request) {
  // Without an email transport nothing could be delivered: say so, the same
  // way for every address, and create no token. No account lookup happens.
  if (activeEmailTransport() === null) {
    return NextResponse.json({ emailConfigured: false, message: NO_EMAIL_MESSAGE });
  }

  const ip = ipFromRequest(req);

  // 3 reset requests per IP per hour. Enumeration-safe: if rate-limited,
  // return the same generic 200 that a successful-but-unknown-email request
  // would produce. No Retry-After header (would leak state to the attacker).
  const ipLimit = await checkRateLimit({
    namespace: "forgot-password:ip",
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 3,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json({ message: SENT_MESSAGE }, { status: 200 });
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const email = parsed.data.email.toLowerCase().trim();

  // Always return 200 regardless of whether email exists — prevents enumeration
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, organizationId: true },
  });

  // Activity trail (fire-and-forget): unknown addresses are stored only as
  // a salted hash, never raw.
  void recordActivity({
    action: "password.reset_requested",
    userId: user?.id ?? null,
    organizationId: user?.organizationId ?? null,
    email: user ? null : email,
    req,
    metadata: { knownUser: !!user },
  });

  if (user) {
    // Plaintext goes to the user's inbox; only the digest lives in the DB.
    // Earlier unused links for this email stop working.
    const link = await issuePasswordResetLink(email);
    sendPasswordResetEmail(email, user.name ?? "there", link.url).catch(() => {
      // Email failure is non-blocking
    });
  }

  return NextResponse.json({ message: SENT_MESSAGE });
}
