// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mfaFind: vi.fn(),
  mfaUpdateMany: vi.fn(),
  codeUpdateMany: vi.fn(),
  codeCount: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    userMfa: { findUnique: h.mfaFind, updateMany: h.mfaUpdateMany },
    mfaRecoveryCode: { updateMany: h.codeUpdateMany, count: h.codeCount },
  },
}));

import { __resetDerivedKeysForTests } from "@/lib/crypto/org-crypto";
import { consumeRecoveryCode, verifyUserTotp } from "./service";
import { encryptTotpSecret, hashRecoveryCode } from "./secrets";
import { generateTotpSecret, totpAt, totpCounter } from "./totp";

const NOW = 1_760_000_000_000;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MASTER_KEK = "ab".repeat(32);
  __resetDerivedKeysForTests();
});

describe("verifyUserTotp", () => {
  it("accepts a valid code and advances the counter atomically (conditional update)", async () => {
    const secret = generateTotpSecret();
    h.mfaFind.mockResolvedValue({ totpSecretEnc: encryptTotpSecret("u1", secret), totpEnabledAt: new Date(), totpLastCounter: null });
    h.mfaUpdateMany.mockResolvedValue({ count: 1 });
    const c = totpCounter(NOW);
    expect(await verifyUserTotp("u1", totpAt(secret, c), NOW)).toBe(true);
    expect(h.mfaUpdateMany).toHaveBeenCalledWith({
      where: { userId: "u1", OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: c } }] },
      data: { totpLastCounter: c },
    });
  });

  it("a concurrent request that already advanced the counter wins; this one is a replay", async () => {
    const secret = generateTotpSecret();
    h.mfaFind.mockResolvedValue({ totpSecretEnc: encryptTotpSecret("u1", secret), totpEnabledAt: new Date(), totpLastCounter: null });
    h.mfaUpdateMany.mockResolvedValue({ count: 0 });
    expect(await verifyUserTotp("u1", totpAt(secret, totpCounter(NOW)), NOW)).toBe(false);
  });

  it("refuses a code already used (counter stored) and a disabled app", async () => {
    const secret = generateTotpSecret();
    const c = totpCounter(NOW);
    h.mfaFind.mockResolvedValueOnce({ totpSecretEnc: encryptTotpSecret("u1", secret), totpEnabledAt: new Date(), totpLastCounter: c });
    expect(await verifyUserTotp("u1", totpAt(secret, c), NOW)).toBe(false);
    expect(h.mfaUpdateMany).not.toHaveBeenCalled();
    h.mfaFind.mockResolvedValueOnce({ totpSecretEnc: encryptTotpSecret("u1", secret), totpEnabledAt: null, totpLastCounter: null });
    expect(await verifyUserTotp("u1", totpAt(secret, c), NOW)).toBe(false);
    h.mfaFind.mockResolvedValueOnce(null);
    expect(await verifyUserTotp("u1", totpAt(secret, c), NOW)).toBe(false);
  });
});

describe("consumeRecoveryCode", () => {
  it("marks exactly one unused code as used; a second use finds nothing", async () => {
    h.codeCount.mockResolvedValue(9);
    h.codeUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await consumeRecoveryCode("u1", "abcde-fghjk")).toEqual({ ok: true, remaining: 9 });
    expect(h.codeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1", codeHash: hashRecoveryCode("u1", "ABCDE-FGHJK"), usedAt: null } }),
    );
    expect((await consumeRecoveryCode("u1", "ABCDE-FGHJK")).ok).toBe(false);
  });

  it("malformed input never reaches the DB", async () => {
    expect(await consumeRecoveryCode("u1", "123456")).toEqual({ ok: false, remaining: -1 });
    expect(h.codeUpdateMany).not.toHaveBeenCalled();
  });
});
