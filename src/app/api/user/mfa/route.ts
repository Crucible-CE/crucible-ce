import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guardLastFactor, mfaUser, reauthExpiry, requireReauth } from "@/lib/auth/mfa/http";
import { hasAnyFactor, loadFactors, recoveryIsLow, removeAllMfa } from "@/lib/auth/mfa/service";
import { webauthnConfig } from "@/lib/auth/mfa/webauthn-config";
import { RECOVERY_CODE_COUNT } from "@/lib/auth/mfa/secrets";
import { recordActivity } from "@/lib/security/activity-log";

// GET /api/user/mfa — the signed-in user's two-factor status for Settings >
// Security and the require-MFA enrollment page.
export async function GET(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;

  const [mfa, creds, factors] = await Promise.all([
    db.userMfa.findUnique({ where: { userId: user.id }, select: { totpEnabledAt: true, recoveryGeneratedAt: true } }),
    db.webAuthnCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, createdAt: true, lastUsedAt: true, transports: true, deviceType: true, backedUp: true },
    }),
    loadFactors(user.id),
  ]);
  const cfg = webauthnConfig();
  const reauthUntil = reauthExpiry(req, user);

  return NextResponse.json({
    enabled: hasAnyFactor(factors),
    requireMfa: user.requireMfa,
    totp: { enabled: factors.totp, enabledAt: mfa?.totpEnabledAt?.toISOString() ?? null },
    webauthn: {
      available: cfg.available,
      reason: cfg.available ? null : cfg.reason,
      credentials: creds.map((c) => ({
        id: c.id,
        name: c.name,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
        transports: c.transports,
        // "multiDevice" = a synced passkey; "singleDevice" = a hardware key or device-bound passkey.
        kind: c.deviceType === "multiDevice" ? "passkey" : "security_key",
        backedUp: c.backedUp,
      })),
    },
    recovery: {
      remaining: factors.recoveryRemaining,
      total: RECOVERY_CODE_COUNT,
      generatedAt: mfa?.recoveryGeneratedAt?.toISOString() ?? null,
      low: hasAnyFactor(factors) && recoveryIsLow(factors.recoveryRemaining),
    },
    hasPassword: !!user.passwordHash,
    reauthUntil: reauthUntil ? new Date(reauthUntil).toISOString() : null,
  });
}

// DELETE /api/user/mfa — turn two-factor sign-in off entirely (every factor
// and recovery code). Needs a step-up grant; refused under the require-MFA policy.
export async function DELETE(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user) ?? guardLastFactor(user, 0);
  if (denied) return denied;

  await removeAllMfa(user.id);
  void recordActivity({ action: "mfa.disabled", userId: user.id, organizationId: user.organizationId, req, metadata: { method: "all" } });
  return NextResponse.json({ ok: true });
}
