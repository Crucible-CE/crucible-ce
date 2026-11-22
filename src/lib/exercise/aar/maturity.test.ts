// Capability maturity data: grouping by capability, the mean per exercise,
// the latest rating and the trend. Pure, no database.
import { describe, expect, it } from "vitest";
import { buildMaturity, ratingFor, trendOf, type MaturityInput } from "./maturity";
import { aarFiltersFrom } from "./register";

const caps = [
  { id: "c1", key: "PR.AT", name: "Awareness and training", seq: 2 },
  { id: "c2", key: "RS.CO", name: "Communications", seq: 1 },
  { id: "c3", key: "ID.AM", name: "Asset management", seq: 3 },
];

function input(p: Partial<MaturityInput> & Pick<MaturityInput, "exerciseId" | "rating" | "capabilityIds">): MaturityInput {
  return {
    objectiveId: `${p.exerciseId}-${Math.random().toString(36).slice(2)}`,
    objectiveText: "Decide on containment within the first hour.",
    exerciseTitle: p.exerciseId === "e1" ? "Spring drill" : "Autumn drill",
    endedAt: p.exerciseId === "e1" ? new Date("2026-03-04T16:00:00Z") : new Date("2026-09-10T16:00:00Z"),
    ...p,
  };
}

describe("capability maturity", () => {
  it("groups ratings by capability, oldest exercise first, with the mean per exercise", () => {
    const data = buildMaturity(
      [
        input({ exerciseId: "e2", rating: "P", capabilityIds: ["c1"] }),
        input({ exerciseId: "e1", rating: "M", capabilityIds: ["c1"] }),
        input({ exerciseId: "e1", rating: "U", capabilityIds: ["c1", "c2"] }),
        input({ exerciseId: "e2", rating: "S", capabilityIds: ["c2"] }),
      ],
      caps,
    );
    expect(data.exerciseCount).toBe(2);
    expect(data.start).toBe("2026-03-04T16:00:00.000Z");
    expect(data.end).toBe("2026-09-10T16:00:00.000Z");
    // Sorted by capability seq: RS.CO (1) before PR.AT (2).
    expect(data.rows.map((r) => r.key)).toEqual(["RS.CO", "PR.AT"]);
    const pr = data.rows.find((r) => r.key === "PR.AT")!;
    expect(pr.exercises.map((e) => [e.exerciseId, e.score])).toEqual([
      ["e1", 1.5],
      ["e2", 4],
    ]);
    expect(pr.points.map((p) => p.rating)).toEqual(["M", "U", "P"]);
    expect(pr.latest).toBe("P");
    expect(pr.trend).toBe("improving");
    const rs = data.rows.find((r) => r.key === "RS.CO")!;
    expect(rs.exercises.map((e) => e.score)).toEqual([1, 3]);
    expect(rs.latest).toBe("S");
  });

  it("leaves out Not evaluated, unknown capabilities and objectives with none", () => {
    const data = buildMaturity(
      [
        input({ exerciseId: "e1", rating: "N", capabilityIds: ["c1"] }),
        input({ exerciseId: "e1", rating: "S", capabilityIds: [] }),
        input({ exerciseId: "e1", rating: "S", capabilityIds: ["gone"] }),
      ],
      caps,
    );
    expect(data.rows).toEqual([]);
    expect(data.exerciseCount).toBe(0);
    expect(data.start).toBeNull();
  });

  it("one exercise has no trend; a drop is declining, a small change is steady", () => {
    const one = buildMaturity([input({ exerciseId: "e1", rating: "S", capabilityIds: ["c3"] })], caps);
    expect(one.rows[0].trend).toBeNull();
    expect(one.rows[0].latest).toBe("S");
    const ex = (score: number) => ({ exerciseId: "x", exerciseTitle: "x", endedAt: "2026-01-01T00:00:00.000Z", score });
    expect(trendOf([ex(4), ex(2)])).toBe("declining");
    expect(trendOf([ex(3), ex(3.2)])).toBe("stable");
    expect(ratingFor(3.5)).toBe("P");
    expect(ratingFor(2.4)).toBe("M");
    expect(ratingFor(0)).toBe("U");
  });
});

describe("after-action report list filters", () => {
  it("keeps valid values and drops the rest", () => {
    expect(aarFiltersFrom({ status: "final", mode: "crisissim", from: "2026-01-01", to: "2026-12-31", q: "  drill " })).toEqual({
      status: "final",
      mode: "crisissim",
      from: "2026-01-01",
      to: "2026-12-31",
      q: "drill",
    });
    expect(aarFiltersFrom({ status: "signed", mode: "opex", from: "yesterday", to: "2026-13-45", q: "   " })).toEqual({});
    expect(aarFiltersFrom({ status: ["review", "final"] })).toEqual({ status: "review" });
  });
});
