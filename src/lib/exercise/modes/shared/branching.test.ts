// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ExerciseSnapshot, InjectRow, TemplateData } from "@/lib/exercise/runtime/types";
import { evaluateCondition, nextTemplateInject } from "./branching";

function ti(id: string, seq: number) {
  return {
    id,
    nodeId: `n${seq}`,
    seq,
    title: id,
    scenarioOffsetMin: 0,
    plannedDelayMin: null,
    targetTeams: [],
    expectedActions: [],
    objectiveKeys: [],
    content: {},
    secret: {},
  };
}

function delivered(templateInjectId: string, seq: number): InjectRow {
  return {
    id: `x-${templateInjectId}`,
    seq,
    status: "closed",
    source: "template",
    title: templateInjectId,
    scenarioTime: null,
    targetTeamIds: [],
    content: {},
    secret: {},
    templateInjectId,
    budgetMs: null,
    openedAt: null,
    closesAt: null,
    closedAt: null,
    closeTrigger: null,
  };
}

function snap(template: TemplateData, injects: InjectRow[] = [], injectBudget: number | null = null) {
  return {
    template,
    injects,
    exercise: { injectBudget } as ExerciseSnapshot["exercise"],
  };
}

const linear: TemplateData = {
  id: "t",
  mode: "document",
  config: {},
  branching: "linear",
  injects: [ti("a", 1), ti("b", 2), ti("c", 3)],
  branches: [],
};

describe("nextTemplateInject linear", () => {
  it("delivers in seq order and ends after the last", () => {
    expect(nextTemplateInject(snap(linear), null)?.id).toBe("a");
    expect(nextTemplateInject(snap(linear, [delivered("a", 1)]), null)?.id).toBe("b");
    expect(nextTemplateInject(snap(linear, [delivered("a", 1), delivered("b", 2), delivered("c", 3)]), null)).toBeNull();
  });
  it("respects the inject budget", () => {
    expect(nextTemplateInject(snap(linear, [delivered("a", 1)], 1), null)).toBeNull();
  });
});

const branched: TemplateData = {
  id: "t",
  mode: "strategic",
  config: {},
  branching: "branched",
  injects: [ti("a", 1), ti("good", 2), ti("bad", 3), ti("end", 4)],
  branches: [
    { id: "b1", fromNodeId: "n1", toNodeId: "n3", condition: { type: "score_below", value: 2 }, priority: 0 },
    { id: "b2", fromNodeId: "n1", toNodeId: "n2", condition: { type: "default" }, priority: 1 },
    { id: "b3", fromNodeId: "n2", toNodeId: "n4", condition: { type: "always" }, priority: 0 },
    { id: "b4", fromNodeId: "n3", toNodeId: "n4", condition: { type: "always" }, priority: 0 },
  ],
};

describe("nextTemplateInject branched", () => {
  it("starts at the root", () => {
    expect(nextTemplateInject(snap(branched), null)?.id).toBe("a");
  });
  it("follows a matching condition", () => {
    const s = snap(branched, [delivered("a", 1)]);
    expect(nextTemplateInject(s, { injectId: "x-a", summary: { avgScore: 1 } })?.id).toBe("bad");
  });
  it("falls back to the default branch", () => {
    const s = snap(branched, [delivered("a", 1)]);
    expect(nextTemplateInject(s, { injectId: "x-a", summary: { avgScore: 3.5 } })?.id).toBe("good");
  });
  it("ends at a node with no outgoing branches", () => {
    const s = snap(branched, [delivered("a", 1), delivered("good", 2), delivered("end", 3)]);
    expect(nextTemplateInject(s, null)).toBeNull();
  });
  it("never delivers a node twice", () => {
    const loop: TemplateData = {
      ...branched,
      branches: [{ id: "l", fromNodeId: "n1", toNodeId: "n1", condition: { type: "always" }, priority: 0 }],
    };
    expect(nextTemplateInject(snap(loop, [delivered("a", 1)]), null)).toBeNull();
  });
});

describe("evaluateCondition", () => {
  it("matches path and majority", () => {
    expect(evaluateCondition({ type: "path", path: "critical" }, { newPath: "critical" })).toBe(true);
    expect(evaluateCondition({ type: "majority", team: "Legal", optionId: "b" }, { majority: { Legal: "b" } })).toBe(true);
  });
  it("rejects malformed conditions", () => {
    expect(evaluateCondition({ type: "nope" }, {})).toBe(false);
    expect(evaluateCondition(null, {})).toBe(false);
  });
});
