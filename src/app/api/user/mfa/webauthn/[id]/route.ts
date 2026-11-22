import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { guardLastFactor, mfaUser, requireReauth } from "@/lib/auth/mfa/http";
import { cleanupIfNoFactors, loadFactors, removeFactorGuarded } from "@/lib/auth/mfa/service";
import { CREDENTIAL_NAME_MAX } from "@/lib/auth/mfa/webauthn";
import { recordActivity } from "@/lib/security/activity-log";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const renameSchema = z.object({ name: z.string().trim().min(1).max(CREDENTIAL_NAME_MAX) });

async function ownCredential(userId: string, id: string) {
  const cred = await db.webAuthnCredential.findUnique({ where: { id }, select: { id: true, userId: true, name: true } });
  return cred && cred.userId === userId ? cred : null;
}

// PATCH /api/user/mfa/webauthn/[id] { name } — rename a security key.
export async function PATCH(req: Request, context: RouteContext) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;
  const parsed = await parseJsonBody(req, renameSchema);
  if (!parsed.ok) return parsed.response;
  if (!(await ownCredential(ctx.user.id, id))) return NextResponse.json({ error: "Security key not found" }, { status: 404 });
  await db.webAuthnCredential.update({ where: { id }, data: { name: parsed.data.name } });
  return NextResponse.json({ ok: true, name: parsed.data.name });
}

// DELETE /api/user/mfa/webauthn/[id] — remove a security key. Needs a recent
// step-up grant; refused when it is the last factor and the org requires MFA.
export async function DELETE(req: Request, context: RouteContext) {
  const ctx = await mfaUser();
  if (!ctx.ok) return ctx.response;
  const { user } = ctx;
  const denied = requireReauth(req, user);
  if (denied) return denied;
  const { id } = await context.params;
  const cred = await ownCredential(user.id, id);
  if (!cred) return NextResponse.json({ error: "Security key not found" }, { status: 404 });

  const f = await loadFactors(user.id);
  const blocked = guardLastFactor(user, (f.totp ? 1 : 0) + f.webauthnCount - 1);
  if (blocked) return blocked;

  // Remove + re-check in one locked transaction (no race with a parallel removal).
  const result = await removeFactorGuarded(user.id, (tx) => tx.webAuthnCredential.delete({ where: { id } }));
  if (result === "blocked") return guardLastFactor({ requireMfa: true }, 0)!;
  const off = await cleanupIfNoFactors(user.id);
  void recordActivity({
    action: "mfa.disabled",
    userId: user.id,
    organizationId: user.organizationId,
    req,
    metadata: { method: "webauthn", credentialId: id, mfaOff: off },
  });
  return NextResponse.json({ ok: true, mfaOff: off });
}
