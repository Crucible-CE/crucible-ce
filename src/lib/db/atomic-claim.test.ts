import { describe, it, expect } from "vitest";
import { claimOne, ClaimRace, isUniqueViolation, CONCURRENCY_CONFLICT } from "./atomic-claim";

describe("claimOne", () => {
  it("true iff exactly one row transitioned", async () => {
    expect(await claimOne(Promise.resolve({ count: 1 }))).toBe(true);
    expect(await claimOne(Promise.resolve({ count: 0 }))).toBe(false);
    expect(await claimOne(Promise.resolve({ count: 2 }))).toBe(false);
  });

  it("propagates rejection", async () => {
    await expect(claimOne(Promise.reject(new Error("db down")))).rejects.toThrow("db down");
  });
});

describe("ClaimRace", () => {
  it("is an Error with a default message and name", () => {
    const e = new ClaimRace();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ClaimRace");
    expect(e.message).toBe("resource changed concurrently");
    expect(new ClaimRace("custom").message).toBe("custom");
  });
});

describe("isUniqueViolation", () => {
  it("matches P2002 only", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe("CONCURRENCY_CONFLICT", () => {
  it("is the standard 409 body", () => {
    expect(CONCURRENCY_CONFLICT.error).toMatch(/modified by someone else/i);
  });
});
