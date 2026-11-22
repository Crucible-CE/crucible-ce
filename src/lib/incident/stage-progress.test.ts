import { describe, expect, it } from "vitest";
import { deriveStageStates } from "./stage-progress";

const ev = (from: string, to: string) => ({ action: "status_changed", metadata: { from, to } });
const states = (c: string, h: Parameters<typeof deriveStageStates>[1]) =>
  deriveStageStates(c, h).map((s) => s.state);

describe("deriveStageStates", () => {
  it("marks skipped stages on an incident closed from investigating", () => {
    expect(states("closed", [ev("open", "investigating"), ev("investigating", "closed")])).toEqual([
      "done", "done", "skipped", "skipped", "skipped", "active",
    ]);
  });
  it("marks every traversed stage done", () => {
    const h = [ev("open", "investigating"), ev("investigating", "contained"), ev("contained", "eradicated"), ev("eradicated", "recovered")];
    expect(states("recovered", h)).toEqual(["done", "done", "done", "done", "active", "upcoming"]);
  });
  it("falls back to linear when there is no history", () => {
    expect(states("eradicated", [])).toEqual(["done", "done", "done", "active", "upcoming", "upcoming"]);
  });
});
