// Dagre auto layout for the Studio canvas. Pure.

import dagre from "dagre";

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 112;

export type LayoutDirection = "TB" | "LR";

/** Top-left positions for each node id. */
export function autoLayout(
  nodeIds: string[],
  edges: Array<{ from: string; to: string }>,
  direction: LayoutDirection = "TB",
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 48, ranksep: 72 });
  const ids = new Set(nodeIds);
  for (const id of nodeIds) g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) if (ids.has(e.from) && ids.has(e.to) && e.from !== e.to) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const id of nodeIds) {
    const n = g.node(id);
    out.set(id, { x: Math.round(n.x - NODE_WIDTH / 2), y: Math.round(n.y - NODE_HEIGHT / 2) });
  }
  return out;
}

/** Edges used for layout: branches when branched, seq order when linear. */
export function layoutEdges(
  branching: "linear" | "branched",
  injects: Array<{ nodeId: string; seq: number }>,
  branches: Array<{ fromNodeId: string; toNodeId: string }>,
): Array<{ from: string; to: string }> {
  if (branching === "branched") return branches.map((b) => ({ from: b.fromNodeId, to: b.toNodeId }));
  const ordered = [...injects].sort((a, b) => a.seq - b.seq);
  return ordered.slice(1).map((n, i) => ({ from: ordered[i].nodeId, to: n.nodeId }));
}
