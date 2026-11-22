import { describe, expect, it } from "vitest";
import { cadenceSummary, countBy, minutesText, type ExecutiveDashboard } from "./executive";
import { renderExecutivePdf } from "./executive-pdf";
import { computeReadiness } from "@/lib/exercise/readiness/score";

const readiness = computeReadiness({
  cadence: [{ status: "current" }, { status: "overdue" }],
  exercisesLast12: 3,
  roles: [{ role: "Legal", present: 2, total: 3 }],
  ratings: [{ rating: "S", endedAt: new Date("2026-09-01T00:00:00Z") }],
  workItems: { open: 4, overdue: 1, openHigh: 2, stale: 1 },
  aar: { ended: 3, overdue: 1 },
  techniques: 7,
  playbooks: { total: 5, own: 1, exercised: 1, run: 0, used: 1 },
});

const dash: ExecutiveDashboard = {
  generatedAt: "2026-10-26T12:00:00.000Z",
  instanceName: "Fixture Org",
  marking: "Confidential",
  window: { from: "2025-10-26T12:00:00.000Z", to: "2026-10-26T12:00:00.000Z" },
  incidents: { open: 3, bySeverity: { critical: 1, high: 1, medium: 1, low: 0 }, slaBreached: 1, windowDays: 90, mttaMinutes: 12, mttrMinutes: 245 },
  program: {
    lastExerciseAt: "2026-09-01T00:00:00.000Z",
    exercises: 3,
    byMode: { crisissim: 2, strategic: 1 },
    cadence: Array.from({ length: 8 }, (_, i) => ({
      framework: `fw${i}`,
      frameworkLabel: "PCI DSS v4.0",
      controlId: `12.10.${i}`,
      controlTitle: null,
      months: 12,
      lastTested: "2026-03-04T16:00:00.000Z",
      dueAt: "2027-03-04T16:00:00.000Z",
      status: "current" as const,
      daysLeft: 120,
      sentence: "PCI DSS v4.0 last tested 2026-03-04, due 2027-03-04",
    })),
    cadenceSummary: { current: 8, dueSoon: 0, overdue: 0 },
    roles: ["Legal", "Communications", "Executive sponsor", "IT operations"].map((role) => ({ role, present: 2, total: 3, lastPresentAt: null })),
  },
  improvement: { open: 4, overdue: 1, openHigh: 2, aging: { "0-30": 2, "31-60": 1, "61-90": 0, "90+": 1 }, findings: { accepted: 5, actionItems: 3, noAction: 1, rejected: 0 } },
  readiness,
  trend: [{ day: "2026-10-25", score: readiness.score }],
};

describe("executive dashboard helpers", () => {
  it("counts by key and summarizes cadence", () => {
    expect(countBy([{ m: "a" }, { m: "b" }, { m: "a" }], (x) => x.m)).toEqual({ a: 2, b: 1 });
    expect(cadenceSummary([{ status: "current" }, { status: "due_soon" }, { status: "never" }, { status: "overdue" }])).toEqual({ current: 1, dueSoon: 1, overdue: 2 });
  });

  it("writes minutes plainly", () => {
    expect(minutesText(null)).toBe("None");
    expect(minutesText(45.4)).toBe("45 min");
    expect(minutesText(125)).toBe("2 h 05 min");
  });

  it("renders the one-page PDF with and without data", async () => {
    const pdf = await renderExecutivePdf(dash);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = pdf.toString("latin1");
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    const empty = await renderExecutivePdf({ ...dash, marking: "", program: { ...dash.program, exercises: 0, byMode: {}, roles: [], lastExerciseAt: null } });
    expect(empty.length).toBeGreaterThan(500);
  }, 60_000);
});
