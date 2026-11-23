import { NextResponse } from "next/server";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { ensureRecoveryCodes } from "@/lib/auth/mfa/service";
import { CREDENTIAL_NAME_MAX, verifyRegistration } from "@/lib/auth/mfa/webauthn";
import { recordActivity } from "@/lib/security/activity-log";

// POST /api/user/mfa/webauthn { name, response } — finish adding a security
// key / passkey: verifies the attestation against the stored challenge (single
// use), saves the credential, and issues recovery codes if this is the
// account's first factor (returned once). Needs a step-up grant.

const schema = z.object({
  name: z.string().trim().min(1).max(CREDENTIAL_NAME_MAX),
  response: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;
  const parsed = await parseJsonBody(req, schema);
  if (!parsed.ok) return parsed.response;

  const r = await verifyRegistration(user.id, parsed.data.response as unknown as RegistrationResponseJSON, parsed.data.name);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });

  const recoveryCodes = await ensureRecoveryCodes(user.id);
  void recordActivity({
    action: "mfa.enabled",
    userId: user.id,
    organizationId: user.organizationId,
    req,
    metadata: { method: "webauthn", credentialId: r.credential.id },
  });
  return NextResponse.json(
    { ok: true, credential: { id: r.credential.id, name: r.credential.name, createdAt: r.credential.createdAt.toISOString() }, recoveryCodes },
    { headers: { "Cache-Control": "no-store" } },
  );
}
