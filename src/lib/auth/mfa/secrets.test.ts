// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { __resetDerivedKeysForTests } from "@/lib/crypto/org-crypto";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "./secrets";

beforeEach(() => {
  process.env.MASTER_KEK = "ab".repeat(32);
  __resetDerivedKeysForTests();
});

describe("TOTP secret encryption (MASTER_KEK, HKDF mfa-totp-v1)", () => {
  it("round-trips and never stores the plaintext", () => {
    const enc = encryptTotpSecret("u1", "JBSWY3DPEHPK3PXP");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret("u1", enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptTotpSecret("u1", "JBSWY3DPEHPK3PXP")).not.toBe(enc); // fresh IV
  });

  it("is bound to the user (AAD) and detects tampering", () => {
    const enc = encryptTotpSecret("u1", "JBSWY3DPEHPK3PXP");
    expect(() => decryptTotpSecret("u2", enc)).toThrow();
    const raw = Buffer.from(enc.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptTotpSecret("u1", "v1:" + raw.toString("base64"))).toThrow();
  });

  it("fails under a different master key", () => {
    const enc = encryptTotpSecret("u1", "JBSWY3DPEHPK3PXP");
    process.env.MASTER_KEK = "cd".repeat(32);
    __resetDerivedKeysForTests();
    expect(() => decryptTotpSecret("u1", enc)).toThrow();
  });
});

describe("recovery codes", () => {
  it("issues 10 unique XXXXX-XXXXX codes without ambiguous characters", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  });

  it("hashes are keyed per user and insensitive to case and separators", () => {
    const [code] = generateRecoveryCodes(1);
    const h = hashRecoveryCode("u1", code)!;
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode("u1", code.toLowerCase().replace("-", " "))).toBe(h);
    expect(hashRecoveryCode("u2", code)).not.toBe(h);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "123456", "ABCDE-ABCD", "ABCDE-ABCDEF", "ABCDE-0BCDE", "ABCDE-IBCDE"]) {
      expect(normalizeRecoveryCode(bad)).toBeNull();
      expect(hashRecoveryCode("u1", bad)).toBeNull();
    }
  });
});
