import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";
import { hashToken } from "@/lib/auth/verification-token";

export async function GET(req: Request) {
  const ip = ipFromRequest(req);

  // Per-IP ceiling: 20 verify attempts / hour. Generous because a single user
  // can legitimately open the verify link across multiple devices / previews,
  // but still caps a token-guessing attacker to a bounded rate.
  const ipLimit = await checkRateLimit({
    namespace: "verify-email:ip",
    identifier: ip,
    windowMs: 60 * 60 * 1000,
    max: 20,
  });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // Per-token ceiling: 10 attempts per token within its 24-hour TTL. Cheap
  // defense-in-depth — the token is 32 random bytes, so this is not the
  // primary barrier, but it caps any pathological replay loop.
  const tokenLimit = await checkRateLimit({
    namespace: "verify-email:token",
    identifier: token,
    windowMs: 24 * 60 * 60 * 1000,
    max: 10,
  });
  if (!tokenLimit.allowed) {
    return new NextResponse(null, {
      status: 307,
      headers: { Location: "/login?error=invalid_or_expired_verification_token" },
    });
  }

  // Hash the URL token and compare against the stored digest. Plaintext
  // tokens are never persisted.
  const tokenHash = hashToken(token);
  const record = await db.verificationToken.findUnique({
    where: { token: tokenHash },
  });

  if (!record || record.expires < new Date()) {
    return new NextResponse(null, {
      status: 307,
      headers: { Location: "/login?error=invalid_or_expired_verification_token" },
    });
  }

  // Set emailVerified and delete the token atomically
  await db.$transaction(async (tx) => {
    await tx.user.updateMany({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    });
    await tx.verificationToken.delete({
      where: { token: tokenHash },
    });
  });

  // Activity trail (fire-and-forget; never blocks the redirect).
  void (async () => {
    const { recordActivity } = await import("@/lib/security/activity-log");
    const verified = await db.user.findUnique({
      where: { email: record.identifier },
      select: { id: true, organizationId: true },
    });
    if (verified) {
      await recordActivity({
        action: "email.verified",
        userId: verified.id,
        organizationId: verified.organizationId,
        req,
        path: "/api/public/verify-email",
        method: "GET",
      });
    }
  })().catch(() => {});

  // Send the user to /login with a success banner. Auto sign-in is not used:
  // verification completes out of band (they may click the link in another
  // device or browser), so we must never attach a session here.
  //
  // Relative Location: behind a reverse proxy, req.url / NEXTAUTH_URL can
  // resolve to localhost and emit a broken absolute redirect.
  return new NextResponse(null, {
    status: 307,
    headers: { Location: "/login?verified=true" },
  });
}
