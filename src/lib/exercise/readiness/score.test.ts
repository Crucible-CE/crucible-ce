import { describe, expect, it } from "vitest";
import {
  ATTACK_TARGET,
  READINESS_COMPONENTS,
  computeReadiness,
  ratingsTrend,
  scoreAarTimeliness,
  scoreAttack,
  scoreCadence,
  scorePlaybooks,
  scoreRatings,
  scoreRoles,
  scoreWorkItems,
  type ReadinessInputs,
} from "./score";

const now = new Date("2026-10-26T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

function inputs(over: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    cadence: [{ status: "current" }],
    exercisesLast12: 2,
    roles: [{ role: "Legal", present: 2, total: 2 }],
    ratings: [{ rating: "P", endedAt: daysAgo(10) }],
    workItems: { open: 0, overdue: 0, openHigh: 0, stale: 0 },
    aar: { ended: 2, overdue: 0 },
    techniques: ATTACK_TARGET,
    playbooks: { total: 2, own: 1, exercised: 1, run: 0, used: 1 },
    ...over,
  };
}

describe("weights", () => {
  it("sum to 100 with seven components", () => {
    expect(READINESS_COMPONENTS.reduce((n, c) => n + c.weight, 0)).toBe(100);
    expect(READINESS_COMPONENTS.map((c) => c.key)).toEqual(["cadence", "roles", "ratings", "workItems", "aarTimeliness", "attack", "playbooks"]);
  });

  it("score 100 when every component is full", () => {
    const r = computeReadiness(inputs(), now);
    expect(r.score).toBe(100);
    expect(r.components.every((c) => c.score === 100)).toBe(true);
    expect(r.components.find((c) => c.key === "cadence")!.points).toBe(20);
  });

  it("scale the rest to 100 when a component is not counted", () => {
    const r = computeReadiness(inputs({ roles: [] }), now);
    const roles = r.components.find((c) => c.key === "roles")!;
    expect(roles.score).toBeNull();
    expect(roles.points).toBe(0);
    expect(roles.explanation).toBe("No required roles in policy.");
    expect(r.score).toBe(100);
    expect(r.components.find((c) => c.key === "cadence")!.points).toBeCloseTo((100 * 20) / 85, 2);
  });

  it("weight each component by its share", () => {
    // Cadence 0 of 1 current: loses its full 20 points.
    expect(computeReadiness(inputs({ cadence: [{ status: "overdue" }] }), now).score).toBe(80);
    // Half the ATT&CK target: loses 5 of 10.
    expect(computeReadiness(inputs({ techniques: ATTACK_TARGET / 2 }), now).score).toBe(95);
  });

  it("is 0 for an empty program", () => {
    const r = computeReadiness(
      { cadence: [], exercisesLast12: 0, roles: [], ratings: [], workItems: { open: 0, overdue: 0, openHigh: 0, stale: 0 }, aar: { ended: 0, overdue: 0 }, techniques: 0, playbooks: { total: 0, own: 0, exercised: 0, run: 0, used: 0 } },
      now,
    );
    // Cadence 0, work items 100 (nothing open), ATT&CK 0, playbooks 0; roles, ratings and reports not counted.
    expect(r.score).toBe(Math.round((100 * 20) / 60));
  });

  it("explanations are one plain sentence or two, no dashes", () => {
    for (const c of computeReadiness(inputs({ workItems: { open: 3, overdue: 1, openHigh: 2, stale: 1 } }), now).components) {
      expect(c.explanation).toMatch(/\.$/);
      expect(c.explanation).not.toMatch(/[–—]/);
    }
  });
});

