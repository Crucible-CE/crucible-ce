import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { mfaUser } from "@/lib/auth/mfa/http";
import { decryptTotpSecret } from "@/lib/auth/mfa/secrets";
import { ensureRecoveryCodes } from "@/lib/auth/mfa/service";
import { verifyTotp } from "@/lib/auth/mfa/totp";
import { recordActivity } from "@/lib/security/activity-log";
import { peekRateLimit, recordRateLimitHit } from "@/lib/security/rate-limit";

// POST /api/user/mfa/totp/enable { code } — confirm enrollment with the first
// code from the app. Promotes the pending secret, records the code's step as
// used (no replay), and, when this is the account's first factor, issues the
// recovery codes (returned once).

const schema = z.object({ code: z.string().min(1).max(16) });
/** A pending secret from /setup is good for this long. */
const PENDING_MAX_AGE_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const limit = { namespace: "mfa-enroll:user", identifier: user.id, windowMs: 15 * 60 * 1000, max: 10 };
  const peek = await peekRateLimit(limit);
  if (!peek.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(peek.retryAfter) } });
  }

  const row = await db.userMfa.findUnique({
    where: { userId: user.id },
    select: { totpPendingSecretEnc: true, totpPendingCreatedAt: true, totpEnabledAt: true },
  });
  if (!row?.totpPendingSecretEnc || !row.totpPendingCreatedAt || Date.now() - row.totpPendingCreatedAt.getTime() > PENDING_MAX_AGE_MS) {
    return NextResponse.json({ error: "Setup expired. Start again.", code: "setup_expired" }, { status: 400 });
  }
  const secret = decryptTotpSecret(user.id, row.totpPendingSecretEnc);
  const counter = verifyTotp(secret, parsed.data.code);
  if (counter === null) {
    await recordRateLimitHit(limit);
    return NextResponse.json({ error: "That code didn't work. Check your phone's clock and try again." }, { status: 400 });
  }

  const now = new Date();
  // Conditional on the pending secret we verified, so two racing confirms can't both apply.
  const upd = await db.userMfa.updateMany({
    where: { userId: user.id, totpPendingSecretEnc: row.totpPendingSecretEnc },
    data: {
      totpSecretEnc: row.totpPendingSecretEnc,
      totpEnabledAt: now,
      totpLastCounter: counter,
      totpPendingSecretEnc: null,
      totpPendingCreatedAt: null,
    },
  });
  if (upd.count !== 1) return NextResponse.json({ error: "Setup expired. Start again.", code: "setup_expired" }, { status: 400 });

  const recoveryCodes = await ensureRecoveryCodes(user.id);
  void recordActivity({
    action: "mfa.enabled",
    userId: user.id,
    organizationId: user.organizationId,
    req,
    metadata: { method: "totp", replaced: !!row.totpEnabledAt },
  });
  return NextResponse.json({ ok: true, recoveryCodes }, { headers: { "Cache-Control": "no-store" } });
}
