import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email/send-verification";
import { sendEmailChangeCancelEmail } from "@/lib/email/send-email-change-cancel";
import { hashToken } from "@/lib/auth/verification-token";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { checkRateLimit } from "@/lib/security/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/user/email-change
// Initiates an email change:
//   1. Verifies current password.
//   2. Enforces 24h throttle (one change per account per day).
//   3. Swaps User.email → newEmail, marks unverified, bumps tokenVersion
//      (invalidates the current session).
//   4. Creates VerificationToken for the new address.
//   5. Creates EmailChangeRequest with a cancellation token for the old
//      address (7-day grace window).
//   6. Sends verification email to NEW address.
//   7. Sends cancel-link email to OLD address.
// ---------------------------------------------------------------------------

const schema = z.object({
  newEmail: z.string().email("Invalid email address").max(320),
  currentPassword: z.string().min(1, "Current password is required").max(LIMITS.PASSWORD),
});

const THROTTLE_WINDOW_MS = 24 * 60 * 60_000;
const CANCEL_GRACE_MS = 7 * 24 * 60 * 60_000;
const VERIFY_EXPIRY_MS = 24 * 60 * 60_000;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every attempt runs a bcrypt compare of the current password: throttle it
  // per account so a hijacked session can't brute-force the password here.
  const rl = await checkRateLimit({ namespace: "email-change:user", identifier: session.user.id, windowMs: 60 * 60_000, max: 5 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const newEmail = parsed.data.newEmail.toLowerCase().trim();
  const { currentPassword } = parsed.data;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      emailChangeRequest: {
        select: { createdAt: true },
      },
    },
  });

  if (!user || !user.passwordHash) {
    return NextResponse.json(
      { error: "This account has no password." },
      { status: 400 }
    );
  }

  // 1. Verify current password
  const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordValid) {
    return NextResponse.json(
      { error: "Current password is incorrect." },
      { status: 403 }
    );
  }

  // 2. No-op if same email
  if (newEmail === user.email.toLowerCase()) {
    return NextResponse.json(
      { error: "That's already your email." },
      { status: 400 }
    );
  }

  // 3. Throttle — 24h cooldown since last request
  if (user.emailChangeRequest) {
    const elapsed = Date.now() - user.emailChangeRequest.createdAt.getTime();
    if (elapsed < THROTTLE_WINDOW_MS) {
      const remaining = Math.ceil(
        (THROTTLE_WINDOW_MS - elapsed) / (60 * 60_000)
      );
      return NextResponse.json(
        {
          error: `You changed your email recently. Try again in ${remaining} hour(s).`,
        },
        { status: 429 }
      );
    }
  }

  // 4. New email must be available
  const collision = await db.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  // 5. Generate tokens
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const cancellationToken = crypto.randomBytes(32).toString("hex");
  const cancellationTokenHash = crypto
    .createHash("sha256")
    .update(cancellationToken)
    .digest("hex");

  const oldEmail = user.email;

  // 6. Persist atomically
  try {
    await db.$transaction(async (tx) => {
      // Clear any previous (expired) request row
      await tx.emailChangeRequest.deleteMany({
        where: { userId: user.id },
      });

      // Swap email + unverify + invalidate active JWTs
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: newEmail,
          emailVerified: null,
          tokenVersion: { increment: 1 },
        },
      });

      // Verification token for the new email. Plaintext is emailed to the
      // new address; only the SHA-256 digest is stored.
      await tx.verificationToken.create({
        data: {
          identifier: newEmail,
          token: hashToken(verificationToken),
          expires: new Date(Date.now() + VERIFY_EXPIRY_MS),
        },
      });

      // Cancellation row targeting the old email
      await tx.emailChangeRequest.create({
        data: {
          userId: user.id,
          oldEmail,
          newEmail,
          cancellationTokenHash,
          cancellationExpiresAt: new Date(Date.now() + CANCEL_GRACE_MS),
        },
      });
    });
  } catch (err) {
    console.error("[email-change] DB transaction failed:", err);
    return NextResponse.json(
      { error: "Couldn't change your email. Try again." },
      { status: 500 }
    );
  }

  // 7. Fire-and-forget emails (log errors; don't roll back the change)
  const displayName = user.name ?? "there";
  sendVerificationEmail(newEmail, displayName, verificationToken).catch(
    (err) => {
      console.error("[email-change] verification email failed:", {
        to: newEmail,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  );
  sendEmailChangeCancelEmail(
    oldEmail,
    displayName,
    newEmail,
    cancellationToken
  ).catch((err) => {
    console.error("[email-change] cancel-link email failed:", {
      to: oldEmail,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({
    success: true,
    newEmail,
    message:
      "Email updated. Verify it from your new inbox to sign in again.",
  });
}
