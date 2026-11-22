// Org-wide two-factor status for administrators: who has MFA (Members page),
// how many active members don't (readiness, policy card).

import { db } from "@/lib/db";
import { TOTP_CONFIGURED_WHERE } from "./state";
import { disconnectUserSockets } from "@/lib/socket/evict";

export interface MemberMfaStatus {
  totp: boolean;
  securityKeys: number;
}

/** Per-user factor summary for the given users (missing = no MFA). */
export async function memberMfaStatus(userIds: string[]): Promise<Map<string, MemberMfaStatus>> {
  const out = new Map<string, MemberMfaStatus>();
  if (userIds.length === 0) return out;
  const [totpRows, keyRows] = await Promise.all([
    db.userMfa.findMany({ where: { userId: { in: userIds }, ...TOTP_CONFIGURED_WHERE }, select: { userId: true } }),
    db.webAuthnCredential.groupBy({ by: ["userId"], where: { userId: { in: userIds } }, _count: { _all: true } }),
  ]);
  for (const r of totpRows) out.set(r.userId, { totp: true, securityKeys: 0 });
  for (const r of keyRows) {
    const prev = out.get(r.userId) ?? { totp: false, securityKeys: 0 };
    out.set(r.userId, { ...prev, securityKeys: r._count._all });
  }
  return out;
}

const withoutMfa = (organizationId: string) => ({
  organizationId,
  isActive: true,
  NOT: { mfa: { is: TOTP_CONFIGURED_WHERE } },
  webauthnCreds: { none: {} },
});

/** Active members of the org with no two-factor method. */
export async function countMembersWithoutMfa(organizationId: string): Promise<number> {
  return db.user.count({ where: withoutMfa(organizationId) });
}

/**
 * The require-MFA policy was just turned on: end every session of the active
 * members who have no two-factor method yet (tokenVersion bump + socket
 * eviction), so they sign in again and land on the enrollment page. Returns
 * the ids of the members signed out.
 */
export async function signOutMembersWithoutMfa(organizationId: string, exceptUserId: string): Promise<string[]> {
  const rows = await db.user.findMany({ where: { ...withoutMfa(organizationId), id: { not: exceptUserId } }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return ids;
  await db.user.updateMany({ where: { id: { in: ids } }, data: { tokenVersion: { increment: 1 } } });
  for (const id of ids) disconnectUserSockets(id);
  return ids;
}
