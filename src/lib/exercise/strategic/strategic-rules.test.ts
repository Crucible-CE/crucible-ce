// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ExerciseSnapshot, InjectRow, TemplateData } from "@/lib/exercise/runtime/types";
import { nextTemplateInject } from "@/lib/exercise/modes/shared/branching";
import { injectContentSchema } from "@/lib/exercise/modes/strategic/schema";
import { branchClose } from "@/lib/exercise/modes/strategic";
import { winConditionMet } from "./win";
import { contingencyContent, contingencyInputSchema } from "./contingency";
import { parseStrategicSeed } from "./seed";
import { STRATEGIC_SEED_TEMPLATES } from "./seed-data";

const teams = [
  { id: "t1", name: "Executive", seq: 1 },
  { id: "t2", name: "Legal", seq: 2 },
  { id: "t3", name: "Communications", seq: 3 },
];

function inj(id: string, seq: number, opts: { contingency?: boolean; active?: string[]; status?: InjectRow["status"]; templateInjectId?: string | null } = {}): InjectRow {
  const active = opts.active ?? ["t1", "t2"];
  return {
    id,
    seq,
    status: opts.status ?? "closed",
    source: opts.contingency ? "contingency" : "template",
    title: id,
    scenarioTime: null,
    targetTeamIds: teams.map((t) => t.id),
    content: {
      schemaVersion: 1,
      narrativeMd: "Something happens to the teams.",
      phase: "main",
      artifacts: [],
      contingency: Boolean(opts.contingency),
      teamVariants: teams.map((t) => ({ team: t.name, teamId: t.id, status: active.includes(t.id) ? "active" : "standby", narrativeMd: "x", questions: [] })),
    },
    secret: {},
    templateInjectId: opts.templateInjectId ?? null,
    budgetMs: null,
    openedAt: null,
    closesAt: null,
    closedAt: null,
    closeTrigger: null,
  };
}

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n));

function answersFor(injectIds: string[], teamIds: string[]) {
  return injectIds.flatMap((i) => teamIds.map((t) => ({ id: `${i}-${t}`, injectId: i, teamId: t, kind: "answer" })));
}

describe("win condition", () => {
  const snap = { teams, injects: [inj("i1", 1), inj("i2", 2), inj("i3", 3)] };
  const responses = answersFor(["i1", "i2", "i3"], ["t1", "t2"]);

  it("is met when every active team is effective on the last two closed injects", () => {
    const grades = responses.filter((r) => r.injectId !== "i1").map((r) => ({ responseId: r.id, source: "ai", rating: "effective", createdAt: at(1) }));
    expect(winConditionMet(snap, responses, grades)).toBe(true);
  });

  it("uses the latest human grade over a later AI grade", () => {
    const grades = responses
      .filter((r) => r.injectId !== "i1")
      .flatMap((r) => [
        { responseId: r.id, source: "human", rating: r.id === "i3-t2" ? "partially_effective" : "effective", createdAt: at(1) },
        { responseId: r.id, source: "ai", rating: "effective", createdAt: at(5) },
      ]);
    expect(winConditionMet(snap, responses, grades)).toBe(false);
  });

  it("fails when an active team did not answer or is not yet graded", () => {
    const partial = responses.filter((r) => r.id !== "i3-t2");
    const grades = partial.map((r) => ({ responseId: r.id, source: "ai", rating: "effective", createdAt: at(1) }));
    expect(winConditionMet(snap, partial, grades)).toBe(false);
    expect(winConditionMet(snap, responses, grades)).toBe(false);
  });

  it("skips contingency injects and needs two closed injects", () => {
    const withC = { teams, injects: [inj("i1", 1), inj("i2", 2), inj("c3", 3, { contingency: true })] };
    const grades = responses.filter((r) => r.injectId !== "i3").map((r) => ({ responseId: r.id, source: "ai", rating: "effective", createdAt: at(1) }));
    expect(winConditionMet(withC, responses, grades)).toBe(true);
    expect(winConditionMet({ teams, injects: [inj("i1", 1)] }, responses, grades)).toBe(false);
  });
});

