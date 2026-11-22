import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    incidentPostmortem: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import { evaluateClosureGate } from "./closure-gate";

describe("evaluateClosureGate", () => {
  const prior = process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM;
  beforeEach(() => {
    mockDb.incidentPostmortem.findUnique.mockReset();
    delete process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM;
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM;
    else process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM = prior;
  });

  it("clean incident → no blockers", async () => {
    mockDb.incidentPostmortem.findUnique.mockResolvedValue({ status: "draft" });
    const r = await evaluateClosureGate("inc-1");
    expect(r.requiresOverride).toBe(false);
    expect(r.blockers).toEqual([]);
  });

  it("missing postmortem → blocker", async () => {
    mockDb.incidentPostmortem.findUnique.mockResolvedValue(null);
    const r = await evaluateClosureGate("inc-1");
    expect(r.requiresOverride).toBe(true);
    expect(r.blockers.map((b) => b.code)).toEqual(["missing_postmortem"]);
  });

  it("draft postmortem passes by default but blocks when FINAL required", async () => {
    mockDb.incidentPostmortem.findUnique.mockResolvedValue({ status: "draft" });
    expect((await evaluateClosureGate("inc-1")).requiresOverride).toBe(false);

    process.env.FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM = "true";
    const strict = await evaluateClosureGate("inc-1");
    expect(strict.requiresOverride).toBe(true);
    expect(strict.blockers[0].code).toBe("missing_postmortem");
  });
});
