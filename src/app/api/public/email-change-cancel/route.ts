import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/public/email-change-cancel?token=...
// Public endpoint hit from the cancel-link email sent to the OLD email.
// Reverts email to oldEmail, restores verified status, and bumps tokenVersion
// to kick any active session the attacker may have opened on the new email.
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/cancel-email-change?status=invalid", req.url)
    );
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const record = await db.emailChangeRequest.findUnique({
    where: { cancellationTokenHash: tokenHash },
    select: {
      id: true,
      userId: true,
      oldEmail: true,
      newEmail: true,
      cancellationExpiresAt: true,
    },
  });

  if (!record) {
    return NextResponse.redirect(
      new URL("/cancel-email-change?status=invalid", req.url)
    );
  }

  if (record.cancellationExpiresAt < new Date()) {
    // Clean up the expired row to keep the table tidy.
    await db.emailChangeRequest.delete({ where: { id: record.id } }).catch(() => {});
    return NextResponse.redirect(
      new URL("/cancel-email-change?status=expired", req.url)
    );
  }

  // Collision check — if someone already signed up using the oldEmail while
  // the cancellation window was open, we cannot safely revert.
  const collision = await db.user.findUnique({
    where: { email: record.oldEmail.toLowerCase() },
    select: { id: true },
  });
  if (collision && collision.id !== record.userId) {
    await db.emailChangeRequest.delete({ where: { id: record.id } }).catch(() => {});
    return NextResponse.redirect(
      new URL("/cancel-email-change?status=conflict", req.url)
    );
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        data: {
          email: record.oldEmail,
          emailVerified: new Date(),
          tokenVersion: { increment: 1 },
        },
      });
      // Nuke any VerificationTokens tied to the new email — those are stale.
      await tx.verificationToken.deleteMany({
        where: { identifier: record.newEmail },
      });
      await tx.emailChangeRequest.delete({ where: { id: record.id } });
    });
  } catch (err) {
    console.error("[email-change-cancel] DB transaction failed:", err);
    return NextResponse.redirect(
      new URL("/cancel-email-change?status=error", req.url)
    );
  }

  return NextResponse.redirect(
    new URL("/cancel-email-change?status=success", req.url)
  );
}
