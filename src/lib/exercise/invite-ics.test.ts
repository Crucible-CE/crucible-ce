// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/exercise/access", () => ({ canReadTemplateSecrets: vi.fn() }));
vi.mock("@/lib/exercise/auth/session", () => ({}));

import { exerciseInviteDescription, exerciseInviteIcs } from "./invite-ics";

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("exercise calendar invite", () => {
  const base = {
    exerciseId: "ex1",
    title: "Q4 drill, part 1; ransomware",
    start: new Date("2026-11-01T14:00:00Z"),
    durationMin: 90,
    join: { url: "https://ttx.example.com/join/ABCD2345", code: "ABCD2345" },
    exerciseUrl: "https://ttx.example.com/play/ex1",
    briefMd: "## Pre-read\n\nRead the **escalation** section, then the comms plan.",
    now: new Date("2026-10-20T12:00:00Z"),
  };

  it("carries the join link, code and brief", () => {
    const flat = unfold(exerciseInviteIcs(base));
    expect(flat).toContain("DTSTART:20261101T140000Z");
    expect(flat).toContain("DTEND:20261101T153000Z");
    expect(flat).toContain("URL:https://ttx.example.com/join/ABCD2345");
    expect(flat).toContain("Join: https://ttx.example.com/join/ABCD2345\\nCode: ABCD2345");
    expect(flat).toContain("Read the escalation section\\, then the comms plan.");
    expect(flat).toContain("UID:exercise-ex1@crucible-ce");
  });

  it("escapes TEXT values and folds long lines", () => {
    const ics = exerciseInviteIcs(base);
    expect(unfold(ics)).toContain("SUMMARY:Q4 drill\\, part 1\\; ransomware");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("keeps a smuggled line break inside the value", () => {
    const ics = exerciseInviteIcs({ ...base, title: "Drill\r\nATTENDEE:mailto:x@y.com\u0007" });
    expect(ics).not.toContain("\r\nATTENDEE");
    expect(unfold(ics)).toContain("SUMMARY:Drill\\nATTENDEE:mailto:x@y.com");
  });

  it("uses an hour without a time box and the exercise link without join by code", () => {
    const ics = unfold(exerciseInviteIcs({ ...base, durationMin: null, join: null, briefMd: null }));
    expect(ics).toContain("DTEND:20261101T150000Z");
    expect(ics).toContain("DESCRIPTION:Open: https://ttx.example.com/play/ex1");
    expect(ics).toContain("URL:https://ttx.example.com/play/ex1");
    expect(exerciseInviteDescription({ join: null, exerciseUrl: null, briefMd: null })).toBe("");
  });
});
