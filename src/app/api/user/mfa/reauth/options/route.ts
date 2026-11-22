import { NextResponse } from "next/server";
import { mfaUser } from "@/lib/auth/mfa/http";
import { authenticationOptions } from "@/lib/auth/mfa/webauthn";

// POST /api/user/mfa/reauth/options — a WebAuthn challenge for "confirm it's
// you" with a security key (single use, 5 minutes).
export async function POST() {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const r = await authenticationOptions(ctx.user.id, "reauth");
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ options: r.options });
}
