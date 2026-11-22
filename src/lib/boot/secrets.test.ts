// @vitest-environment node
import { describe, it, expect } from "vitest";
import { decodeKek, formatSecretProblems, validateBootSecrets } from "./secrets";

const STRONG_SECRET = "q3T0yV8cJ2pXn5Lr9wZbH4kD7mF1sA6eG0uYtR2iO8E="; // 44 chars, base64-ish
const HEX_KEK = "a1".repeat(32); // 64 hex chars -> 32 bytes
const B64_KEK = Buffer.alloc(32, 7).toString("base64"); // 44 chars -> 32 bytes
const ZERO_KEK = "0".repeat(64);

const good = { NEXTAUTH_SECRET: STRONG_SECRET, MASTER_KEK: HEX_KEK };

describe("validateBootSecrets — auth secret", () => {
  it("accepts a strong NEXTAUTH_SECRET + valid KEK", () => {
    expect(validateBootSecrets(good)).toEqual([]);
  });

  it("accepts AUTH_SECRET alone", () => {
    expect(validateBootSecrets({ AUTH_SECRET: STRONG_SECRET, MASTER_KEK: HEX_KEK })).toEqual([]);
  });

  it("requires at least one of NEXTAUTH_SECRET / AUTH_SECRET", () => {
    const problems = validateBootSecrets({ MASTER_KEK: HEX_KEK });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXTAUTH_SECRET \(or AUTH_SECRET\) is not set/);
  });

  it("treats blank values as unset", () => {
    expect(validateBootSecrets({ NEXTAUTH_SECRET: "   ", MASTER_KEK: HEX_KEK })[0]).toMatch(/not set/);
  });

  it("refuses a secret shorter than 32 chars", () => {
    const problems = validateBootSecrets({ ...good, NEXTAUTH_SECRET: "a".repeat(31) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXTAUTH_SECRET is too short \(31 chars/);
  });

  it.each([
    "change-me-generate-with-openssl-rand-base64-32", // .env.example
    "CHANGE-ME-this-is-a-very-long-secret-value-0001",
    "ci-placeholder-secret-padded-out-to-32-chars-xx", // CI / Dockerfile build stage
    "replace-me-with-a-long-random-string-0123456789",
  ])("refuses the placeholder %s", (value) => {
    const problems = validateBootSecrets({ ...good, NEXTAUTH_SECRET: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/NEXTAUTH_SECRET is still a template placeholder/);
  });

  it("checks every auth secret that is set (a weak AUTH_SECRET alongside a strong NEXTAUTH_SECRET fails)", () => {
    const problems = validateBootSecrets({ ...good, AUTH_SECRET: "short" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^AUTH_SECRET is too short/);
  });
});

describe("validateBootSecrets — MASTER_KEK", () => {
  it("requires MASTER_KEK", () => {
    const problems = validateBootSecrets({ NEXTAUTH_SECRET: STRONG_SECRET });
    expect(problems).toEqual([expect.stringMatching(/MASTER_KEK is not set/)]);
  });

  it("does not accept the removed FIELD_ENCRYPTION_KEY alias", () => {
    const problems = validateBootSecrets({ NEXTAUTH_SECRET: STRONG_SECRET, FIELD_ENCRYPTION_KEY: HEX_KEK });
    expect(problems).toEqual([expect.stringMatching(/MASTER_KEK is not set/)]);
  });

  it("accepts a base64 32-byte key", () => {
    expect(validateBootSecrets({ ...good, MASTER_KEK: B64_KEK })).toEqual([]);
  });

  it("refuses the .env.example placeholder", () => {
    const problems = validateBootSecrets({ ...good, MASTER_KEK: "generate-with-openssl-rand-hex-32" });
    expect(problems).toEqual([expect.stringMatching(/MASTER_KEK is still a template placeholder/)]);
  });

  it("refuses a key that does not decode to 32 bytes", () => {
    expect(validateBootSecrets({ ...good, MASTER_KEK: "a1".repeat(16) })[0]).toMatch(/exactly 32 bytes/);
    expect(validateBootSecrets({ ...good, MASTER_KEK: Buffer.alloc(24).toString("base64") })[0]).toMatch(
      /exactly 32 bytes/,
    );
  });

  it("refuses 64 chars that are not valid hex", () => {
    expect(validateBootSecrets({ ...good, MASTER_KEK: "zz" + "a".repeat(62) })[0]).toMatch(/exactly 32 bytes/);
  });

  it("refuses an all-zero key in production only", () => {
    expect(validateBootSecrets({ ...good, MASTER_KEK: ZERO_KEK, NODE_ENV: "production" })).toEqual([
      expect.stringMatching(/all zeros/),
    ]);
    expect(validateBootSecrets({ ...good, MASTER_KEK: ZERO_KEK, NODE_ENV: "development" })).toEqual([]);
  });

  it("reports every problem at once", () => {
    expect(validateBootSecrets({ NODE_ENV: "production" })).toHaveLength(2);
  });
});

describe("decodeKek", () => {
  it("decodes 64 chars as hex and anything else as base64", () => {
    expect(decodeKek(HEX_KEK)?.length).toBe(32);
    expect(decodeKek(B64_KEK)?.length).toBe(32);
    expect(decodeKek("g".repeat(64))).toBeNull();
  });
});

describe("formatSecretProblems", () => {
  it("renders a FATAL header and one bullet per problem", () => {
    const out = formatSecretProblems(["one", "two"]);
    expect(out).toMatch(/^\[server\] FATAL/);
    expect(out).toContain("  - one");
    expect(out).toContain("  - two");
  });
});
