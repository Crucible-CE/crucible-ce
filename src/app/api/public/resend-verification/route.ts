import { NextResponse } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email/send-verification";
import { validateBotCheck } from "@/lib/security/bot-check";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/auth/verification-token";
import { parseJsonBody } from "@/lib/http/parse-body";

// ---------------------------------------------------------------------------
// Public resend-verification endpoint.
// Used by the /check-email page and the unauthenticated /login flow when a
// credentials sign-in is rejected with code `email_not_verified`.
//
// Hardening:
//   - Honeypot (validateBotCheck)
//   - IP rate limit: 5 / hour (Redis-backed, multi-replica safe)
//   - Per-email cooldown: 1 / 10 min (Redis-backed)
//   - Enumeration-safe: always returns 200 on valid input, regardless of
//     whether the email maps to an existing user. Does not reveal verified
//     state.
// ---------------------------------------------------------------------------

const schema = z.object({
  email: z.string().email().max(320),
  honeypot: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const ip = ipFromRequest(req);

  const ipLimit = await checkRateLimit({
    namespace: "resend-verification:ip",
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 5,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } }
    );
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const botCheck = validateBotCheck({ honeypot: parsed.data.honeypot });
  if (!botCheck.ok) {
    return NextResponse.json({ error: botCheck.reason }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();

  // Silent enumeration-safe response. Do not leak account existence or
  // verification state. Always return 200 on valid input.
  const user = await db.user.findUnique({
    where: { email },
    select: { email: true, name: true, emailVerified: true },
  });

  // Per-email cooldown: 1 / 10 min. Implemented as a rate limit with max=1 —
  // Redis-backed so it survives replica churn. Enumeration-safe: if the
  // cooldown is active we silently skip the send but still return 200.
  const emailCooldown = user && !user.emailVerified
    ? await checkRateLimit({
        namespace: "resend-verification:email",
        identifier: email,
        windowMs: 10 * 60 * 1000,
        max: 1,
      })
    : { allowed: false } as const;

  if (user && !user.emailVerified && emailCooldown.allowed) {
    try {
      await db.verificationToken.deleteMany({ where: { identifier: email } });
      const token = crypto.randomBytes(32).toString("hex");
      await db.verificationToken.create({
        data: {
          identifier: email,
          token: hashToken(token),
          expires: new Date(Date.now() + 24 * 60 * 60_000),
        },
      });
      await sendVerificationEmail(user.email, user.name ?? "there", token);
    } catch (error) {
      console.error("[resend-verification] error:", error);
      // Swallow: client gets generic success to prevent enumeration.
    }
  }

  return NextResponse.json({ ok: true });
}