describe("components", () => {
  it("cadence counts due soon as current and falls back to a recent exercise", () => {
    expect(scoreCadence({ cadence: [{ status: "current" }, { status: "due_soon" }, { status: "never" }, { status: "overdue" }], exercisesLast12: 1 }).score).toBe(50);
    expect(scoreCadence({ cadence: [], exercisesLast12: 1 }).score).toBe(100);
    expect(scoreCadence({ cadence: [], exercisesLast12: 0 }).score).toBe(0);
  });

  it("roles average attendance per role", () => {
    expect(scoreRoles({ roles: [{ role: "Legal", present: 1, total: 2 }, { role: "PR", present: 2, total: 2 }], exercisesLast12: 2 }).score).toBe(75);
    expect(scoreRoles({ roles: [{ role: "Legal", present: 0, total: 0 }], exercisesLast12: 0 }).score).toBe(0);
  });

  it("ratings use P 100, S 67, M 33, U 0 and ignore N", () => {
    const r = scoreRatings(
      ["P", "S", "M", "U", "N"].map((rating) => ({ rating, endedAt: daysAgo(10) })),
      now,
    );
    expect(r.score).toBe(50);
    expect(scoreRatings([{ rating: "N", endedAt: daysAgo(1) }], now).score).toBeNull();
  });

  it("ratings trend compares the last 6 months with the 6 before", () => {
    const earlier = { rating: "M", endedAt: daysAgo(300) };
    expect(ratingsTrend([earlier, { rating: "P", endedAt: daysAgo(20) }], now)).toBe("up");
    expect(ratingsTrend([{ rating: "P", endedAt: daysAgo(300) }, { rating: "U", endedAt: daysAgo(20) }], now)).toBe("down");
    expect(ratingsTrend([earlier, { rating: "M", endedAt: daysAgo(20) }], now)).toBe("flat");
    expect(ratingsTrend([{ rating: "P", endedAt: daysAgo(20) }], now)).toBeNull();
    expect(scoreRatings([earlier, { rating: "P", endedAt: daysAgo(20) }], now).explanation).toContain("Improving.");
  });

  it("work items weigh overdue 50, stale 30 and high priority 20", () => {
    expect(scoreWorkItems({ open: 0, overdue: 0, openHigh: 0, stale: 0 }).score).toBe(100);
    expect(scoreWorkItems({ open: 4, overdue: 0, openHigh: 0, stale: 0 }).score).toBe(100);
    expect(scoreWorkItems({ open: 4, overdue: 4, openHigh: 0, stale: 0 }).score).toBe(50);
    expect(scoreWorkItems({ open: 4, overdue: 0, openHigh: 0, stale: 4 }).score).toBe(70);
    expect(scoreWorkItems({ open: 10, overdue: 0, openHigh: 10, stale: 0 }).score).toBe(80);
    expect(scoreWorkItems({ open: 10, overdue: 10, openHigh: 10, stale: 10 }).score).toBe(0);
  });

  it("report timeliness is the share without a past-due report", () => {
    expect(scoreAarTimeliness({ ended: 4, overdue: 1 }).score).toBe(75);
    expect(scoreAarTimeliness({ ended: 0, overdue: 0 }).score).toBeNull();
  });

  it("ATT&CK caps at the target", () => {
    expect(scoreAttack(0).score).toBe(0);
    expect(scoreAttack(ATTACK_TARGET * 3).score).toBe(100);
  });

  it("playbooks give 30 for any, 30 for your own, 40 by the share exercised or run on an incident", () => {
    const pb = (total: number, own: number, exercised: number, run: number, used: number) => scorePlaybooks({ total, own, exercised, run, used });
    expect(pb(0, 0, 0, 0, 0).score).toBe(0);
    expect(pb(4, 0, 0, 0, 0).score).toBe(30);
    expect(pb(4, 2, 0, 0, 0).score).toBe(60);
    expect(pb(4, 2, 1, 0, 1).score).toBe(80);
    expect(pb(4, 2, 2, 0, 2).score).toBe(100);
  });

  it("an incident playbook run counts like an exercise, and a playbook in both counts once", () => {
    expect(scorePlaybooks({ total: 4, own: 2, exercised: 0, run: 1, used: 1 }).score).toBe(80);
    const both = scorePlaybooks({ total: 4, own: 2, exercised: 1, run: 1, used: 1 });
    expect(both.score).toBe(80);
    expect(both.explanation).toBe("1 of 2 own playbooks used in 12 months: 1 exercised, 1 run on an incident.");
    expect(scorePlaybooks({ total: 4, own: 2, exercised: 2, run: 2, used: 2 }).score).toBe(100);
  });
});
