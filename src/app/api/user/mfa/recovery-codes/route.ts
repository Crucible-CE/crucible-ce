import { NextResponse } from "next/server";
import { mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { hasAnyFactor, issueRecoveryCodes, loadFactors } from "@/lib/auth/mfa/service";
import { recordActivity } from "@/lib/security/activity-log";

// POST /api/user/mfa/recovery-codes — replace every recovery code with a new
// set of 10 (the old ones stop working). Needs a step-up grant (password +
// a factor). The plaintext is returned once.
export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;
  if (!hasAnyFactor(await loadFactors(user.id))) {
    return NextResponse.json({ error: "Turn on two-factor sign-in first." }, { status: 400 });
  }
  const recoveryCodes = await issueRecoveryCodes(user.id);
  void recordActivity({ action: "mfa.recovery_regenerated", userId: user.id, organizationId: user.organizationId, req });
  return NextResponse.json({ ok: true, recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}
