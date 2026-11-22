"use client";

// Outgoing branches of one node: target, condition and priority order.
// Condition fields cover every type in src/modes/shared/branching.ts and are
// built with buildCondition, so the saved value always parses there.

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/form/field-select";
import { Field } from "@/components/templates/editor/fields";
import { STRATEGIC_LABELS as L } from "@/lib/exercise/build-guide/labels";
import type { BranchCondition } from "@/lib/exercise/modes/shared/branching";
import {
  CONDITION_HINTS,
  CONDITION_LABELS,
  CONDITION_TYPES,
  ENTRY_TYPE_OPTIONS,
  MODE_CONDITIONS,
  PATH_OPTIONS,
  buildCondition,
  conditionType,
  describeCondition,
  fieldsOf,
  outcomeOptions,
  type ConditionFields,
  type ConditionType,
} from "@/lib/exercise/studio/conditions";
import { addBranch, branchesFrom, moveBranch, removeBranch, updateBranch, type DraftGraph } from "@/lib/exercise/studio/editor";
import type { StudioMode } from "@/lib/exercise/studio/schema";
import { PanelSection } from "./bits";

type Update = (fn: (g: DraftGraph) => DraftGraph) => void;

export function ConditionEditor({
  mode,
  teams,
  condition,
  onChange,
  disabled,
  idPrefix,
}: {
  mode: StudioMode;
  teams: string[];
  condition: unknown;
  onChange: (c: BranchCondition) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [type, setType] = useState<ConditionType>(conditionType(condition) ?? "default");
  const [fields, setFields] = useState<ConditionFields>(() => fieldsOf(condition, mode, teams));
  const [error, setError] = useState<string | null>(null);

  function apply(nextType: ConditionType, nextFields: ConditionFields) {
    setType(nextType);
    setFields(nextFields);
    const r = buildCondition(nextType, nextFields);
    if (r.ok) {
      setError(null);
      onChange(r.condition);
    } else {
      setError(r.error);
    }
  }
  const set = (patch: Partial<ConditionFields>) => apply(type, { ...fields, ...patch });
  const supported = MODE_CONDITIONS[mode];
  const typeOptions = CONDITION_TYPES.filter((t) => supported.includes(t) || t === type).map((t) => ({ value: t, label: CONDITION_LABELS[t] }));
  const teamOptions = [...(teams.includes(fields.team) || !fields.team ? [] : [{ value: fields.team, label: `${fields.team} (not a team)` }]), ...teams.map((t) => ({ value: t, label: t }))];

  return (
    <div className="flex flex-col gap-2">
      <Field label={L.condition} htmlFor={`${idPrefix}-type`} hint={CONDITION_HINTS[type]}>
        <FieldSelect id={`${idPrefix}-type`} className="h-9" disabled={disabled} value={type} options={typeOptions} onChange={(v) => apply(v as ConditionType, fields)} />
      </Field>
      {(type === "team_outcome" || type === "majority") && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Team" htmlFor={`${idPrefix}-team`}>
            <FieldSelect
              id={`${idPrefix}-team`}
              className="h-9"
              disabled={disabled || teamOptions.length === 0}
              value={fields.team}
              options={teamOptions.length ? teamOptions : [{ value: "", label: "No teams" }]}
              onChange={(team) => set({ team })}
            />
          </Field>
          {type === "team_outcome" ? (
            <Field label="Outcome" htmlFor={`${idPrefix}-outcome`}>
              <FieldSelect id={`${idPrefix}-outcome`} className="h-9" disabled={disabled} value={fields.outcome} options={outcomeOptions(mode)} onChange={(outcome) => set({ outcome })} />
            </Field>
          ) : (
            <Field label="Option" htmlFor={`${idPrefix}-option`}>
              <Input id={`${idPrefix}-option`} className="h-9" maxLength={4} disabled={disabled} value={fields.optionId} onChange={(e) => set({ optionId: e.target.value })} />
            </Field>
          )}
        </div>
      )}
      {(type === "score_below" || type === "score_at_least") && (
        <Field label="Score" htmlFor={`${idPrefix}-score`} hint="From 0 to 4.">
          <Input id={`${idPrefix}-score`} className="h-9 w-28" inputMode="decimal" disabled={disabled} value={fields.value} onChange={(e) => set({ value: e.target.value })} />
        </Field>
      )}
      {type === "entries_at_least" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Entry type" htmlFor={`${idPrefix}-entry`}>
            <FieldSelect id={`${idPrefix}-entry`} className="h-9" disabled={disabled} value={fields.entryType} options={ENTRY_TYPE_OPTIONS} onChange={(entryType) => set({ entryType })} />
          </Field>
          <Field label="At least" htmlFor={`${idPrefix}-count`}>
            <Input id={`${idPrefix}-count`} className="h-9" inputMode="numeric" disabled={disabled} value={fields.count} onChange={(e) => set({ count: e.target.value })} />
          </Field>
        </div>
      )}
      {type === "path" && (
        <Field label="Path" htmlFor={`${idPrefix}-path`}>
          <FieldSelect id={`${idPrefix}-path`} className="h-9" disabled={disabled} value={fields.path} options={PATH_OPTIONS} onChange={(path) => set({ path })} />
        </Field>
      )}
      {error && <p className="text-[12px] text-[color:var(--mist-danger)]">{error}</p>}
    </div>
  );
}

