import { describe, it, expect } from "vitest";
import { shouldApplyPageCsp } from "./csp-scope";

describe("shouldApplyPageCsp", () => {
  it("skips API routes so file responses keep their own sandbox CSP", () => {
    expect(shouldApplyPageCsp("/api/incidents/i1/evidence/e1")).toBe(false);
    expect(shouldApplyPageCsp("/api/guest/tok/evidence")).toBe(false);
    expect(shouldApplyPageCsp("/api")).toBe(false);
  });
  it("applies to pages", () => {
    expect(shouldApplyPageCsp("/incidents/i1")).toBe(true);
    expect(shouldApplyPageCsp("/")).toBe(true);
    expect(shouldApplyPageCsp("/apiary")).toBe(true);
  });
});
