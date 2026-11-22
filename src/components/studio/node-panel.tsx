"use client";

// The selected node: shared fields, then the mode's inject fields.

import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NumberField } from "@/components/templates/editor/fields";
import { STRATEGIC_LABELS as L } from "@/lib/exercise/build-guide/labels";
import type { StudioIssue } from "@/lib/exercise/studio/graph";
import { moveInject, updateInject, type DraftGraph, type DraftInject } from "@/lib/exercise/studio/editor";
import type { StudioMode } from "@/lib/exercise/studio/schema";
import { absoluteTime, formatOffset } from "@/lib/exercise/studio/time";
import { IssueLines } from "./bits";
import { DocumentPanel } from "./document-panel";
import { StrategicPanel } from "./strategic-panel";

type Options = Array<{ value: string; label: string }>;

export function NodePanel({
  mode,
  templateId,
  graph,
  nodeId,
  readOnly,
  issues,
  capabilities,
  sections,
  rubricKeys,
  update,
  onDuplicate,
  onDelete,
}: {
  mode: StudioMode;
  templateId: string;
  graph: DraftGraph;
  nodeId: string | null;
  readOnly: boolean;
  issues: StudioIssue[];
  capabilities: Options;
  sections: Options;
  rubricKeys: string[];
  update: (fn: (g: DraftGraph) => DraftGraph) => void;
  onDuplicate: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}) {
  const inject = nodeId ? graph.injects.find((i) => i.nodeId === nodeId) : null;
  if (!inject) return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Select an inject on the canvas, or add one.</p>;
  const onChange = (fn: (i: DraftInject) => DraftInject) => update((g) => updateInject(g, inject.nodeId, fn));
  const anchor = (graph.template.config as { scenarioAnchor?: { weekday: number; time: string } | null }).scenarioAnchor ?? null;
  const absolute = absoluteTime(anchor, inject.scenarioOffsetMin);
  const count = graph.injects.length;
  const branched = graph.template.branching === "branched";
  const nodeIssues = issues.filter((i) => i.nodeId === inject.nodeId);

  return (
    <div key={inject.nodeId} className="flex flex-col gap-5">
      <IssueLines issues={nodeIssues} />
      <fieldset disabled={readOnly} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[color:var(--color-muted-foreground)]">
            {L.inject} {inject.seq} of {count}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Move earlier" disabled={inject.seq <= 1} onClick={() => update((g) => moveInject(g, inject.nodeId, -1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Move later" disabled={inject.seq >= count} onClick={() => update((g) => moveInject(g, inject.nodeId, 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Duplicate inject" onClick={() => onDuplicate(inject.nodeId)}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Delete inject" onClick={() => onDelete(inject.nodeId)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Field label={L.title} htmlFor="node-title">
          <Input id="node-title" value={inject.title} maxLength={160} onChange={(e) => onChange((i) => ({ ...i, title: e.target.value }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={L.scenarioMinute} htmlFor="node-offset" hint={absolute ? `${formatOffset(inject.scenarioOffsetMin)}, ${absolute}` : formatOffset(inject.scenarioOffsetMin)}>
            <NumberField id="node-offset" value={inject.scenarioOffsetMin} onChange={(n) => onChange((i) => ({ ...i, scenarioOffsetMin: Math.max(0, n ?? 0) }))} />
          </Field>
          <Field label={L.plannedMinutes} htmlFor="node-planned" hint="Blank splits the time evenly.">
            <NumberField id="node-planned" allowEmpty value={inject.plannedDelayMin} onChange={(n) => onChange((i) => ({ ...i, plannedDelayMin: n }))} />
          </Field>
        </div>
        {branched && (
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[color:var(--mist-indigo)]"
              checked={Boolean(inject.position.end)}
              onChange={(e) => {
                const end = e.target.checked;
                onChange((i) => ({ ...i, position: end ? { ...i.position, end: true } : { x: i.position.x, y: i.position.y } }));
              }}
            />
            {L.endNode}. The run ends after this inject.
          </label>
        )}
      </fieldset>
      {mode === "strategic" ? (
        <StrategicPanel graph={graph} inject={inject} readOnly={readOnly} capabilities={capabilities} onChange={onChange} />
      ) : (
        <DocumentPanel
          templateId={templateId}
          graph={graph}
          inject={inject}
          readOnly={readOnly}
          capabilities={capabilities}
          sections={sections}
          rubricKeys={rubricKeys}
          onChange={onChange}
        />
      )}
    </div>
  );
}