export function BranchesPanel({
  mode,
  graph,
  nodeId,
  selectedBranch,
  readOnly,
  update,
  onSelectNode,
}: {
  mode: StudioMode;
  graph: DraftGraph;
  nodeId: string | null;
  selectedBranch: number | null;
  readOnly: boolean;
  update: Update;
  onSelectNode: (id: string) => void;
}) {
  const [target, setTarget] = useState("");
  const node = nodeId ? graph.injects.find((i) => i.nodeId === nodeId) : null;
  if (graph.template.branching !== "branched") {
    return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Branches are used when the template is branched. Switch to branched in the toolbar.</p>;
  }
  if (!node) return <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Select an inject or a branch on the canvas.</p>;

  const titleOf = (id: string) => {
    const n = graph.injects.find((i) => i.nodeId === id);
    return n ? `${n.seq}. ${n.title || "Untitled inject"}` : id;
  };
  const others = [...graph.injects].sort((a, b) => a.seq - b.seq).filter((i) => i.nodeId !== node.nodeId);
  const targetOptions = others.map((i) => ({ value: i.nodeId, label: titleOf(i.nodeId) }));
  const out = branchesFrom(graph, node.nodeId);
  const incoming = graph.branches.map((b, index) => ({ ...b, index })).filter((b) => b.toNodeId === node.nodeId);
  const teams = graph.template.config.teams;

  return (
    <div className="flex flex-col gap-4">
      <PanelSection title={`After ${titleOf(node.nodeId)}`}>
        {out.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
            {node.position.end ? "This is an end node. The run ends here." : "No branches yet. Drag from the node's lower handle or add one here."}
          </p>
        )}
        <ol className="flex flex-col gap-3">
          {out.map((b, k) => (
            <li
              key={`${graph.branches.length}:${b.index}`}
              className={cn("flex flex-col gap-2 rounded-lg border p-3", b.index === selectedBranch ? "border-[color:var(--mist-indigo)]" : "border-[color:var(--color-border)]")}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-[color:var(--color-muted-foreground)]">{k + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{describeCondition(b.condition, mode)}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Try earlier" disabled={readOnly || k === 0} onClick={() => update((g) => moveBranch(g, b.index, -1))}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Try later" disabled={readOnly || k === out.length - 1} onClick={() => update((g) => moveBranch(g, b.index, 1))}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Remove branch" disabled={readOnly} onClick={() => update((g) => removeBranch(g, b.index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Field label={L.goTo} htmlFor={`br-${b.index}-to`}>
                <FieldSelect
                  id={`br-${b.index}-to`}
                  className="h-9"
                  disabled={readOnly}
                  value={b.toNodeId}
                  options={targetOptions}
                  onChange={(to) => update((g) => updateBranch(g, b.index, { toNodeId: to }))}
                />
              </Field>
              <ConditionEditor
                idPrefix={`br-${b.index}`}
                mode={mode}
                teams={teams}
                condition={b.condition}
                disabled={readOnly}
                onChange={(condition) => update((g) => updateBranch(g, b.index, { condition }))}
              />
            </li>
          ))}
        </ol>
        {!readOnly && targetOptions.length > 0 && (
          <div className="flex items-end gap-2">
            <Field label="Add a branch to" htmlFor="br-add" className="flex-1">
              <FieldSelect id="br-add" className="h-9" value={target} options={[{ value: "", label: "Pick an inject" }, ...targetOptions]} onChange={setTarget} />
            </Field>
            <Button
              variant="outline"
              disabled={!target}
              onClick={() => {
                update((g) => addBranch(mode, g, node.nodeId, target));
                setTarget("");
              }}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        )}
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Branches are tried from the top. Otherwise runs when none match.</p>
      </PanelSection>
      {incoming.length > 0 && (
        <PanelSection title="Arrives from">
          <ul className="flex flex-col gap-1">
            {incoming.map((b) => (
              <li key={b.index}>
                <button type="button" className="text-left text-[13px] hover:underline" onClick={() => onSelectNode(b.fromNodeId)}>
                  {titleOf(b.fromNodeId)}, {describeCondition(b.condition, mode)}
                </button>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
    </div>
  );
}
