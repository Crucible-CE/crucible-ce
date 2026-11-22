// Graph checks for a branched template. Pure. Mirrors the runtime rules in
// src/modes/shared/branching.ts:
//   - the run starts at the lowest seq node with no incoming branch;
//   - outgoing branches are tried in priority order, "default" only when
//     nothing else matches;
//   - a node with no outgoing branch ends the run;
//   - a node never runs twice, so a branch back to a delivered node ends it.
//
// Severity: error blocks saving, warning blocks publishing, info is a hint.

import { branchConditionSchema } from "@/lib/exercise/modes/shared/branching";
import { NODE_ID_RE } from "./schema";

export type IssueSeverity = "error" | "warning" | "info";

export interface StudioIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Node the issue belongs to, or null for the template. */
  nodeId: string | null;
  /** Index into branches[] when the issue is about one branch. */
  branch?: number;
}

export interface GraphNode {
  nodeId: string;
  seq: number;
  title: string;
  position?: { end?: boolean } | null;
}

export interface GraphEdge {
  fromNodeId: string;
  toNodeId: string;
  condition: unknown;
  priority: number;
}

export interface GraphInput {
  branching: "linear" | "branched";
  injects: GraphNode[];
  branches: GraphEdge[];
}

/** The node a branched run starts at: lowest seq with no incoming branch. */
export function startNode(g: Pick<GraphInput, "injects" | "branches">): GraphNode | null {
  const ordered = [...g.injects].sort((a, b) => a.seq - b.seq);
  const targets = new Set(g.branches.map((b) => b.toNodeId));
  return ordered.find((i) => !targets.has(i.nodeId)) ?? null;
}

/** Outgoing branches of a node, in the order the runtime tries them. */
export function outgoing(g: Pick<GraphInput, "branches">, nodeId: string): Array<GraphEdge & { index: number }> {
  return g.branches
    .map((b, index) => ({ ...b, index }))
    .filter((b) => b.fromNodeId === nodeId)
    .sort((a, b) => a.priority - b.priority || a.index - b.index);
}

/** Node ids reachable from the start node. */
export function reachable(g: Pick<GraphInput, "injects" | "branches">): Set<string> {
  const start = startNode(g);
  const seen = new Set<string>();
  if (!start) return seen;
  const stack = [start.nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const b of g.branches) if (b.fromNodeId === id && !seen.has(b.toNodeId)) stack.push(b.toNodeId);
  }
  return seen;
}

/** Each cycle once, as the list of node ids on it. Self loops included. */
export function findCycles(g: Pick<GraphInput, "injects" | "branches">): string[][] {
  const ids = g.injects.map((i) => i.nodeId);
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const b of g.branches) if (adj.has(b.fromNodeId) && adj.has(b.toNodeId)) adj.get(b.fromNodeId)!.push(b.toNodeId);
  const state = new Map<string, 0 | 1 | 2>(); // 0 new, 1 on stack, 2 done
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();

  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const to of adj.get(id) ?? []) {
      const s = state.get(to) ?? 0;
      if (s === 0) visit(to);
      else if (s === 1) {
        const cycle = stack.slice(stack.indexOf(to));
        const key = [...cycle].sort().join("|");
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          cycles.push(cycle);
        }
      }
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of ids) if ((state.get(id) ?? 0) === 0) visit(id);
  return cycles;
}

const typeOf = (c: unknown) => branchConditionSchema.safeParse(c).data?.type ?? null;

