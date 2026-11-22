"use client";

// Studio graph canvas:
// React Flow with custom inject nodes, connect to add a branch, click an edge
// to edit it, dagre auto layout and a layout direction switch. Branches are
// stored as TemplateBranch rows with branching.ts conditions; linear
// templates show seq order instead of branches.

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type OnConnect,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowDown, ArrowRight, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeCondition, conditionType } from "@/lib/exercise/studio/conditions";
import type { DraftGraph, StrategicContent } from "@/lib/exercise/studio/editor";
import { startNode } from "@/lib/exercise/studio/graph";
import type { StudioMode } from "@/lib/exercise/studio/schema";
import { absoluteTime, formatOffset } from "@/lib/exercise/studio/time";
import type { LayoutDirection } from "@/lib/exercise/studio/layout";
import { InjectNode, type InjectNodeData } from "./inject-node";

const nodeTypes = { inject: InjectNode };

const EDGE_COLORS: Record<string, string> = {
  default: "var(--color-muted-foreground)",
  always: "var(--color-muted-foreground)",
  team_outcome: "var(--mist-indigo)",
  score_below: "var(--mist-warn)",
  score_at_least: "var(--mist-ok)",
  entries_at_least: "var(--mist-indigo)",
  majority: "var(--mist-indigo)",
  path: "var(--mist-indigo)",
};

export interface CanvasProps {
  mode: StudioMode;
  graph: DraftGraph;
  severityByNode: Map<string, "error" | "warning">;
  selectedNodeId: string | null;
  selectedBranch: number | null;
  readOnly: boolean;
  direction: LayoutDirection;
  onDirection: (d: LayoutDirection) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectBranch: (index: number) => void;
  onConnect: (from: string, to: string) => void;
  onMoveNode: (nodeId: string, pos: { x: number; y: number }) => void;
  onLayout: () => void;
}

export function StudioCanvas(p: CanvasProps) {
  const { graph, mode } = p;
  const branched = graph.template.branching === "branched";
  const anchor = (graph.template.config as { scenarioAnchor?: { weekday: number; time: string } | null }).scenarioAnchor ?? null;
  const start = branched ? startNode(graph)?.nodeId : [...graph.injects].sort((a, b) => a.seq - b.seq)[0]?.nodeId;

  const derived: Node[] = useMemo(
    () =>
      graph.injects.map((i) => {
        let teamsLabel: string | null = null;
        let phase: string | null = null;
        let objectives = i.objectiveKeys;
        if (mode === "strategic") {
          const c = i.content as StrategicContent;
          const active = c.teamVariants.filter((v) => v.status === "active").length;
          teamsLabel = c.teamVariants.length ? `${active} of ${c.teamVariants.length} teams active` : "No teams";
          phase = c.phase;
        } else {
          const qs = "questions" in i.content ? i.content.questions : [];
          teamsLabel = `${qs.length} ${qs.length === 1 ? "question" : "questions"}`;
          objectives = [...new Set(qs.flatMap((q) => q.objectiveKeys))];
        }
        const data: InjectNodeData = {
          seq: i.seq,
          title: i.title,
          offset: formatOffset(i.scenarioOffsetMin),
          absolute: absoluteTime(anchor, i.scenarioOffsetMin),
          teamsLabel,
          phase,
          objectives,
          end: branched && Boolean(i.position.end),
          start: i.nodeId === start,
          selected: i.nodeId === p.selectedNodeId,
          severity: p.severityByNode.get(i.nodeId) ?? null,
          direction: p.direction,
        };
        return { id: i.nodeId, type: "inject", position: { x: i.position.x, y: i.position.y }, data, draggable: !p.readOnly };
      }),
    [graph.injects, mode, anchor, branched, start, p.selectedNodeId, p.severityByNode, p.direction, p.readOnly],
  );

  // Local copy so a drag moves smoothly; the graph gets the position on drop.
  const [nodes, setNodes] = useState<Node[]>(derived);
  const [prevDerived, setPrevDerived] = useState(derived);
  if (prevDerived !== derived) {
    setPrevDerived(derived);
    // Keep measured sizes so React Flow does not re-measure (and hide edges) on every edit.
    setNodes((cur) => {
      const measured = new Map(cur.map((n) => [n.id, n.measured]));
      return derived.map((n) => (measured.get(n.id) ? { ...n, measured: measured.get(n.id) } : n));
    });
  }

  const edges: Edge[] = useMemo(() => {
    if (!branched) {
      const ordered = [...graph.injects].sort((a, b) => a.seq - b.seq);
      return ordered.slice(1).map((n, k) => ({
        id: `seq-${ordered[k].nodeId}-${n.nodeId}`,
        source: ordered[k].nodeId,
        target: n.nodeId,
        selectable: false,
        style: { strokeDasharray: "4 4", stroke: "var(--color-border)" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-border)" },
      }));
    }
    const rank = new Map<number, number>();
    const byFrom = new Map<string, Array<{ index: number; priority: number }>>();
    graph.branches.forEach((b, index) => {
      const list = byFrom.get(b.fromNodeId) ?? [];
      list.push({ index, priority: b.priority });
      byFrom.set(b.fromNodeId, list);
    });
    for (const list of byFrom.values()) {
      list.sort((a, b) => a.priority - b.priority || a.index - b.index).forEach((x, n) => rank.set(x.index, n + 1));
    }
    return graph.branches.map((b, index) => {
      const type = conditionType(b.condition) ?? "default";
      const color = EDGE_COLORS[type] ?? EDGE_COLORS.default;
      const selected = index === p.selectedBranch;
      const many = (byFrom.get(b.fromNodeId)?.length ?? 0) > 1;
      return {
        id: `b-${index}`,
        source: b.fromNodeId,
        target: b.toNodeId,
        label: `${many ? `${rank.get(index)}. ` : ""}${describeCondition(b.condition, mode)}`,
        labelStyle: { fontSize: 11, fill: "var(--color-foreground)" },
        labelBgStyle: { fill: "var(--color-card)" },
        labelBgPadding: [4, 2] as [number, number],
        style: { stroke: color, strokeWidth: selected ? 3 : 1.5, ...(type === "default" ? { strokeDasharray: "6 3" } : {}) },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, [branched, graph.injects, graph.branches, mode, p.selectedBranch]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes.filter((c) => c.type === "position" || c.type === "dimensions"), nds));
  }, []);

  const onConnect: OnConnect = useCallback(
    (c) => {
      if (p.readOnly || !c.source || !c.target || c.source === c.target) return;
      p.onConnect(c.source, c.target);
    },
    [p],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => p.onMoveNode(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) })}
        onNodeClick={(_, node) => p.onSelectNode(node.id)}
        onEdgeClick={(_, edge) => {
          if (edge.id.startsWith("b-")) p.onSelectBranch(Number(edge.id.slice(2)));
        }}
        onPaneClick={() => p.onSelectNode(null)}
        onConnect={onConnect}
        nodesConnectable={!p.readOnly && branched}
        nodesDraggable={!p.readOnly}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!hidden md:!block" />
        <Panel position="top-right">
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant={p.direction === "TB" ? "secondary" : "outline"} aria-label="Top to bottom" title="Top to bottom" onClick={() => p.onDirection("TB")}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant={p.direction === "LR" ? "secondary" : "outline"} aria-label="Left to right" title="Left to right" onClick={() => p.onDirection("LR")}>
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={p.readOnly} onClick={p.onLayout}>
              <LayoutGrid className="h-4 w-4" />
              Auto layout
            </Button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
