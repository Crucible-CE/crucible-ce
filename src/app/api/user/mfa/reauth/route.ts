import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { LIMITS } from "@/lib/http/limits";
import { grantReauth, mfaUser } from "@/lib/auth/mfa/http";
import { reserveFactorAttempt } from "@/lib/auth/mfa/attempts";
import { consumeRecoveryCode, hasAnyFactor, loadFactors, verifyUserTotp } from "@/lib/auth/mfa/service";
import { normalizeRecoveryCode } from "@/lib/auth/mfa/secrets";
import { verifyAuthentication } from "@/lib/auth/mfa/webauthn";
import { ipFromRequest } from "@/lib/security/rate-limit";

// POST /api/user/mfa/reauth — "confirm it's you". Re-enter the password and,
// when two-factor is on, a current authenticator code, a recovery code or a
// security-key assertion. Success sets a 5-minute step-up grant cookie that
// sensitive changes require (add/remove a factor, regenerate recovery codes,
// turn MFA off; admin MFA reset, reset link, require-MFA policy).
//
// Each attempt is reserved BEFORE the password / factor check (database cap
// per user that holds without Redis, plus Redis per user+IP and per IP) and
// refunded only on success (lib/auth/mfa/attempts.ts).

const schema = z.object({
  password: z.string().min(1).max(LIMITS.PASSWORD),
  code: z.string().max(64).optional(),
  webauthn: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;
  const { password, code, webauthn } = parsed.data;

  if (!user.passwordHash) {
    return NextResponse.json({ error: "This account has no password to confirm." }, { status: 400 });
  }
  const factors = await loadFactors(user.id);
  const needsFactor = hasAnyFactor(factors);
  if (needsFactor && !webauthn && !code) {
    return NextResponse.json(
      { error: "Enter a code or use your security key.", code: "factor_required" },
      { status: 400 },
    );
  }

  const attempt = await reserveFactorAttempt({ scope: "reauth", userId: user.id, ip: ipFromRequest(req), deviceKey: null });
  if (!attempt.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": "900" } });
  }

  let ok = await bcrypt.compare(password, user.passwordHash);
  let error = "Incorrect password.";
  if (ok && needsFactor) {
    if (webauthn) {
      ok = (await verifyAuthentication(user.id, webauthn as unknown as AuthenticationResponseJSON, "reauth")).ok;
    } else if (code && normalizeRecoveryCode(code)) {
      ok = (await consumeRecoveryCode(user.id, code)).ok;
    } else {
      ok = await verifyUserTotp(user.id, code ?? "");
    }
    if (!ok) error = "That code didn't work. Try again.";
  }
  await attempt.finish(ok);
  if (!ok) return NextResponse.json({ error }, { status: 400 });

  return grantReauth(req, user) ?? NextResponse.json({ error: "Server misconfigured: AUTH_SECRET is not set." }, { status: 500 });
}