export function validateGraph(g: GraphInput): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const add = (severity: IssueSeverity, code: string, message: string, nodeId: string | null = null, branch?: number) =>
    issues.push({ severity, code, message, nodeId, ...(branch !== undefined ? { branch } : {}) });

  const titleOf = new Map(g.injects.map((i) => [i.nodeId, i.title.trim() || "Untitled"]));
  const ids = new Set<string>();
  for (const n of g.injects) {
    if (!NODE_ID_RE.test(n.nodeId)) add("error", "node_id", "This node has an id that is not allowed.", n.nodeId);
    if (ids.has(n.nodeId)) add("error", "duplicate_node", `Two nodes use the id ${n.nodeId}.`, n.nodeId);
    ids.add(n.nodeId);
  }

  if (g.branching === "linear") {
    if (g.branches.length) add("info", "linear_branches", "Branches are kept but not used while the template is linear.");
    return issues;
  }

  if (g.injects.length > 0 && g.branches.length === 0) {
    add("warning", "no_branches", "A branched template needs at least one branch. Add one or switch to linear.");
  }

  let structural = false;
  const edgeKeys = new Set<string>();
  for (const [i, b] of g.branches.entries()) {
    if (!ids.has(b.fromNodeId) || !ids.has(b.toNodeId)) {
      add("error", "unknown_node", "A branch points to a node that does not exist. Remove it.", ids.has(b.fromNodeId) ? b.fromNodeId : null, i);
      structural = true;
      continue;
    }
    if (!branchConditionSchema.safeParse(b.condition).success) {
      add("error", "invalid_condition", "A branch has a condition that is not valid. Edit or remove it.", b.fromNodeId, i);
    }
    if (b.fromNodeId === b.toNodeId) {
      add("error", "self_loop", `${titleOf.get(b.fromNodeId)} branches to itself. Point the branch at another node.`, b.fromNodeId, i);
    }
    const key = `${b.fromNodeId}>${b.toNodeId}>${JSON.stringify(b.condition)}`;
    if (edgeKeys.has(key)) add("warning", "duplicate_branch", "Two branches are the same. Remove one.", b.fromNodeId, i);
    edgeKeys.add(key);
  }
  if (structural || g.injects.length === 0) return issues;

  for (const cycle of findCycles(g)) {
    if (cycle.length === 1) continue; // reported as a self loop
    const names = cycle.map((id) => titleOf.get(id)).join(", ");
    add("error", "cycle", `Branches form a loop through ${names}. A node runs once, so the run would end there.`, cycle[0]);
  }

  const start = startNode(g);
  if (!start) {
    add("error", "no_start", "Every node has a branch into it. One node must start the run.");
  } else {
    const seen = reachable(g);
    for (const n of g.injects) {
      if (!seen.has(n.nodeId)) add("warning", "unreachable", `${titleOf.get(n.nodeId)} cannot be reached from the start node.`, n.nodeId);
    }
  }

  for (const n of g.injects) {
    const out = outgoing(g, n.nodeId);
    const name = titleOf.get(n.nodeId);
    if (out.length === 0) {
      if (!n.position?.end) add("warning", "dead_end", `${name} has no branch out. Mark it as an end node or add a branch.`, n.nodeId);
      continue;
    }
    if (n.position?.end) add("info", "end_with_branches", `${name} is marked as an end node but has branches out.`, n.nodeId);

    const types = out.map((b) => typeOf(b.condition));
    const hasFallback = types.some((t) => t === "always" || t === "default");
    if (!hasFallback) {
      add("warning", "missing_default", `If no condition matches after ${name}, the run ends. Add an Otherwise branch.`, n.nodeId);
    }
    const defaults = out.filter((b) => typeOf(b.condition) === "default");
    for (const extra of defaults.slice(1)) {
      add("warning", "extra_default", `${name} has more than one Otherwise branch. Only the first is used.`, n.nodeId, extra.index);
    }
    const firstAlways = out.findIndex((b) => typeOf(b.condition) === "always");
    if (firstAlways >= 0) {
      // Conditions after an Always branch are never tried, and Otherwise only
      // runs when nothing matched, which an Always branch rules out.
      for (const [k, b] of out.entries()) {
        if (k > firstAlways || (k < firstAlways && typeOf(b.condition) === "default")) {
          add("warning", "shadowed", `A branch from ${name} never runs because an Always branch matches first.`, n.nodeId, b.index);
        }
      }
    }
    const priorities = new Set<number>();
    for (const b of out) {
      if (priorities.has(b.priority)) {
        add("info", "same_priority", `Two branches from ${name} share a priority. List order decides.`, n.nodeId, b.index);
        break;
      }
      priorities.add(b.priority);
    }
  }
  return issues;
}

/** Errors block saving. */
export function hasErrors(issues: StudioIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Errors and warnings block publishing. */
export function blocksPublish(issues: StudioIssue[]): boolean {
  return issues.some((i) => i.severity === "error" || i.severity === "warning");
}
