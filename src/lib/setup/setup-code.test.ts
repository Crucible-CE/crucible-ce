// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SETUP_CODE_ALPHABET,
  ensureSetupCode,
  formatSetupCodeBanner,
  generateSetupCode,
  hasActiveSetupCode,
  hashSetupCode,
  invalidateSetupCode,
  issueSetupCode,
  normalizeSetupCode,
  verifySetupCode,
} from "./setup-code";

const FORMAT = new RegExp(`^[${SETUP_CODE_ALPHABET}]{4}(-[${SETUP_CODE_ALPHABET}]{4}){3}$`);

beforeEach(() => {
  invalidateSetupCode();
});

describe("generateSetupCode", () => {
  it("produces XXXX-XXXX-XXXX-XXXX from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) expect(generateSetupCode()).toMatch(FORMAT);
  });

  it("never uses ambiguous characters", () => {
    expect(SETUP_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("is random (no repeats across many draws)", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateSetupCode()));
    expect(seen.size).toBe(200);
  });
});

describe("normalizeSetupCode / hashSetupCode", () => {
  it("uppercases and strips spaces and dashes", () => {
    expect(normalizeSetupCode(" abcd-efgh ijkm\tnpqr ")).toBe("ABCDEFGHIJKMNPQR");
  });

  it("hashes the normalized form (sha256 hex)", () => {
    expect(hashSetupCode("abcd-efgh")).toBe(hashSetupCode("ABCDEFGH"));
    expect(hashSetupCode("ABCDEFGH")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("issue / verify / invalidate", () => {
  it("has no active code until one is issued", () => {
    expect(hasActiveSetupCode()).toBe(false);
    expect(verifySetupCode("ABCD-EFGH-JKMN-PQRS")).toBe(false);
  });

  it("verifies the issued code and rejects others", () => {
    const code = issueSetupCode();
    expect(hasActiveSetupCode()).toBe(true);
    expect(verifySetupCode(code)).toBe(true);
    expect(verifySetupCode(code.replace(/^./, (c) => (c === "A" ? "B" : "A")))).toBe(false);
    expect(verifySetupCode("")).toBe(false);
    expect(verifySetupCode(" - ")).toBe(false);
    expect(verifySetupCode(undefined)).toBe(false);
    expect(verifySetupCode(null)).toBe(false);
  });

  it("accepts the code lowercased, without dashes, or with spaces", () => {
    const code = issueSetupCode();
    expect(verifySetupCode(code.toLowerCase())).toBe(true);
    expect(verifySetupCode(code.replace(/-/g, ""))).toBe(true);
    expect(verifySetupCode(` ${code.replace(/-/g, " ")} `)).toBe(true);
  });

  it("re-issuing replaces the previous code", () => {
    const first = issueSetupCode();
    const second = issueSetupCode();
    expect(verifySetupCode(second)).toBe(true);
    if (first !== second) expect(verifySetupCode(first)).toBe(false);
  });

  it("invalidation burns the code", () => {
    const code = issueSetupCode();
    invalidateSetupCode();
    expect(hasActiveSetupCode()).toBe(false);
    expect(verifySetupCode(code)).toBe(false);
  });

  it("stores state on globalThis under a Symbol.for key (shared across module instances)", () => {
    issueSetupCode();
    const state = (globalThis as Record<symbol, { hash: string | null }>)[Symbol.for("crucible.ce.setupCode")];
    expect(state?.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ensureSetupCode", () => {
  it("issues and logs a banner when there are zero users", async () => {
    const log = vi.fn();
    expect(await ensureSetupCode(async () => 0, log)).toBe("issued");
    expect(hasActiveSetupCode()).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const banner = log.mock.calls[0][0] as string;
    const code = banner.match(/setup code: (\S+)/)?.[1];
    expect(code).toMatch(FORMAT);
    expect(verifySetupCode(code)).toBe(true);
  });

  it("does nothing when users exist", async () => {
    const log = vi.fn();
    expect(await ensureSetupCode(async () => 3, log)).toBe("not-needed");
    expect(hasActiveSetupCode()).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves an active code alone (no re-print, no DB call)", async () => {
    const code = issueSetupCode();
    const count = vi.fn(async () => 0);
    const log = vi.fn();
    expect(await ensureSetupCode(count, log)).toBe("active");
    expect(count).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(verifySetupCode(code)).toBe(true);
  });

  it("concurrent callers issue exactly one code", async () => {
    const log = vi.fn();
    const results = await Promise.all([ensureSetupCode(async () => 0, log), ensureSetupCode(async () => 0, log)]);
    expect(results.sort()).toEqual(["active", "issued"]);
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("formatSetupCodeBanner", () => {
  it("names the code and the /setup URL", () => {
    const banner = formatSetupCodeBanner("ABCD-EFGH-JKMN-PQRS", "https://crucible.example.com");
    expect(banner).toContain("Crucible CE first-run setup code: ABCD-EFGH-JKMN-PQRS");
    expect(banner).toContain("Enter it at https://crucible.example.com/setup");
    expect(banner).toContain("=".repeat(20));
  });
});
