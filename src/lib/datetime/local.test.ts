import { describe, expect, it } from "vitest";
import {
  toDatetimeLocalValue,
  fromDatetimeLocalValue,
  toDateInputValue,
  fromDateInputValue,
  ymdLocal,
  parseYmdLocal,
  toIsoOrNull,
} from "./local";

// These tests are timezone-independent by design: they build Dates from LOCAL
// components (new Date(y, m, d, h, mi)) and assert against the same Date's
// local getters, rather than assuming a specific TZ. That way they pass
// identically in CI (any TZ) and on a dev machine.

describe("toDatetimeLocalValue / fromDatetimeLocalValue", () => {
  it("formats a Date using its own local getters (round-trip safe in any TZ)", () => {
    const d = new Date(2026, 6, 3, 9, 5); // 2026-07-03 09:05 local
    expect(toDatetimeLocalValue(d)).toBe("2026-07-03T09:05");
  });

  it("zero-pads month/day/hour/minute", () => {
    const d = new Date(2026, 0, 5, 3, 7); // 2026-01-05 03:07 local
    expect(toDatetimeLocalValue(d)).toBe("2026-01-05T03:07");
  });

  it("accepts an ISO string input and still uses local getters of the parsed Date", () => {
    const iso = "2026-07-03T13:00:00.000Z";
    const viaDate = toDatetimeLocalValue(new Date(iso));
    const viaString = toDatetimeLocalValue(iso);
    expect(viaString).toBe(viaDate);
  });

  it("round-trips through fromDatetimeLocalValue to the minute", () => {
    const original = new Date(2026, 6, 3, 9, 0);
    const value = toDatetimeLocalValue(original);
    const parsed = fromDatetimeLocalValue(value);
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(original.getFullYear());
    expect(parsed!.getMonth()).toBe(original.getMonth());
    expect(parsed!.getDate()).toBe(original.getDate());
    expect(parsed!.getHours()).toBe(original.getHours());
    expect(parsed!.getMinutes()).toBe(original.getMinutes());
    expect(parsed!.getTime()).toBe(original.getTime());
  });

  it("returns '' for null/undefined/empty", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(undefined)).toBe("");
    expect(toDatetimeLocalValue("")).toBe("");
  });

  it("returns '' for an invalid date string", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });

  it("fromDatetimeLocalValue returns null for '' and invalid input", () => {
    expect(fromDatetimeLocalValue("")).toBeNull();
    expect(fromDatetimeLocalValue("not-a-date")).toBeNull();
  });
});

describe("toDateInputValue / fromDateInputValue", () => {
  it("formats a Date's local YYYY-MM-DD", () => {
    const d = new Date(2026, 6, 3, 23, 59); // still July 3rd locally regardless of TZ
    expect(toDateInputValue(d)).toBe("2026-07-03");
  });

  it("returns '' for null/undefined/empty", () => {
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue(undefined)).toBe("");
    expect(toDateInputValue("")).toBe("");
  });

  it("fromDateInputValue produces local midnight of that day", () => {
    const d = fromDateInputValue("2026-07-03");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(6);
    expect(d!.getDate()).toBe(3);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
  });

  it("fromDateInputValue returns null for ''", () => {
    expect(fromDateInputValue("")).toBeNull();
  });
});

describe("ymdLocal / parseYmdLocal (off-by-one regression)", () => {
  it("ymdLocal(parseYmdLocal(x)) round-trips to the same key in any TZ", () => {
    const key = "2026-07-03";
    expect(ymdLocal(parseYmdLocal(key))).toBe(key);
  });

  it("parseYmdLocal never shifts the day backward — this IS the off-by-one fix", () => {
    // Regression: `new Date("2026-07-03")` (no time component) parses as UTC
    // midnight, which formats as 2026-07-02 in any negative-offset timezone.
    // parseYmdLocal must always resolve to day 3 / month 6 (July) / year 2026,
    // regardless of the host timezone, because it parses as LOCAL midnight.
    const d = parseYmdLocal("2026-07-03");
    expect(d.getDate()).toBe(3);
    expect(d.getMonth()).toBe(6);
    expect(d.getFullYear()).toBe(2026);
  });

  it("handles a month/year boundary day key correctly", () => {
    const d = parseYmdLocal("2026-01-01");
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(0);
    expect(d.getFullYear()).toBe(2026);
  });
});

describe("toIsoOrNull", () => {
  it("returns null for ''", () => {
    expect(toIsoOrNull("")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(toIsoOrNull("garbage")).toBeNull();
  });

  it("returns an ISO string for a valid datetime-local value", () => {
    const iso = toIsoOrNull("2026-07-03T09:00");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).getTime()).toBe(new Date(2026, 6, 3, 9, 0).getTime());
  });
});
