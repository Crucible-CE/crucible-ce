import { describe, it, expect } from "vitest";
import { secureEqual } from "./secure-compare";

describe("secureEqual", () => {
  it("true for identical strings", () => {
    expect(secureEqual("Bearer abc123", "Bearer abc123")).toBe(true);
    expect(secureEqual("", "")).toBe(true);
  });

  it("false for different strings of the same length", () => {
    expect(secureEqual("aaaa", "aaab")).toBe(false);
  });

  it("false (and no throw) for unequal lengths", () => {
    expect(secureEqual("short", "a-much-longer-secret-value")).toBe(false);
    expect(secureEqual("x", "")).toBe(false);
  });

  it("handles unicode", () => {
    expect(secureEqual("sécret✓", "sécret✓")).toBe(true);
    expect(secureEqual("sécret✓", "sécret✗")).toBe(false);
  });
});
