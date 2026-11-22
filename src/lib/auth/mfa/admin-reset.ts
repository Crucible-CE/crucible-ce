// Administrator two-factor reset, shared by POST /api/admin/users/[id]/mfa-reset
// and the server recovery command (scripts/reset-password.ts --reset-mfa), so
// both remove the same things and leave the same trail.
//
// Removes every two-factor method (authenticator app, security keys, recovery
// codes, pending sign-ins), bumps tokenVersion so every session ends, drops
// live sockets, emails the member when email is configured, and audits it as
// user.mfa_reset. Callers check permissions and org scope first.

import { db } from "@/lib/db";
import { recordAdminAuditLog } from "@/lib/admin-audit";
import { recordActivity } from "@/lib/security/activity-log";
import { disconnectUserSockets } from "@/lib/socket/evict";
import { sendMfaResetEmail } from "@/lib/email/send-mfa-reset";
import { activeEmailTransport } from "@/lib/email/transport";
import { hasAnyFactor, loadFactors, removeAllMfa } from "./service";

export interface MfaResetTarget {
  id: string;
  email: string;
  name: string | null;
  role: string;
  organizationId: string;
}

export interface MfaResetActor {
  userId: string;
  email: string | null;
  name: string | null;
  /** Name for the member's email; null reads "An administrator". */
  label: string | null;
  /** Set for the server recovery command. */
  via?: "server_console";
}

export async function resetMemberMfa(target: MfaResetTarget, actor: MfaResetActor): Promise<{ hadMfa: boolean; emailSent: boolean }> {
  const had = await loadFactors(target.id);
  await removeAllMfa(target.id);
  await db.user.update({ where: { id: target.id }, data: { tokenVersion: { increment: 1 } } });
  disconnectUserSockets(target.id);

  const via = actor.via ? { via: actor.via } : {};
  void recordActivity({
    action: "mfa.reset_by_admin",
    userId: target.id,
    organizationId: target.organizationId,
    metadata: { actorUserId: actor.userId, ...via },
  });
  void recordActivity({
    action: "session.revoked",
    userId: target.id,
    organizationId: target.organizationId,
    metadata: { reason: "admin_mfa_reset", actorUserId: actor.userId, ...via },
  });

  let emailSent = false;
  try {
    await sendMfaResetEmail(target.email, target.name, actor.label);
    emailSent = activeEmailTransport() !== null;
  } catch (err) {
    console.error("[mfa-reset] could not email the member:", err instanceof Error ? err.message : err);
  }

  const hadMfa = hasAnyFactor(had);
  await recordAdminAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorName: actor.name,
    organizationId: target.organizationId,
    action: "user.mfa_reset",
    targetType: "user",
    targetId: target.id,
    targetLabel: target.email,
    metadata: { hadMfa, totp: had.totp, securityKeys: had.webauthnCount, targetRole: target.role, emailSent, ...via },
  });

  return { hadMfa, emailSent };
}
