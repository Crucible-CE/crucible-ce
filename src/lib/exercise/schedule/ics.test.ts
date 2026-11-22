// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildIcsCalendar, escapeIcsText, foldIcsLine, markdownToPlain, toIcsUtc } from "./ics";

/** Undo folding (RFC 5545 section 3.1). */
function unfold(text: string): string {
  return text.replace(/\r\n /g, "");
}

describe("escapeIcsText", () => {
  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeIcsText("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
  it("treats CRLF and bare CR as one line break", () => {
    expect(escapeIcsText("one\r\ntwo\rthree")).toBe("one\\ntwo\\nthree");
  });
  it("drops control characters that TEXT does not allow", () => {
    expect(escapeIcsText("a\u0000b\u0007c\u001bd\u007fe\tf")).toBe("abcde\tf");
  });
  it("cannot inject a property", () => {
    const evil = "Title\r\nATTENDEE:mailto:x@example.com\nEND:VEVENT";
    const ics = buildIcsCalendar({ name: "x", events: [{ uid: "u", title: evil, start: new Date(0), durationMinutes: 30 }], now: new Date(0) });
    const lines = unfold(ics).split("\r\n");
    expect(lines.filter((l) => l.startsWith("ATTENDEE"))).toHaveLength(0);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
  });
});

describe("foldIcsLine", () => {
  it("leaves short lines alone", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
  });
  it("folds at 75 octets with a leading space", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) expect(p.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toBe(line);
  });
  it("never splits a multibyte character", () => {
    const line = `SUMMARY:${"é".repeat(60)}${"🙂".repeat(20)}`;
    const folded = foldIcsLine(line);
    for (const p of folded.split("\r\n")) {
      expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(75);
      expect(p).not.toContain("�");
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe("buildIcsCalendar", () => {
  it("writes a valid calendar with CRLF line ends", () => {
    const start = new Date("2026-11-03T14:00:00Z");
    const ics = buildIcsCalendar({
      name: "Acme exercises",
      now: new Date("2026-10-20T00:00:00Z"),
      refreshHours: 1,
      events: [
        {
          uid: "schedule-abc-20261103",
          title: "Quarterly ransomware, exec team",
          start,
          durationMinutes: 90,
          description: "Pre-read\n\nRead the brief; bring questions, notes.",
          url: "https://ttx.example.com/schedule",
        },
      ],
    });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = unfold(ics).split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(lines).toContain("UID:schedule-abc-20261103@crucible-ce");
    expect(lines).toContain(`DTSTART:${toIcsUtc(start)}`);
    expect(lines).toContain("DTEND:20261103T153000Z");
    expect(lines).toContain("SUMMARY:Quarterly ransomware\\, exec team");
    expect(lines).toContain("DESCRIPTION:Pre-read\\n\\nRead the brief\\; bring questions\\, notes.");
    expect(lines).toContain("URL:https://ttx.example.com/schedule");
  });
  it("skips a URL that is not a plain http(s) URL", () => {
    const ics = buildIcsCalendar({ name: "x", now: new Date(0), events: [{ uid: "u", title: "t", start: new Date(0), durationMinutes: 5, url: "javascript:alert(1)" }] });
    expect(ics).not.toContain("URL:");
  });
});

describe("markdownToPlain", () => {
  it("keeps the words and drops the markup", () => {
    expect(markdownToPlain("## Situation\n\n**Ransomware** hit the _file_ servers. See [the plan](https://x).\n* one\n* two")).toBe(
      "Situation\n\nRansomware hit the _file_ servers. See the plan.\n- one\n- two",
    );
  });
});
