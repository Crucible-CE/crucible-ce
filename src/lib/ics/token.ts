// Stored, revocable tokens for the public ICS subscription feed.
//
// Each token belongs to ONE user and ONE incident. Only its SHA-256 is stored
// (IcsFeedToken.tokenHash). A feed request is honoured only while:
//   - the token row exists, matches the incident, and is not revoked;
//   - the owning user is still active; and
//   - that user can STILL see the incident (lock / participant rules, via
//     findAccessibleIncident) — so removing someone from a locked incident or
//     deactivating them kills their feed even before the explicit revoke.
// Copying a fresh link revokes the user's previous link for that incident
// (one live link per user per incident).

import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sha256Hex } from "@/lib/crypto/hash";
import { findAccessibleIncident } from "@/lib/incident/access";

/** Mint a fresh feed token for (user, incident), revoking their older ones. */
export async function mintIcsToken(args: { organizationId: string; incidentId: string; userId: string }): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  await db.$transaction([
    db.icsFeedToken.updateMany({
      where: { incidentId: args.incidentId, userId: args.userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    db.icsFeedToken.create({
      data: {
        organizationId: args.organizationId,
        incidentId: args.incidentId,
        userId: args.userId,
        tokenHash: sha256Hex(token),
      },
    }),
  ]);
  return token;
}

/**
 * Resolve a presented feed token. True only when the token is live, belongs to
 * this incident, and its owner is active and can still see the incident.
 */
export async function verifyIcsToken(incidentId: string, token: string): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const row = await db.icsFeedToken.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: {
      id: true,
      incidentId: true,
      revokedAt: true,
      user: { select: { id: true, organizationId: true, role: true, isActive: true } },
    },
  });
  if (!row || row.revokedAt || row.incidentId !== incidentId) return false;
  if (!row.user?.isActive) return false;
  const visible = await findAccessibleIncident(row.user, incidentId, { id: true });
  if (!visible) return false;
  await db.icsFeedToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return true;
}

/** Revoke a user's feed tokens (optionally only for one incident). Never throws. */
export async function revokeIcsTokens(where: { userId: string; incidentId?: string }): Promise<number> {
  try {
    const res = await db.icsFeedToken.updateMany({
      where: { userId: where.userId, ...(where.incidentId ? { incidentId: where.incidentId } : {}), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  } catch (err) {
    console.error("[ics] token revoke failed:", err);
    return 0;
  }
}
