// The ONE definition of "this account has two-factor on" and "this account is
// behind the sign-in wall", shared by the Auth.js jwt() re-validation, the
// Socket.io handshake, loadFactors() and the org-wide counts. Pure (no DB
// import) so every caller selects the same columns and derives the same answer.

import { mfaEnrollRequired } from "./policy";

/** An authenticator app counts only when it is confirmed AND has a secret. */
export function totpConfigured(row: { totpEnabledAt: Date | null; totpSecretEnc: string | null } | null | undefined): boolean {
  return !!row?.totpEnabledAt && !!row.totpSecretEnc;
}

export function hasMfaFrom(input: { totp: boolean; webauthnCount: number }): boolean {
  return input.totp || input.webauthnCount > 0;
}

/** Prisma `where` for "has an authenticator app" (mirrors totpConfigured). */
export const TOTP_CONFIGURED_WHERE = { totpEnabledAt: { not: null }, totpSecretEnc: { not: null } } as const;

/** Columns (Prisma select on User) needed to derive the sign-in wall. */
export const WALL_SELECT = {
  organization: { select: { requireMfa: true } },
  mfa: { select: { totpEnabledAt: true, totpSecretEnc: true } },
  _count: { select: { webauthnCreds: true } },
} as const;

export interface WallRow {
  organization: { requireMfa: boolean } | null;
  mfa: { totpEnabledAt: Date | null; totpSecretEnc: string | null } | null;
  _count: { webauthnCreds: number };
}

export function wallsFromRow(u: WallRow): { hasMfa: boolean; mfaEnrollRequired: boolean } {
  const hasMfa = hasMfaFrom({ totp: totpConfigured(u.mfa), webauthnCount: u._count.webauthnCreds });
  return {
    hasMfa,
    mfaEnrollRequired: mfaEnrollRequired({ requireMfa: u.organization?.requireMfa ?? false, hasMfa }),
  };
}
