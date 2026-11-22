import { describe, expect, it } from "vitest";
import { renderExecSummaryPdf, renderProgramReportPdf } from "./pdf";
import type { ProgramReport } from "./report";

const report: ProgramReport = {
  window: { from: "2025-10-20T00:00:00.000Z", to: "2026-10-20T23:59:59.999Z" },
  generatedAt: "2026-10-20T12:00:00.000Z",
  instanceName: "Fixture Org",
  timezone: "UTC",
  exercises: [{ id: "e1", title: "Ransomware drill", mode: "crisissim", startedAt: null, endedAt: "2026-03-04T16:00:00.000Z", participants: 9, aarStatus: "final", aarVersion: 1, openItems: 2 }],
  lastTestedAt: "2026-03-04T16:00:00.000Z",
  controls: [{ framework: "pci-dss", frameworkLabel: "PCI DSS v4.0", controlId: "12.10.1", title: "Incident response plan in place", lastTested: "2026-03-04T16:00:00.000Z", result: "gap" }],
  cadence: [
    {
      framework: "pci-dss",
      frameworkLabel: "PCI DSS v4.0",
      controlId: "12.10.2",
      controlTitle: "Annual review and test of the IR plan",
      months: 12,
      lastTested: "2026-03-04T16:00:00.000Z",
      dueAt: "2027-03-04T16:00:00.000Z",
      status: "current",
      daysLeft: 135,
      sentence: "PCI DSS v4.0 12.10.2 last tested 2026-03-04, due 2027-03-04",
    },
  ],
  roles: [{ role: "Legal", present: 1, total: 1, lastPresentAt: "2026-03-04T16:00:00.000Z" }],
  roleWindow: { from: "2025-10-20T00:00:00.000Z", to: "2026-10-20T23:59:59.999Z" },
  actionItems: { open: 2, overdue: 1, openHigh: 1, done: 3, rejected: 0, aging: { "0-30": 1, "31-60": 0, "61-90": 0, "90+": 1 } },
  findings: { accepted: 4, actionItems: 3, noAction: 1, rejected: 2 },
  overdueItems: [{ id: "a1", correctiveAction: "Add legal to the call tree.", poc: "IR manager", dueDate: "2026-05-01T00:00:00.000Z", priority: "high", exerciseTitle: "Ransomware drill" }],
  participantsInWindow: 9,
  aarOverdue: [{ id: "e9", title: "Phishing drill", endedAt: "2026-05-01T00:00:00.000Z", days: 172, missing: "final" }],
  signingKeys: [{ keyId: "0123456789abcdef", createdAt: "2026-01-01T00:00:00.000Z", retiredAt: null }],
  marking: "Confidential",
};

describe("program PDFs", () => {
  it("render the program report and the executive summary", async () => {
    const full = await renderProgramReportPdf(report);
    expect(full.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const summary = await renderExecSummaryPdf(report);
    expect(summary.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const empty = await renderProgramReportPdf({ ...report, exercises: [], controls: [], cadence: [], roles: [], overdueItems: [], aarOverdue: [], signingKeys: [], marking: "", lastTestedAt: null });
    expect(empty.length).toBeGreaterThan(500);
  }, 60_000);
});
