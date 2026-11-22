import { describe, expect, it } from "vitest";
import {
  buildRrule,
  currentOccurrence,
  nextOccurrenceAfter,
  occurrence,
  occurrencesBetween,
  parseRrule,
  parseWallTime,
  recurrenceOf,
  wallTimeOf,
} from "./recurrence";

const wall = (date: string, time: string) => parseWallTime(date, time)!;

describe("rrule subset", () => {
  it("round trips every cadence", () => {
    for (const r of ["monthly", "quarterly", "semiannual", "annual"] as const) {
      const raw = buildRrule(r, wall("2026-10-31", "09:00"), "Europe/Berlin")!;
      expect(recurrenceOf(raw)).toBe(r);
      expect(parseRrule(raw)?.tz).toBe("Europe/Berlin");
    }
    expect(buildRrule("none", wall("2026-10-31", "09:00"), "UTC")).toBeNull();
    expect(buildRrule("quarterly", wall("2026-01-05", "14:30"), "UTC")).toBe("DTSTART;TZID=UTC:20260105T143000\nRRULE:FREQ=MONTHLY;INTERVAL=3");
  });

  it("rejects anything outside the subset", () => {
    const head = "DTSTART;TZID=UTC:20260105T143000";
    expect(parseRrule(`${head}\nRRULE:FREQ=WEEKLY;INTERVAL=1`)).toBeNull();
    expect(parseRrule(`${head}\nRRULE:FREQ=MONTHLY;INTERVAL=2`)).toBeNull();
    expect(parseRrule(`${head}\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=MO`)).toBeNull();
    expect(parseRrule(`${head}\nRRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=3`)).toBeNull();
    expect(parseRrule("DTSTART;TZID=Not/AZone:20260105T143000\nRRULE:FREQ=MONTHLY")).toBeNull();
    expect(parseRrule("DTSTART;TZID=UTC:20260230T143000\nRRULE:FREQ=MONTHLY")).toBeNull();
    expect(parseRrule(null)).toBeNull();
    expect(recurrenceOf("garbage")).toBe("none");
    expect(parseRrule(`${head}\nRRULE:FREQ=YEARLY`)?.months).toBe(12);
  });

  it("rejects dates that do not exist", () => {
    expect(parseWallTime("2026-02-29", "10:00")).toBeNull();
    expect(parseWallTime("2028-02-29", "10:00")).not.toBeNull();
    expect(parseWallTime("2026-13-01", "10:00")).toBeNull();
    expect(parseWallTime("2026-01-01", "24:00")).toBeNull();
  });
});

describe("occurrences", () => {
  it("clamps the 31st to the last day of shorter months", () => {
    const rule = parseRrule(buildRrule("monthly", wall("2026-01-31", "10:00"), "UTC"))!;
    expect(occurrence(rule, 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(occurrence(rule, 2).toISOString()).toBe("2026-03-31T10:00:00.000Z");
    expect(occurrence(rule, 3).toISOString()).toBe("2026-04-30T10:00:00.000Z");
    expect(occurrence(rule, 13).toISOString()).toBe("2027-02-28T10:00:00.000Z");
  });

  it("keeps the wall time across daylight saving changes", () => {
    const rule = parseRrule(buildRrule("quarterly", wall("2026-01-15", "09:00"), "America/New_York"))!;
    const dates = occurrencesBetween(rule, new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"), 10);
    expect(dates.map((d) => d.toISOString())).toEqual([
      "2026-01-15T14:00:00.000Z", // EST
      "2026-04-15T13:00:00.000Z", // EDT
      "2026-07-15T13:00:00.000Z",
      "2026-10-15T13:00:00.000Z",
    ]);
    for (const d of dates) expect(wallTimeOf(d, "America/New_York")).toMatchObject({ h: 9, mi: 0, d: 15 });
  });

  it("finds the first occurrence strictly after a time", () => {
    const rule = parseRrule(buildRrule("semiannual", wall("2025-03-10", "08:00"), "UTC"))!;
    expect(nextOccurrenceAfter(rule, new Date("2026-10-20T00:00:00Z")).toISOString()).toBe("2027-03-10T08:00:00.000Z");
    expect(nextOccurrenceAfter(rule, new Date("2026-09-10T08:00:00Z")).toISOString()).toBe("2027-03-10T08:00:00.000Z");
    expect(nextOccurrenceAfter(rule, new Date("2026-09-10T07:59:00Z")).toISOString()).toBe("2026-09-10T08:00:00.000Z");
    expect(nextOccurrenceAfter(rule, new Date("2020-01-01T00:00:00Z")).toISOString()).toBe("2025-03-10T08:00:00.000Z");
  });

  it("annual series from Feb 29 lands on Feb 28 in common years", () => {
    const rule = parseRrule(buildRrule("annual", wall("2028-02-29", "12:00"), "UTC"))!;
    expect(occurrence(rule, 1).toISOString()).toBe("2029-02-28T12:00:00.000Z");
    expect(occurrence(rule, 4).toISOString()).toBe("2032-02-29T12:00:00.000Z");
  });

  it("current occurrence stays on a running slot until it ends", () => {
    const rule = parseRrule(buildRrule("monthly", wall("2026-10-20", "10:00"), "UTC"))!;
    expect(currentOccurrence(rule, new Date("2026-10-20T11:00:00Z"), 120).toISOString()).toBe("2026-10-20T10:00:00.000Z");
    expect(currentOccurrence(rule, new Date("2026-10-20T12:00:00Z"), 120).toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });
});
