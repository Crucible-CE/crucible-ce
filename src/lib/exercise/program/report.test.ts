import { describe, expect, it } from "vitest";
import { addMonths, agingBuckets, cadenceRows, cadenceSentence, cadenceStatus, finalReportControls, overdueReports, reportWindow } from "./report";
import { cadenceMonths, readPolicy } from "./policy";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("addMonths", () => {
  it("adds calendar months", () => {
    expect(addMonths(d("2026-03-04"), 12).toISOString().slice(0, 10)).toBe("2027-03-04");
    expect(addMonths(d("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addMonths(d("2024-02-29"), 12).toISOString().slice(0, 10)).toBe("2025-02-28");
    expect(addMonths(d("2026-11-15"), -12).toISOString().slice(0, 10)).toBe("2025-11-15");
  });
});

describe("cadence", () => {
  it("is current, due soon, overdue or never", () => {
    expect(cadenceStatus(d("2026-03-04"), 12, d("2026-10-20")).status).toBe("current");
    expect(cadenceStatus(d("2025-11-01"), 12, d("2026-10-20")).status).toBe("due_soon");
    expect(cadenceStatus(d("2025-03-04"), 12, d("2026-10-20")).status).toBe("overdue");
    expect(cadenceStatus(null, 12, d("2026-10-20")).status).toBe("never");
  });
  it("writes the PCI sentence", () => {
    const r = cadenceStatus(d("2026-03-04"), 12, d("2026-10-20"));
    expect(cadenceSentence("PCI DSS v4.0 12.10.2", r)).toBe("PCI DSS v4.0 12.10.2 last tested 2026-03-04, due 2027-03-04");
    expect(cadenceSentence("HIPAA", cadenceStatus(null, 12, d("2026-10-20")))).toBe("HIPAA has not been tested");
  });
  it("uses the policy before the default", () => {
    expect(cadenceMonths({ cadence: {} }, "pci-dss")).toBe(12);
    expect(cadenceMonths({ cadence: { "pci-dss": 6 } }, "pci-dss")).toBe(6);
    expect(cadenceMonths({ cadence: {} }, "gdpr")).toBeNull();
    expect(cadenceMonths({ cadence: { gdpr: 24 } }, "gdpr")).toBe(24);
  });
  it("dates PCI 12.10.2 from the latest exercise that mapped PCI", () => {
    const tests = [
      { exerciseId: "a", testedAt: d("2025-02-01"), controls: [{ framework: "pci-dss", controlId: "12.10.1" }] },
      { exerciseId: "b", testedAt: d("2026-03-04"), controls: [{ framework: "pci-dss", controlId: "12.10.6" }] },
      { exerciseId: "c", testedAt: d("2026-06-01"), controls: [{ framework: "nist-csf", controlId: "RS.MA" }] },
    ];
    const rows = cadenceRows(["pci-dss", "nist-csf", "hipaa"], { cadence: {} }, tests, d("2026-10-20"));
    const pci = rows.find((r) => r.framework === "pci-dss" && r.controlId === "12.10.2")!;
    expect(pci.lastTested?.slice(0, 10)).toBe("2026-03-04");
    expect(pci.dueAt?.slice(0, 10)).toBe("2027-03-04");
    expect(pci.status).toBe("current");
    expect(pci.sentence).toBe("PCI DSS v4.0 12.10.2 last tested 2026-03-04, due 2027-03-04");
    // NIST CSF has no default cadence and no policy: no row.
    expect(rows.some((r) => r.framework === "nist-csf")).toBe(false);
    // HIPAA has a default cadence and was never tested.
    expect(rows.filter((r) => r.framework === "hipaa").every((r) => r.status === "never")).toBe(true);
  });
  it("adds a framework row when the policy sets a cadence without cadence controls", () => {
    const rows = cadenceRows(["gdpr"], { cadence: { gdpr: 12 } }, [{ exerciseId: "a", testedAt: d("2025-01-01"), controls: [{ framework: "gdpr", controlId: "33" }] }], d("2026-10-20"), () => []);
    expect(rows).toHaveLength(1);
    expect(rows[0].controlId).toBeNull();
    expect(rows[0].status).toBe("overdue");
  });
});

describe("remediation aging", () => {
  it("buckets open items by age", () => {
    const now = d("2026-10-20");
    const b = agingBuckets(
      [
        { status: "open", createdAt: d("2026-10-10") },
        { status: "in_progress", createdAt: d("2026-09-01") },
        { status: "open", createdAt: d("2026-08-01") },
        { status: "open", createdAt: d("2026-01-01") },
        { status: "done", createdAt: d("2026-01-01") },
        { status: "open", createdAt: d("2025-01-01"), startDate: d("2026-10-01") },
      ],
      now,
    );
    expect(b).toEqual({ "0-30": 2, "31-60": 1, "61-90": 1, "90+": 1 });
  });
});

describe("report window and policy", () => {
  it("defaults to the last 12 months", () => {
    const w = reportWindow(new URLSearchParams(), d("2026-10-20"));
    expect(w.from.toISOString().slice(0, 10)).toBe("2025-10-20");
    const w2 = reportWindow(new URLSearchParams({ from: "2026-01-01", to: "2026-06-30" }));
    expect(w2.to.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });
  it("flags reports past due: no draft after 30 days, no final after 90", () => {
    const now = d("2026-10-20");
    const ex = (id: string, ended: string, aars: Array<{ status: string }>) => ({ id, title: id, endedAt: d(ended), aars });
    const out = overdueReports(
      [ex("fresh", "2026-10-01", []), ex("nodraft", "2026-09-01", []), ex("draftonly", "2026-07-01", [{ status: "draft" }]), ex("recentdraft", "2026-09-01", [{ status: "review" }]), ex("final", "2026-01-01", [{ status: "final" }])],
      now,
    );
    expect(out.map((o) => [o.id, o.missing])).toEqual([
      ["draftonly", "final"],
      ["nodraft", "draft"],
    ]);
  });
  it("counts plan requirements as tested in a final report unless the mapping shows a gap", () => {
    const controls = finalReportControls({
      controlMapping: [{ framework: "pci-dss", controlId: "12.10.1", title: "IR plan", status: "gap" }],
      overview: {
        requirements: [
          { framework: "pci-dss", controlId: "12.10.2", title: "Test the IR plan" },
          { framework: "pci-dss", controlId: "12.10.1", title: "IR plan" },
        ],
      },
    });
    expect(controls).toEqual([
      { framework: "pci-dss", controlId: "12.10.1", title: "IR plan", status: "gap" },
      { framework: "pci-dss", controlId: "12.10.2", title: "Test the IR plan", status: "tested" },
    ]);
    const rows = cadenceRows(["pci-dss"], { cadence: {} }, [{ exerciseId: "e1", testedAt: d("2026-03-04"), controls: [{ framework: "pci-dss", controlId: "12.10.2" }] }], d("2026-10-20"));
    expect(rows.find((r) => r.controlId === "12.10.2")?.lastTested?.slice(0, 10)).toBe("2026-03-04");
  });
  it("reads a broken policy as defaults", () => {
    expect(readPolicy(null)).toEqual({ schemaVersion: 1, cadence: {}, requiredRoles: [], confidentialityMarking: "", reminderDomains: [], suggestedObjectives: [] });
    expect(readPolicy({ confidentialityMarking: " Confidential ", reminderDomains: ["example.com"] })).toMatchObject({ confidentialityMarking: "Confidential", reminderDomains: ["example.com"] });
    expect(readPolicy({ cadence: { "pci-dss": 6 }, requiredRoles: "nope" }).cadence).toEqual({ "pci-dss": 6 });
  });
});
