// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pickForLevel, simulateAllStrategies, simulateScoreArc, type PreviewInject } from "./preview";
import { checkInject, validateTemplate } from "./validate";
import { templateConfigSchema, templateInjectContentSchema, templateInjectSecretSchema } from "./schema";

const q = (team: string) => ({
  team,
  stem: `What does ${team} do now?`,
  options: [
    { id: "a", text: "Act" },
    { id: "b", text: "Ask" },
    { id: "c", text: "Escalate" },
    { id: "d", text: "Wait" },
  ],
  type: "standard" as const,
  capabilityKeys: [],
});
const quality = {
  a: { optimal: "great", degrading: "good", critical: "neutral" },
  b: { optimal: "good", degrading: "great", critical: "good" },
  c: { optimal: "neutral", degrading: "neutral", critical: "great" },
  d: { optimal: "bad", degrading: "bad", critical: "bad" },
} as const;

function inj(title: string, teams = ["Legal", "Comms"]): PreviewInject {
  return { title, targetTeams: [], content: { questions: teams.map(q) }, secret: { quality: Object.fromEntries(teams.map((t) => [t, quality])) } };
}

describe("score sanity preview", () => {
  it("picks the option matching a level, else the closest worse one", () => {
    expect(pickForLevel(q("x").options, quality, "optimal", "great")?.id).toBe("a");
    expect(pickForLevel(q("x").options, quality, "critical", "neutral")?.id).toBe("a");
    expect(pickForLevel([{ id: "a" }, { id: "b" }], { a: { optimal: "great" }, b: { optimal: "bad" } }, "optimal", "neutral")?.quality).toBe("bad");
  });

  it("moves the path with the cumulative score", () => {
    const arc = simulateScoreArc([inj("1"), inj("2"), inj("3")], { strategy: "bad" });
    expect(arc.map((s) => s.cumulative)).toEqual([-4, -8, -12]);
    expect(arc.map((s) => s.pathAfter)).toEqual(["critical", "critical", "critical"]);
    expect(arc[0].pathBefore).toBe("optimal");
  });

  it("uses the quality at the current path", () => {
    const arc = simulateScoreArc([inj("1"), inj("2")], { strategy: "great" });
    expect(arc.map((s) => s.pathAfter)).toEqual(["optimal", "optimal"]);
    const all = simulateAllStrategies([inj("1")]);
    expect(all.neutral[0].delta).toBe(0);
    expect(all.good[0].delta).toBe(2);
    // Good picks from optimal: +2 lands on degrading (below 4), where "good" is still +1 each.
    const good = simulateScoreArc([inj("1"), inj("2"), inj("3")], { strategy: "good" });
    expect(good.map((s) => s.pathAfter)).toEqual(["degrading", "optimal", "optimal"]);
  });
});

describe("validateTemplate", () => {
  const config = templateConfigSchema.parse({ teams: ["Legal", "Comms"], regulatoryClocks: [{ key: "gdpr_72h", label: "GDPR", durationHours: 72 }] });
  function draft(over: { offset?: number; quality?: unknown; clockEffects?: unknown; targetTeams?: string[] } = {}) {
    return {
      title: "One",
      scenarioOffsetMin: over.offset ?? 0,
      plannedDelayMin: null,
      targetTeams: over.targetTeams ?? [],
      objectiveKeys: [],
      content: templateInjectContentSchema.parse({
        variants: {
          optimal: { narrativeMd: "Something happens on the network today." },
          degrading: { narrativeMd: "Something happens on the network today." },
          critical: { narrativeMd: "Something happens on the network today." },
        },
        questions: [q("Legal"), q("Comms")],
      }),
      secret: templateInjectSecretSchema.parse({
        quality: over.quality ?? { Legal: quality, Comms: quality },
        clockEffects: over.clockEffects ?? {},
      }),
    };
  }
  const ctx = { teams: ["Legal", "Comms"], clockKeys: [] };

  it("accepts a clean template", () => {
    expect(validateTemplate({ config, injects: [draft(), draft({ offset: 30 })] })).toEqual([]);
  });

  it("flags options with missing quality", () => {
    expect(checkInject(draft({ quality: { Legal: { b: quality.b, c: quality.c, d: quality.d }, Comms: quality } }) as never, ctx).join(" ")).toContain(
      "Legal option a has no quality for the critical path",
    );
  });

  it("flags paths with no great or good option", () => {
    const n = { optimal: "neutral", degrading: "neutral", critical: "neutral" };
    const noGood = { Legal: { a: n, b: n, c: n, d: quality.d }, Comms: quality };
    expect(checkInject(draft({ quality: noGood }) as never, ctx).join(" ")).toContain("Legal has no great or good option on the optimal path");
  });

  it("flags unselected clocks and out of order scenario time", () => {
    const issues = validateTemplate({
      config,
      injects: [draft({ offset: 30, clockEffects: { Legal: { a: [{ key: "sec_8k", action: "trigger" }] } } }), draft({ offset: 10 })],
    });
    const text = issues.map((i) => i.message).join(" ");
    expect(text).toContain("uses clock sec_8k, which is not selected");
    expect(text).toContain("Scenario time must be later");
  });

  it("requires questions to match target teams", () => {
    expect(checkInject(draft({ targetTeams: ["Legal"] }) as never, ctx).join(" ")).toContain("Comms has a question but is not a target team");
  });

  it("requires a materiality question when SEC 8-K is selected", () => {
    const c = templateConfigSchema.parse({ teams: ["Legal", "Comms"], regulatoryClocks: [{ key: "sec_8k", label: "SEC", businessDays: 4 }] });
    expect(validateTemplate({ config: c, injects: [draft()] }).map((i) => i.message).join(" ")).toContain("materiality question");
  });
});
