// MFA state in the database: which factors a user has, TOTP verification with
// replay protection, recovery codes, and wholesale removal (user turns MFA off,
// admin reset). See docs/authentication.md.

import { db } from "@/lib/db";
import { decryptTotpSecret, generateRecoveryCodes, hashRecoveryCode, RECOVERY_LOW_WATERMARK } from "./secrets";
import { verifyTotp } from "./totp";
import { hasMfaFrom, totpConfigured } from "./state";

export interface MfaFactors {
  totp: boolean;
  webauthnCount: number;
  recoveryRemaining: number;
}

export const hasAnyFactor = (f: Pick<MfaFactors, "totp" | "webauthnCount">): boolean => hasMfaFrom(f);

export async function loadFactors(userId: string): Promise<MfaFactors> {
  const [mfa, webauthnCount, recoveryRemaining] = await Promise.all([
    db.userMfa.findUnique({ where: { userId }, select: { totpEnabledAt: true, totpSecretEnc: true } }),
    db.webAuthnCredential.count({ where: { userId } }),
    db.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { totp: totpConfigured(mfa), webauthnCount, recoveryRemaining };
}

export async function userHasMfa(userId: string): Promise<boolean> {
  return hasAnyFactor(await loadFactors(userId));
}

/**
 * Verify a TOTP code for a user with an enabled authenticator app. On a match
 * the step counter is advanced ATOMICALLY (conditional update), so the same
 * code (or an older one) can't be used twice, even by two concurrent requests.
 */
export async function verifyUserTotp(userId: string, code: string, nowMs: number = Date.now()): Promise<boolean> {
  const row = await db.userMfa.findUnique({
    where: { userId },
    select: { totpSecretEnc: true, totpEnabledAt: true, totpLastCounter: true },
  });
  if (!row?.totpSecretEnc || !row.totpEnabledAt) return false;
  let secret: string;
  try {
    secret = decryptTotpSecret(userId, row.totpSecretEnc);
  } catch (err) {
    console.error("[mfa] could not decrypt a TOTP secret (MASTER_KEK changed?):", err instanceof Error ? err.message : err);
    return false;
  }
  const counter = verifyTotp(secret, code, { nowMs, lastCounter: row.totpLastCounter });
  if (counter === null) return false;
  const res = await db.userMfa.updateMany({
    where: { userId, OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: counter } }] },
    data: { totpLastCounter: counter },
  });
  return res.count === 1;
}

/** Spend one recovery code (atomic single use). */
export async function consumeRecoveryCode(userId: string, code: string): Promise<{ ok: boolean; remaining: number }> {
  const codeHash = hashRecoveryCode(userId, code);
  if (!codeHash) return { ok: false, remaining: -1 };
  const res = await db.mfaRecoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  const remaining = await db.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  return { ok: res.count === 1, remaining };
}

/** Replace every recovery code with a fresh set; returns the plaintext (shown once). */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const rows = codes.map((c) => ({ userId, codeHash: hashRecoveryCode(userId, c)! }));
  await db.$transaction([
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaRecoveryCode.createMany({ data: rows }),
    db.userMfa.upsert({
      where: { userId },
      create: { userId, recoveryGeneratedAt: new Date() },
      update: { recoveryGeneratedAt: new Date() },
    }),
  ]);
  return codes;
}

/** First factor enrolled: issue recovery codes if the user has none. */
export async function ensureRecoveryCodes(userId: string): Promise<string[] | null> {
  const existing = await db.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
  return existing > 0 ? null : issueRecoveryCodes(userId);
}

/** After removing a factor: with nothing left, MFA is off, so drop the recovery codes too. */
export async function cleanupIfNoFactors(userId: string): Promise<boolean> {
  const f = await loadFactors(userId);
  if (hasAnyFactor(f)) return false;
  await db.$transaction([
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.userMfa.updateMany({ where: { userId }, data: { recoveryGeneratedAt: null } }),
  ]);
  return true;
}

/** Remove every factor, code, pending enrollment and challenge (turn off / admin reset). */
export async function removeAllMfa(userId: string): Promise<void> {
  await db.$transaction([
    db.webAuthnCredential.deleteMany({ where: { userId } }),
    db.webAuthnChallenge.deleteMany({ where: { userId } }),
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaLoginTicket.deleteMany({ where: { userId } }),
    db.userMfa.deleteMany({ where: { userId } }),
  ]);
}

export const recoveryIsLow = (remaining: number): boolean => remaining <= RECOVERY_LOW_WATERMARK;

// ---- Database-backed failure cap (holds without Redis) ---------------------
// At most MFA_DB_FAILURE_CAP failed second-factor checks per user per window.
// A slot is RESERVED atomically before the check (conditional increment, so
// N concurrent requests can't all pass a check-then-act gate) and refunded
// when the check succeeds. Sign-ins from a valid known-device cookie don't
// use it (a password holder hammering the account can't lock its owner out
// of their own browser); the per-ticket cap still applies to them.

export const MFA_DB_FAILURE_CAP = 20;
export const MFA_DB_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Reserve one failure slot; false when the user's cap is used up for this window. */
export async function reserveMfaFailureSlot(userId: string, now: number = Date.now()): Promise<boolean> {
  await db.userMfa.upsert({ where: { userId }, create: { userId }, update: {} });
  // Open a fresh window if the last one expired (only one request wins this).
  await db.userMfa.updateMany({
    where: { userId, OR: [{ mfaFailWindowStart: null }, { mfaFailWindowStart: { lt: new Date(now - MFA_DB_FAILURE_WINDOW_MS) } }] },
    data: { mfaFailures: 0, mfaFailWindowStart: new Date(now) },
  });
  const r = await db.userMfa.updateMany({
    where: { userId, mfaFailures: { lt: MFA_DB_FAILURE_CAP } },
    data: { mfaFailures: { increment: 1 } },
  });
  return r.count === 1;
}

/** Give a reserved slot back (the check succeeded). */
export async function refundMfaFailureSlot(userId: string): Promise<void> {
  await db.userMfa.updateMany({ where: { userId, mfaFailures: { gt: 0 } }, data: { mfaFailures: { decrement: 1 } } });
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

class LastFactorError extends Error {}

/**
 * Remove one factor without racing the require-MFA last-factor rule: the
 * removal and the "is anything left?" check run in ONE transaction that holds
 * a row lock on the user, so two concurrent removals of different factors
 * can't both succeed and leave a funnelled account with nothing. Returns
 * "blocked" (and changes nothing) when the policy is on and no factor would
 * remain.
 */
export async function removeFactorGuarded(userId: string, remove: (tx: Tx) => Promise<unknown>): Promise<"ok" | "blocked"> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await remove(tx);
      const u = await tx.user.findUnique({ where: { id: userId }, select: { organization: { select: { requireMfa: true } } } });
      if (!u?.organization?.requireMfa) return;
      const [mfa, keys] = await Promise.all([
        tx.userMfa.findUnique({ where: { userId }, select: { totpEnabledAt: true, totpSecretEnc: true } }),
        tx.webAuthnCredential.count({ where: { userId } }),
      ]);
      if (!hasMfaFrom({ totp: totpConfigured(mfa), webauthnCount: keys })) throw new LastFactorError();
    });
    return "ok";
  } catch (err) {
    if (err instanceof LastFactorError) return "blocked";
    throw err;
  }
}
