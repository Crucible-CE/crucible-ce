// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STRATEGIC_SEED_TEMPLATES } from "@/lib/exercise/strategic/seed-data";
import { parseStrategicSeed } from "@/lib/exercise/strategic/seed";
import { validateStudio, type RawGraph } from "./validate";
import { addBranch, addInject, normalizeGraph, pathTo, removeInject, renameTeam, setBranching, toPutGraph, type DraftGraph } from "./editor";
import { conditionType } from "./conditions";

function seedGraph(id: string): RawGraph {
  const t = STRATEGIC_SEED_TEMPLATES.find((x) => x.id === id)!;
  const p = parseStrategicSeed(t);
  return {
    template: { title: t.title, summary: t.summary, branching: t.branching, config: p.config, objectives: p.objectives },
    injects: p.injects.map((i) => ({
      nodeId: i.nodeId,
      seq: i.seq,
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      objectiveKeys: i.objectiveKeys,
      content: i.content,
      secret: i.secret,
      position: i.position,
    })),
    branches: p.branches,
  };
}

const clone = <T,>(v: T): T => structuredClone(v);

describe("studio validation", () => {
  it("passes the linear seed template", () => {
    const { issues, graph } = validateStudio("strategic", seedGraph("lib-strategic-utility-ransomware"));
    expect(graph).not.toBeNull();
    expect(issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("passes the branched seed template, whose last node is marked as the end", () => {
    const raw = seedGraph("lib-strategic-fintech-breach");
    expect(validateStudio("strategic", raw).issues.filter((i) => i.severity !== "info")).toEqual([]);
    // Without the end marker the last node is a dead end.
    const last = raw.injects.at(-1) as { position: Record<string, unknown> };
    last.position = { x: last.position.x, y: last.position.y };
    expect(validateStudio("strategic", raw).issues.filter((i) => i.severity !== "info").map((i) => i.code)).toEqual(["dead_end"]);
  });

  it("refuses duplicate team names", () => {
    const raw = seedGraph("lib-strategic-utility-ransomware");
    const t = raw.template as { config: { teams: string[] } };
    t.config.teams = [...t.config.teams, "legal"];
    const { issues } = validateStudio("strategic", raw);
    expect(issues.some((i) => i.code === "duplicate_team" && i.severity === "error")).toBe(true);
  });

  it("warns on an inject with no team variants and errors on an unknown team", () => {
    const raw = seedGraph("lib-strategic-utility-ransomware");
    const first = raw.injects[0] as { nodeId: string; content: { teamVariants: Array<{ team: string }> }; secret: { expectedActions: Record<string, string[]> } };
    const second = clone(raw.injects[1]) as typeof first;
    first.content.teamVariants = [];
    first.secret.expectedActions = {};
    second.content.teamVariants[0].team = "Board";
    raw.injects[1] = second;
    const { issues } = validateStudio("strategic", raw);
    expect(issues.find((i) => i.nodeId === first.nodeId && i.code === "no_variants")?.severity).toBe("warning");
    expect(issues.find((i) => i.nodeId === second.nodeId && i.code === "unknown_team")?.severity).toBe("error");
  });

  it("maps schema problems to the node with a plain message", () => {
    const raw = seedGraph("lib-strategic-utility-ransomware");
    const n = raw.injects[0] as { nodeId: string; content: { narrativeMd: string } };
    n.content.narrativeMd = "short";
    const { issues, graph } = validateStudio("strategic", raw);
    expect(graph).toBeNull();
    expect(issues).toContainEqual(expect.objectContaining({ nodeId: n.nodeId, severity: "error", message: "Narrative is too short." }));
  });

  it("errors when a branch names a team that is not in the template", () => {
    const raw = seedGraph("lib-strategic-fintech-breach");
    (raw.branches[1] as { condition: { team: string } }).condition.team = "Nobody";
    const { issues } = validateStudio("strategic", raw);
    expect(issues.some((i) => i.code === "unknown_team" && i.branch === 1)).toBe(true);
  });
});

describe("studio editor operations", () => {
  const base = (): DraftGraph => {
    const raw = seedGraph("lib-strategic-utility-ransomware");
    const t = raw.template as { title: string; summary: string | null; branching: string; config: unknown; objectives: unknown };
    return normalizeGraph("strategic", t, raw.injects, raw.branches);
  };

  it("normalizes the stored graph without changing valid content", () => {
    const g = base();
    expect(validateStudio("strategic", toPutGraph("strategic", g)).issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("switches to branched by following the order and marks the last node as the end", () => {
    const g = setBranching(base(), "branched");
    expect(g.branches).toHaveLength(g.injects.length - 1);
    expect(g.injects.at(-1)!.position.end).toBe(true);
    expect(validateStudio("strategic", toPutGraph("strategic", g)).issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("adds conditions ahead of the Otherwise branch", () => {
    let g = setBranching(base(), "branched");
    const [a, , c] = g.injects;
    g = addBranch("strategic", g, a.nodeId, c.nodeId);
    const out = g.branches.filter((b) => b.fromNodeId === a.nodeId).sort((x, y) => x.priority - y.priority);
    expect(out.map((b) => conditionType(b.condition))).toEqual(["team_outcome", "default"]);
    expect(out.map((b) => b.priority)).toEqual([0, 1]);
  });

  it("renames a team in variants, expected actions and branches", () => {
    let g = setBranching(base(), "branched");
    g = addBranch("strategic", g, g.injects[0].nodeId, g.injects[2].nodeId, { type: "team_outcome", team: "Legal", outcome: "ineffective" });
    g = renameTeam(g, "Legal", "Counsel");
    expect(g.template.config.teams).toContain("Counsel");
    const json = JSON.stringify(g);
    expect(json).not.toContain('"Legal"');
  });

  it("removes a node with its branches and keeps seq dense", () => {
    let g = setBranching(base(), "branched");
    g = removeInject(g, g.injects[1].nodeId);
    expect(g.injects.map((i) => i.seq)).toEqual(g.injects.map((_, n) => n + 1));
    expect(g.branches.every((b) => g.injects.some((i) => i.nodeId === b.fromNodeId) && g.injects.some((i) => i.nodeId === b.toNodeId))).toBe(true);
  });

  it("adds a new empty node and finds the path to a node", () => {
    const g0 = base();
    const { graph, nodeId } = addInject("strategic", g0, null);
    expect(graph.injects.find((i) => i.nodeId === nodeId)?.seq).toBe(g0.injects.length + 1);
    expect(pathTo(graph, nodeId)).toHaveLength(g0.injects.length);
  });
});
