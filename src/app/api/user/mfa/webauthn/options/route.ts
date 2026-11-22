import { NextResponse } from "next/server";
import { mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { registrationOptions } from "@/lib/auth/mfa/webauthn";

// POST /api/user/mfa/webauthn/options — registration options (and a stored,
// single-use challenge) for adding a security key or passkey. Needs a step-up grant.
export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;
  const r = await registrationOptions(user);
  if (!r.ok) return NextResponse.json({ error: r.reason, code: "webauthn_unavailable" }, { status: 400 });
  return NextResponse.json({ options: r.options });
}
