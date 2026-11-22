import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { encryptTotpSecret } from "@/lib/auth/mfa/secrets";
import { formatSecretForDisplay, generateTotpSecret, totpUri } from "@/lib/auth/mfa/totp";

// "Crucible CE (crucible.example.com)": tells two installs apart in the app.
function issuer(): string {
  for (const v of [process.env.PUBLIC_URL, process.env.AUTH_URL, process.env.NEXTAUTH_URL]) {
    try {
      if (v?.trim()) return `Crucible CE (${new URL(v.trim()).host})`;
    } catch {
      // try the next one
    }
  }
  return "Crucible CE";
}

// POST /api/user/mfa/totp/setup — start authenticator-app enrollment: a fresh
// secret (stored encrypted as PENDING, so an existing app keeps working until
// the new one is confirmed), returned once as a QR code (rendered here, a
// data: URL) and as the manual-entry key. Needs a step-up grant.
export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;

  const secret = generateTotpSecret();
  const enc = encryptTotpSecret(user.id, secret);
  await db.userMfa.upsert({
    where: { userId: user.id },
    create: { userId: user.id, totpPendingSecretEnc: enc, totpPendingCreatedAt: new Date() },
    update: { totpPendingSecretEnc: enc, totpPendingCreatedAt: new Date() },
  });

  const ISSUER = issuer();
  const uri = totpUri(secret, user.email, ISSUER);
  const qrDataUrl = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 232 });
  return NextResponse.json(
    { secret, secretDisplay: formatSecretForDisplay(secret), qrDataUrl, issuer: ISSUER, account: user.email },
    { headers: { "Cache-Control": "no-store" } },
  );
}
