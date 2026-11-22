import { describe, it, expect } from "vitest";
import { computeFromIncidents, bucketStart, defaultBucket, extractAssets } from "./incident-metrics";

const D = (iso: string) => new Date(iso);

function inc(overrides: Partial<Parameters<typeof computeFromIncidents>[0][number]> = {}) {
  return {
    severity: "high",
    status: "open",
    category: null,
    createdAt: D("2026-01-05T00:00:00Z"),
    declaredAt: null,
    containedAt: null,
    resolvedAt: null,
    closedAt: null,
    closureDisposition: null,
    affectedSystems: null,
    estimatedCostUsd: null,
    recordsAffected: null,
    customersAffected: null,
    downtimeMinutes: null,
    assignedTo: null,
    assignedToId: null,
    ...overrides,
  };
}

describe("incident-metrics engine", () => {
  it("defaultBucket derives from window", () => {
    expect(defaultBucket(30)).toBe("day");
    expect(defaultBucket(90)).toBe("week");
    expect(defaultBucket(365)).toBe("month");
  });

  it("bucketStart: month/week/day UTC boundaries", () => {
    expect(bucketStart(D("2026-01-17T15:30:00Z"), "month")).toBe("2026-01-01");
    expect(bucketStart(D("2026-01-17T15:30:00Z"), "day")).toBe("2026-01-17");
    // 2026-01-17 is a Saturday → ISO week starts Monday 2026-01-12.
    expect(bucketStart(D("2026-01-17T15:30:00Z"), "week")).toBe("2026-01-12");
    // Sunday belongs to the week starting the prior Monday.
    expect(bucketStart(D("2026-01-18T01:00:00Z"), "week")).toBe("2026-01-12");
  });

  it("month bucketing: opened by createdAt, closed by closedAt", () => {
    const r = computeFromIncidents(
      [
        inc({ createdAt: D("2026-01-05T00:00:00Z") }),
        inc({ createdAt: D("2026-01-20T00:00:00Z"), status: "closed", closedAt: D("2026-02-02T00:00:00Z"), resolvedAt: D("2026-02-02T00:00:00Z") }),
        inc({ createdAt: D("2026-02-10T00:00:00Z") }),
      ],
      { windowDays: 60, bucket: "month" },
    );
    expect(r.series).toHaveLength(2);
    expect(r.series[0]).toMatchObject({ periodStart: "2026-01-01", opened: 2, closed: 0 });
    expect(r.series[1]).toMatchObject({ periodStart: "2026-02-01", opened: 1, closed: 1 });
    expect(r.open).toBe(2);
    expect(r.closed).toBe(1);
  });

  it("MTTx exact averages from known timestamps", () => {
    const r = computeFromIncidents(
      [
        inc({
          createdAt: D("2026-01-01T00:00:00Z"),
          declaredAt: D("2026-01-01T00:30:00Z"), // MTTA 30
          containedAt: D("2026-01-01T02:30:00Z"), // MTTC 120 from declaredAt
          resolvedAt: D("2026-01-01T10:30:00Z"), // MTTR 600 from declaredAt
          status: "closed",
          closedAt: D("2026-01-01T10:30:00Z"),
        }),
      ],
      { windowDays: 30 },
    );
    expect(r.mttaMinutes).toBe(30);
    expect(r.mttcMinutes).toBe(120);
    expect(r.mttrMinutes).toBe(600);
  });

  it("group-by asset: multi-valued contribution + top-12 cap with Other", () => {
    const multi = computeFromIncidents(
      [inc({ affectedSystems: ["A", { name: "B" }] })],
      { windowDays: 30, groupBy: "asset" },
    );
    expect(multi.groups?.map((g) => g.key).sort()).toEqual(["A", "B"]);

    const many = computeFromIncidents(
      Array.from({ length: 15 }, (_, i) => inc({ affectedSystems: [`asset-${String(i).padStart(2, "0")}`] })),
      { windowDays: 30, groupBy: "asset" },
    );
    expect(many.groups).toHaveLength(13); // top 12 + Other
    expect(many.groups?.[12].key).toBe("__other__");
    expect(many.groups?.[12].count).toBe(3);
  });

  it("impact rollup ignores nulls; incidentsWithCost counts non-null only", () => {
    const r = computeFromIncidents(
      [
        inc({ estimatedCostUsd: 1000, recordsAffected: 50 }),
        inc({ downtimeMinutes: 90 }),
        inc({}),
      ],
      { windowDays: 30 },
    );
    expect(r.impact).toEqual({
      totalCostUsd: 1000,
      totalRecordsAffected: 50,
      totalCustomersAffected: 0,
      totalDowntimeMinutes: 90,
      incidentsWithCost: 1,
    });
  });

  it("closed count driven by isClosedStatus — recovered is NOT closed", () => {
    const r = computeFromIncidents(
      [inc({ status: "recovered", resolvedAt: D("2026-01-06T00:00:00Z") })],
      { windowDays: 30 },
    );
    expect(r.open).toBe(1);
    expect(r.closed).toBe(0);
  });

  it("false-positive rate over closed", () => {
    const r = computeFromIncidents(
      [
        inc({ status: "closed", closedAt: D("2026-01-06T00:00:00Z"), closureDisposition: "false_positive" }),
        inc({ status: "closed", closedAt: D("2026-01-07T00:00:00Z") }),
      ],
      { windowDays: 30 },
    );
    expect(r.falsePositives).toBe(1);
    expect(r.falsePositiveRate).toBe(50);
  });

  it("extractAssets tolerates junk", () => {
    expect(extractAssets(["A", { name: "B" }, { label: "C" }, 42, null, ""])).toEqual(["A", "B", "C"]);
    expect(extractAssets("not-an-array")).toEqual([]);
  });
});
