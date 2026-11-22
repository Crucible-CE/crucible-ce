// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  hotp,
  totpAt,
  totpCounter,
  totpUri,
  verifyTotp,
} from "./totp";

// RFC 6238 Appendix B (SHA-1 seed "12345678901234567890"), last 6 of the 8 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    for (const [t, code] of RFC_VECTORS) expect(generateTotp(RFC_SECRET, t * 1000)).toBe(code);
  });

  it("matches the RFC 4226 HOTP vectors", () => {
    const key = Buffer.from("12345678901234567890", "ascii");
    expect([0, 1, 2, 3, 9].map((c) => hotp(key, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });

  it("base32 round-trips and tolerates case, spaces and padding", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    const enc = base32Encode(buf);
    expect(base32Decode(enc)).toEqual(buf);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, "$1 ") + "==")).toEqual(buf);
    expect(() => base32Decode("ABC1")).toThrow();
  });

  it("generates 160-bit secrets", () => {
    const s = generateTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it("accepts the current step and one step of skew either side, not two", () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const c = totpCounter(now);
    expect(verifyTotp(secret, totpAt(secret, c), { nowMs: now })).toBe(c);
    expect(verifyTotp(secret, totpAt(secret, c - 1), { nowMs: now })).toBe(c - 1);
    expect(verifyTotp(secret, totpAt(secret, c + 1), { nowMs: now })).toBe(c + 1);
    expect(verifyTotp(secret, totpAt(secret, c - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, c + 2), { nowMs: now })).toBeNull();
  });

  it("refuses a replay: a step at or below the last accepted counter", () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const c = totpCounter(now);
    const code = totpAt(secret, c);
    expect(verifyTotp(secret, code, { nowMs: now, lastCounter: c })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, c - 1), { nowMs: now, lastCounter: c - 1 })).toBeNull();
    // The next step is still fine after the previous one was used.
    expect(verifyTotp(secret, totpAt(secret, c + 1), { nowMs: now, lastCounter: c })).toBe(c + 1);
  });

  it("normalizes spaces/dashes and rejects malformed input", () => {
    const secret = generateTotpSecret();
    const now = 1_760_000_000_000;
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { nowMs: now })).not.toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a"]) expect(verifyTotp(secret, bad, { nowMs: now })).toBeNull();
    expect(verifyTotp("!!!", code, { nowMs: now })).toBeNull();
  });

  it("builds an otpauth URI", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "ada@example.com", "Crucible CE");
    expect(uri).toMatch(/^otpauth:\/\/totp\/Crucible%20CE%3Aada%40example\.com\?/);
    const params = new URL(uri.replace("otpauth:", "https:")).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ secret: "JBSWY3DPEHPK3PXP", issuer: "Crucible CE", digits: "6", period: "30", algorithm: "SHA1" });
  });
});
