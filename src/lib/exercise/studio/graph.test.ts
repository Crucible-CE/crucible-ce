// @vitest-environment node
import { describe, expect, it } from "vitest";
import { findCycles, reachable, startNode, validateGraph, type GraphInput } from "./graph";

const node = (nodeId: string, seq: number, end = false) => ({ nodeId, seq, title: nodeId.toUpperCase(), position: end ? { end: true } : {} });
const edge = (fromNodeId: string, toNodeId: string, condition: unknown = { type: "default" }, priority = 0) => ({ fromNodeId, toNodeId, condition, priority });
const codes = (g: GraphInput) => validateGraph(g).map((i) => `${i.severity}:${i.code}:${i.nodeId ?? ""}`);

describe("studio graph checks", () => {
  it("accepts a clean branched graph with a marked end", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2), node("c", 3), node("d", 4, true)],
      branches: [
        edge("a", "c", { type: "team_outcome", team: "Legal", outcome: "ineffective" }, 0),
        edge("a", "b", { type: "default" }, 1),
        edge("b", "d"),
        edge("c", "d"),
      ],
    };
    expect(validateGraph(g)).toEqual([]);
    expect(startNode(g)?.nodeId).toBe("a");
    expect([...reachable(g)].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("finds cycles and refuses them as errors", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2), node("c", 3)],
      branches: [edge("a", "b"), edge("b", "c"), edge("c", "b", { type: "score_below", value: 2 }), edge("c", "a", { type: "always" })],
    };
    expect(findCycles(g).length).toBeGreaterThan(0);
    const issues = validateGraph(g);
    expect(issues.some((i) => i.code === "cycle" && i.severity === "error")).toBe(true);
  });

  it("flags a self loop", () => {
    const g: GraphInput = { branching: "branched", injects: [node("a", 1), node("b", 2, true)], branches: [edge("a", "a"), edge("a", "b", { type: "always" })] };
    expect(codes(g)).toContain("error:self_loop:a");
  });

  it("flags nodes that cannot be reached from the start", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2, true), node("orphan", 3, true)],
      branches: [edge("a", "b")],
    };
    expect(codes(g)).toContain("warning:unreachable:orphan");
  });

  it("flags a node whose conditions may all fail", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2, true), node("c", 3, true)],
      branches: [edge("a", "b", { type: "score_below", value: 2 }), edge("a", "c", { type: "score_at_least", value: 3 }, 1)],
    };
    expect(codes(g)).toContain("warning:missing_default:a");
  });

  it("flags dead ends that are not marked as end nodes", () => {
    const g: GraphInput = { branching: "branched", injects: [node("a", 1), node("b", 2)], branches: [edge("a", "b")] };
    expect(codes(g)).toContain("warning:dead_end:b");
    g.injects[1] = node("b", 2, true);
    expect(codes(g)).not.toContain("warning:dead_end:b");
  });

  it("flags branches an earlier Always branch hides", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2, true), node("c", 3, true)],
      branches: [edge("a", "b", { type: "always" }, 0), edge("a", "c", { type: "score_below", value: 1 }, 1)],
    };
    expect(validateGraph(g).filter((i) => i.code === "shadowed")).toHaveLength(1);
  });

  it("refuses branches to unknown nodes and invalid conditions", () => {
    const g: GraphInput = {
      branching: "branched",
      injects: [node("a", 1), node("b", 2, true)],
      branches: [edge("a", "zzz"), edge("a", "b", { type: "score_below" })],
    };
    const c = codes(g);
    expect(c).toContain("error:unknown_node:a");
  });

  it("refuses duplicate node ids", () => {
    const g: GraphInput = { branching: "linear", injects: [node("a", 1), node("a", 2)], branches: [] };
    expect(codes(g)).toContain("error:duplicate_node:a");
  });

  it("ignores branches while linear", () => {
    const g: GraphInput = { branching: "linear", injects: [node("a", 1), node("b", 2)], branches: [edge("a", "b"), edge("b", "a")] };
    expect(validateGraph(g).every((i) => i.severity === "info")).toBe(true);
  });

  it("reports no start when every node has a branch into it", () => {
    const g: GraphInput = { branching: "branched", injects: [node("a", 1), node("b", 2)], branches: [edge("a", "b"), edge("b", "a")] };
    expect(codes(g)).toContain("error:no_start:");
  });
});
