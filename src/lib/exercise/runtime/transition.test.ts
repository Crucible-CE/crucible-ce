// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canTransitionExercise, canTransitionInject, EXERCISE_TRANSITIONS } from "./transition";
import { clockDeadline } from "./clocks";

describe("exercise transitions", () => {
  it("allows the documented lifecycle", () => {
    expect(canTransitionExercise("draft", "lobby")).toBe(true);
    expect(canTransitionExercise("lobby", "live")).toBe(true);
    expect(canTransitionExercise("live", "paused")).toBe(true);
    expect(canTransitionExercise("paused", "live")).toBe(true);
    expect(canTransitionExercise("live", "ended")).toBe(true);
    expect(canTransitionExercise("paused", "ended")).toBe(true);
  });

  it("blocks leaving a terminal state", () => {
    for (const to of Object.keys(EXERCISE_TRANSITIONS)) {
      expect(canTransitionExercise("ended", to as never)).toBe(false);
      expect(canTransitionExercise("abandoned", to as never)).toBe(false);
    }
  });

  it("blocks skipping live", () => {
    expect(canTransitionExercise("lobby", "ended")).toBe(false);
    expect(canTransitionExercise("draft", "paused")).toBe(false);
  });
});

describe("inject transitions", () => {
  it("allows pending to held or open, held to open, open to closed", () => {
    expect(canTransitionInject("pending", "held")).toBe(true);
    expect(canTransitionInject("pending", "open")).toBe(true);
    expect(canTransitionInject("held", "open")).toBe(true);
    expect(canTransitionInject("open", "closed")).toBe(true);
  });
  it("never reopens a closed inject", () => {
    expect(canTransitionInject("closed", "open")).toBe(false);
    expect(canTransitionInject("open", "held")).toBe(false);
  });
});

describe("clockDeadline", () => {
  it("adds hours", () => {
    const start = new Date("2026-03-06T10:00:00Z");
    expect(clockDeadline(start, 72, null)?.toISOString()).toBe("2026-03-09T10:00:00.000Z");
  });
  it("counts business days and skips weekends", () => {
    // Friday + 4 business days = Thursday
    const start = new Date("2026-03-06T10:00:00Z");
    expect(clockDeadline(start, null, 4)?.toISOString()).toBe("2026-03-12T10:00:00.000Z");
  });
});
