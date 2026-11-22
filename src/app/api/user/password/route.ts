import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { recordActivity } from "@/lib/security/activity-log";
import { ipFromRequest, peekRateLimit, recordRateLimitHit } from "@/lib/security/rate-limit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(LIMITS.PASSWORD).optional(),
    newPassword: z.string().min(8, "New password must be at least 8 characters").max(128),
    confirmPassword: z.string().min(1, "Password confirmation is required").max(LIMITS.PASSWORD),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

const CURRENT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
function currentPasswordLimits(userId: string, ip: string) {
  return [
    { namespace: "password-change:user", identifier: userId, windowMs: CURRENT_PASSWORD_WINDOW_MS, max: 5 },
    { namespace: "password-change:ip", identifier: ip, windowMs: CURRENT_PASSWORD_WINDOW_MS, max: 20 },
  ];
}

// POST /api/user/password
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parseJsonBody(req, changePasswordSchema);
  if (!parsed.ok) return parsed.response;

  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      passwordHash: true,
      organizationId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // The current password must match (an account without one sets its first).
  if (user.passwordHash) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Enter your current password." },
        { status: 400 }
      );
    }
    // A stolen session must not become an offline-speed oracle for the
    // current password: cap FAILED checks per user and per client IP.
    const limits = currentPasswordLimits(user.id, ipFromRequest(req));
    const peeks = await Promise.all(limits.map((l) => peekRateLimit(l)));
    const blocked = peeks.find((p) => !p.allowed);
    if (blocked) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(blocked.retryAfter) } }
      );
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      await Promise.all(limits.map((l) => recordRateLimitHit(l)));
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 400 }
      );
    }
  }

  const newHash = await bcrypt.hash(newPassword, 12);

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newHash,
      tokenVersion: { increment: 1 },
    },
  });

  void recordActivity({
    action: "password.changed",
    userId: user.id,
    organizationId: user.organizationId,
    req,
    path: "/api/user/password",
    method: "POST",
  });
  // The tokenVersion bump above revokes every other session.
  void recordActivity({
    action: "session.revoked",
    userId: user.id,
    organizationId: user.organizationId,
    metadata: { reason: "password_changed" },
  });

  return NextResponse.json({ ok: true, message: "Password updated" });
}