describe("contingency content", () => {
  it("targets a subset of teams, active when there are questions", () => {
    const input = contingencyInputSchema.parse({ title: "Reporter calls", narrativeMd: "A reporter calls the CEO directly.", targetTeamIds: ["t3"], questions: ["What do you say to the reporter?"] });
    const c = contingencyContent(input, teams);
    expect(c.contingency).toBe(true);
    expect(c.teamVariants).toEqual([expect.objectContaining({ teamId: "t3", status: "active", questions: [{ key: "q1", text: "What do you say to the reporter?" }] })]);
    expect(injectContentSchema.safeParse(c).success).toBe(true);
    const awareness = contingencyContent(contingencyInputSchema.parse({ ...input, questions: [] }), teams);
    expect(awareness.teamVariants[0]!.status).toBe("standby");
  });

  it("refuses unknown keys and empty team lists", () => {
    expect(contingencyInputSchema.safeParse({ title: "x", narrativeMd: "Something happens.", targetTeamIds: [] }).success).toBe(false);
    expect(contingencyInputSchema.safeParse({ title: "x", narrativeMd: "Something happens.", targetTeamIds: ["t1"], secret: {} }).success).toBe(false);
  });
});

function templateData(t: (typeof STRATEGIC_SEED_TEMPLATES)[number]): TemplateData {
  const parsed = parseStrategicSeed(t);
  return {
    id: t.id,
    mode: "strategic",
    config: parsed.config,
    branching: t.branching,
    injects: parsed.injects.map((i) => ({ ...i, id: `ti-${i.nodeId}` })),
    branches: parsed.branches.map((b, k) => ({ id: `b${k}`, ...b })),
  };
}

describe("seed templates", () => {
  it("parse with the schemas and pass every check", () => {
    expect(STRATEGIC_SEED_TEMPLATES).toHaveLength(2);
    for (const t of STRATEGIC_SEED_TEMPLATES) {
      const out = parseStrategicSeed(t);
      expect(out.config.teams.length).toBeGreaterThanOrEqual(4);
      expect(out.objectives.length).toBeGreaterThan(0);
      for (const i of out.injects) {
        const active = i.content.teamVariants.filter((v) => v.status === "active");
        expect(active.length).toBeGreaterThan(0);
        for (const v of active) expect(v.questions.length).toBeGreaterThan(0);
      }
    }
    expect(STRATEGIC_SEED_TEMPLATES.find((t) => t.id === "lib-strategic-utility-ransomware")!.injects).toHaveLength(6);
  });

  it("have no dashes in player text", () => {
    for (const t of STRATEGIC_SEED_TEMPLATES) {
      for (const i of t.injects) {
        const text = [i.title, i.narrativeMd, ...i.teamVariants.flatMap((v) => [v.narrativeMd, ...v.questions.map((q) => q.text)])].join("\n");
        expect(text).not.toMatch(/[–—]/);
      }
    }
  });

  it("the branched seed follows its branches", () => {
    const t = STRATEGIC_SEED_TEMPLATES.find((x) => x.branching === "branched")!;
    const template = templateData(t);
    const exercise = { injectBudget: null } as ExerciseSnapshot["exercise"];
    const delivered: InjectRow[] = [];
    const deliver = (ti: { id: string }, seq: number) => delivered.push(inj(`e${seq}`, seq, { templateInjectId: ti.id }));

    const walk = (outcome: Record<string, unknown>) => {
      delivered.length = 0;
      const path: string[] = [];
      for (let seq = 1; seq <= 10; seq++) {
        const last = delivered.at(-1);
        const lastClose = last ? { injectId: last.id, summary: last.templateInjectId === "ti-f2" ? outcome : {} } : null;
        const next = nextTemplateInject({ template, injects: delivered, exercise }, lastClose);
        if (!next) break;
        path.push(next.nodeId);
        deliver(next, seq);
      }
      return path;
    };

    expect(walk({ avgScore: 3, outcomes: { Communications: "effective" } })).toEqual(["f1", "f2", "f3a", "f4", "f5", "f6"]);
    expect(walk({ avgScore: 3, outcomes: { Communications: "ineffective" } })).toEqual(["f1", "f2", "f3b", "f4", "f5", "f6"]);
    expect(walk({ avgScore: 1.5, outcomes: { Communications: "effective" } })).toEqual(["f1", "f2", "f3b", "f4", "f5", "f6"]);
  });

  it("branches on the template inject's outcome even after a contingency inject closed", () => {
    const f2 = inj("e2", 2, { templateInjectId: "ti-f2" });
    const c3 = inj("c3", 3, { contingency: true });
    const close = branchClose({
      snapshot: { injects: [f2, c3] } as ExerciseSnapshot,
      lastClose: { injectId: "c3", summary: {} },
      history: [
        { injectId: "e2", seq: 2, title: "f2", content: {}, responses: [{ teamId: "t3", teamName: "Communications", kind: "answer", payload: {}, rating: "ineffective", score: 1 }] },
        { injectId: "c3", seq: 3, title: "c3", content: {}, responses: [] },
      ],
    });
    expect(close).toEqual({ injectId: "e2", summary: { avgScore: 1, outcomes: { Communications: "ineffective" } } });
  });
});
