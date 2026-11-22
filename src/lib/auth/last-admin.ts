// Last-admin lockout guard (#13). Every path that can take an ACTIVE
// administrator out of the admin pool — PATCH (demote / deactivate), DELETE,
// bulk deactivate — takes the SAME per-org transaction-scoped advisory lock
// before counting the remaining admins and applying the change, so two admins
// removing each other concurrently serialize and the org can never end up
// with no active administrator.

import type { Prisma } from "@prisma/client";

type LockClient = Pick<Prisma.TransactionClient, "$executeRaw" | "user">;

/** Take the per-org last-admin advisory lock (released at transaction end). */
export async function acquireLastAdminLock(tx: LockClient, organizationId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"last-admin:" + organizationId}, 0))`;
}

/**
 * Under the lock: how many ACTIVE administrators remain in the org once
 * `excludeUserIds` are removed from the pool?
 */
export async function countRemainingActiveAdmins(
  tx: LockClient,
  organizationId: string,
  excludeUserIds: string[],
): Promise<number> {
  return tx.user.count({
    where: {
      organizationId,
      role: "administrator",
      isActive: true,
      id: { notIn: excludeUserIds },
    },
  });
}
