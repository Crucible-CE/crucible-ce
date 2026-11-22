import { NextResponse } from "next/server";
import { guardLastFactor, mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { cleanupIfNoFactors, loadFactors, removeFactorGuarded } from "@/lib/auth/mfa/service";
import { recordActivity } from "@/lib/security/activity-log";

// DELETE /api/user/mfa/totp — remove the authenticator app. Needs a step-up
// grant (password + a current code or recovery code). Refused when it is the
// last factor and the org requires MFA. With no factor left, the recovery
// codes go too (two-factor is off).
export async function DELETE(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;

  const f = await loadFactors(user.id);
  if (!f.totp) return NextResponse.json({ error: "No authenticator app is set up." }, { status: 404 });
  const blocked = guardLastFactor(user, f.webauthnCount);
  if (blocked) return blocked;

  // Remove + re-check in one locked transaction (no race with a parallel removal).
  const result = await removeFactorGuarded(user.id, (tx) =>
    tx.userMfa.update({
      where: { userId: user.id },
      data: { totpSecretEnc: null, totpEnabledAt: null, totpLastCounter: null, totpPendingSecretEnc: null, totpPendingCreatedAt: null },
    }),
  );
  if (result === "blocked") return guardLastFactor({ requireMfa: true }, 0)!;
  const off = await cleanupIfNoFactors(user.id);
  void recordActivity({ action: "mfa.disabled", userId: user.id, organizationId: user.organizationId, req, metadata: { method: "totp", mfaOff: off } });
  return NextResponse.json({ ok: true, mfaOff: off });
}
