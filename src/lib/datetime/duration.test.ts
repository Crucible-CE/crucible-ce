import { describe, expect, it } from "vitest";
import { hoursBetween, formatRemaining, formatElapsed } from "./duration";

describe("hoursBetween", () => {
  it("computes whole hours between two UTC instants", () => {
    const from = new Date("2026-07-03T00:00:00.000Z");
    const to = new Date("2026-07-03T05:00:00.000Z");
    expect(hoursBetween(from, to)).toBe(5);
  });

  it("accepts ISO strings directly", () => {
    expect(hoursBetween("2026-07-03T00:00:00.000Z", "2026-07-03T12:00:00.000Z")).toBe(12);
  });

  it("is negative when `to` precedes `from`", () => {
    expect(hoursBetween("2026-07-03T12:00:00.000Z", "2026-07-03T00:00:00.000Z")).toBe(-12);
  });

  it("handles fractional hours", () => {
    const from = new Date("2026-07-03T00:00:00.000Z");
    const to = new Date("2026-07-03T00:30:00.000Z");
    expect(hoursBetween(from, to)).toBeCloseTo(0.5, 10);
  });
});

describe("formatRemaining", () => {
  it("returns OVERDUE once elapsed exceeds the deadline", () => {
    expect(formatRemaining(36, 40)).toBe("OVERDUE");
  });

  it("formats hours and minutes left", () => {
    expect(formatRemaining(36, 24)).toBe("12h 0m left");
  });

  it("rounds partial-hour remainders to minutes", () => {
    // 36 - 23.5 = 12.5h -> 12h 30m
    expect(formatRemaining(36, 23.5)).toBe("12h 30m left");
  });

  it("never reports negative remaining time", () => {
    expect(formatRemaining(10, 10)).toBe("0h 0m left");
  });
});

describe("formatElapsed", () => {
  it("formats sub-day elapsed as Xh Ym", () => {
    const from = new Date(2026, 6, 3, 9, 0).getTime();
    const now = new Date(2026, 6, 3, 12, 30).getTime();
    expect(formatElapsed(from, now)).toBe("3h 30m");
  });

  it("formats multi-day elapsed as Xd Yh", () => {
    const from = new Date(2026, 6, 1, 0, 0).getTime();
    const now = new Date(2026, 6, 3, 3, 0).getTime();
    expect(formatElapsed(from, now)).toBe("2d 3h");
  });

  it("accepts Date objects or ISO strings, not just ms numbers", () => {
    const from = new Date(2026, 6, 3, 9, 0);
    const now = new Date(2026, 6, 3, 11, 0);
    expect(formatElapsed(from, now)).toBe("2h 0m");
  });

  it("clamps to zero when now precedes from", () => {
    const from = new Date(2026, 6, 3, 11, 0).getTime();
    const now = new Date(2026, 6, 3, 9, 0).getTime();
    expect(formatElapsed(from, now)).toBe("0h 0m");
  });
});
