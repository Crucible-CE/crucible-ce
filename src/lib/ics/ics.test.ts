import { describe, it, expect } from "vitest";
import { buildIcsCalendar, escapeIcsText, foldIcsLine } from "./ics";

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma, and newlines in spec order", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:hello")).toBe("SUMMARY:hello");
  });

  it("folds at 75 octets with space-prefixed continuations", () => {
    const line = "SUMMARY:" + "x".repeat(200);
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.from(parts[0], "utf8").length).toBeLessThanOrEqual(75);
    for (const cont of parts.slice(1)) {
      expect(cont.startsWith(" ")).toBe(true);
      expect(Buffer.from(cont, "utf8").length).toBeLessThanOrEqual(75);
    }
    // Unfolding reproduces the original line exactly.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("never splits inside a UTF-8 multibyte sequence", () => {
    const line = "SUMMARY:" + "é".repeat(120); // 2-byte chars
    const folded = foldIcsLine(line);
    for (const part of folded.split("\r\n")) {
      // Round-trips cleanly only if no sequence was split.
      const raw = part.startsWith(" ") ? part.slice(1) : part;
      expect(Buffer.from(raw, "utf8").toString("utf8")).toBe(raw);
      expect(raw.includes("�")).toBe(false);
    }
  });
});

describe("buildIcsCalendar", () => {
  it("emits a valid VCALENDAR with one VEVENT per event", () => {
    const ics = buildIcsCalendar({
      name: "Crucible: Test",
      events: [
        {
          uid: "e1",
          title: "Deadline: SEC 8-K, Item 1.05",
          start: new Date("2026-09-20T14:30:00.000Z"),
          meta: "pending",
        },
      ],
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).toContain("UID:e1@crucible");
    expect(ics).toContain("DTSTART:20260920T143000Z");
    expect(ics).toContain("DTEND:20260920T150000Z"); // default 30-minute block
    expect(ics).toContain("SUMMARY:Deadline: SEC 8-K\\, Item 1.05");
    expect(ics).toContain("DESCRIPTION:Status: pending");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    // Every line respects the 75-octet fold.
    for (const line of ics.split("\r\n")) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
  });
});
