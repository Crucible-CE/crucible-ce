"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { REGULATORY_CLOCK_PRESETS } from "@/lib/exercise/content/regulatory-clocks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FieldSelect } from "@/components/form/field-select";
import { WEEKDAYS } from "@/lib/exercise/modes/crisissim/schema";
import { CRISISSIM_LABELS as L, clockDuration } from "@/lib/exercise/build-guide/labels";
import { Field, KeyPicker, NumberField, SectionTitle } from "./fields";
import { ReferenceCard, ScenarioLibraryPicker } from "./scenario-library";
import {
  addTeam,
  nextObjectiveKey,
  nextTeamName,
  produce,
  pruneClockEffects,
  removeTeam,
  renameTeam,
  type EditorState,
} from "./state";

type Update = (fn: (s: EditorState) => EditorState) => void;
type Options = Array<{ value: string; label: string }>;

const MAX_TEAMS = 10;
const MAX_CLOCKS = 10;
const MAX_OBJECTIVES = 12;

export function ScenarioSettings({ state, update, capabilities }: { state: EditorState; update: Update; capabilities: Options }) {
  const setConfig = (patch: Partial<EditorState["config"]>) => update((s) => ({ ...s, config: { ...s.config, ...patch } }));
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle>{L.scenario}</SectionTitle>
        <Field label={L.title} htmlFor="tpl-title">
          <Input
            id="tpl-title"
            value={state.title}
            maxLength={160}
            onChange={(e) => {
              const title = e.target.value;
              update((s) => ({ ...s, title }));
            }}
          />
        </Field>
        <Field label={L.summary} htmlFor="tpl-summary">
          <Textarea
            id="tpl-summary"
            value={state.summary}
            maxLength={800}
            rows={3}
            onChange={(e) => {
              const summary = e.target.value;
              update((s) => ({ ...s, summary }));
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={L.thresholdOptimal} htmlFor="tpl-th-opt">
            <NumberField
              id="tpl-th-opt"
              value={state.config.pathThresholds.optimal}
              onChange={(n) => setConfig({ pathThresholds: { ...state.config.pathThresholds, optimal: n ?? 0 } })}
            />
          </Field>
          <Field label={L.thresholdCritical} htmlFor="tpl-th-deg">
            <NumberField
              id="tpl-th-deg"
              value={state.config.pathThresholds.degrading}
              onChange={(n) => setConfig({ pathThresholds: { ...state.config.pathThresholds, degrading: n ?? 0 } })}
            />
          </Field>
          <Field label={L.targetMinutes} htmlFor="tpl-duration">
            <NumberField
              id="tpl-duration"
              value={state.config.targetDurationMin}
              onChange={(n) => setConfig({ targetDurationMin: n ?? 60 })}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={L.startDay} htmlFor="tpl-anchor-day" hint="Scenario day of the first inject.">
            <FieldSelect
              id="tpl-anchor-day"
              className="h-9"
              value={state.config.scenarioAnchor ? String(state.config.scenarioAnchor.weekday) : ""}
              options={[{ value: "", label: "Not set" }, ...WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))]}
              onChange={(v) =>
                setConfig({
                  scenarioAnchor: v === "" ? undefined : { weekday: Number(v), time: state.config.scenarioAnchor?.time ?? "09:00" },
                })
              }
            />
          </Field>
          <Field label={L.startTime} htmlFor="tpl-anchor-time">
            <Input
              id="tpl-anchor-time"
              type="time"
              className="h-9"
              disabled={!state.config.scenarioAnchor}
              value={state.config.scenarioAnchor?.time ?? ""}
              onChange={(e) => {
                const time = e.target.value;
                if (state.config.scenarioAnchor && /^\d\d:\d\d$/.test(time)) setConfig({ scenarioAnchor: { ...state.config.scenarioAnchor, time } });
              }}
            />
          </Field>
        </div>
        <Field label={L.executiveBrief} htmlFor="tpl-brief">
          <Textarea
            id="tpl-brief"
            value={state.config.executiveBriefMd ?? ""}
            maxLength={6000}
            rows={6}
            onChange={(e) => setConfig({ executiveBriefMd: e.target.value })}
          />
        </Field>
      </Card>

      <Card>
        <SectionTitle>{L.reference}</SectionTitle>
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Used in the build prompt and hidden from players.</p>
        <ScenarioLibraryPicker
          idPrefix="tpl-ref"
          value={{
            threatActorKey: state.config.threatActorKey ?? null,
            replayKey: state.config.replayKey ?? null,
            industryKey: state.config.industryKey ?? null,
          }}
          onChange={(patch) => {
            const next: Partial<EditorState["config"]> = {};
            for (const [k, v] of Object.entries(patch) as Array<[keyof typeof patch, string | null]>) next[k] = v ?? undefined;
            setConfig(next);
          }}
        />
        <ReferenceCard keys={state.config} />
      </Card>

      <Teams state={state} update={update} />
      <Clocks state={state} update={update} />
      <Objectives state={state} update={update} capabilities={capabilities} />
    </div>
  );
}

function Teams({ state, update }: { state: EditorState; update: Update }) {
  const teams = state.config.teams;
  return (
    <Card>
      <SectionTitle
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={teams.length >= MAX_TEAMS}
            onClick={() => update((s) => addTeam(s, nextTeamName(s.config.teams)))}
          >
            <Plus className="h-4 w-4" />
            Add team
          </Button>
        }
      >
        {L.teams}
      </SectionTitle>
      <ul className="flex flex-col gap-2">
        {teams.map((t, i) => (
          <TeamRow
            key={`${i}:${t}`}
            name={t}
            others={teams.filter((_, j) => j !== i)}
            canRemove={teams.length > 1}
            onRename={(to) => update((s) => renameTeam(s, t, to))}
            onRemove={() => update((s) => removeTeam(s, t))}
          />
        ))}
      </ul>
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Renaming a team updates every inject.</p>
    </Card>
  );
}

function TeamRow({
  name,
  others,
  canRemove,
  onRename,
  onRemove,
}: {
  name: string;
  others: string[];
  canRemove: boolean;
  onRename: (to: string) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const to = draft.trim();
    if (to === name) {
      setDraft(name);
      setError(null);
      return;
    }
    if (!to) {
      setError("Enter a team name.");
      setDraft(name);
      return;
    }
    if (others.includes(to)) {
      setError("Another team has this name.");
      setDraft(name);
      return;
    }
    setError(null);
    onRename(to);
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Team name ${name}`}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${name}`} disabled={!canRemove} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-[12px] text-[color:var(--mist-danger)]">{error}</p>}
    </li>
  );
}

function Clocks({ state, update }: { state: EditorState; update: Update }) {
  const selected = state.config.regulatoryClocks;
  const selectedKeys = new Set(selected.map((c) => c.key));
  const custom = selected.filter((c) => !REGULATORY_CLOCK_PRESETS.some((p) => p.key === c.key));
  const full = selected.length >= MAX_CLOCKS;

  function toggle(c: { key: string; label: string; durationHours?: number; businessDays?: number }, on: boolean) {
    update((s) =>
      produce(s, (d) => {
        if (on) {
          d.config.regulatoryClocks.push({
            key: c.key,
            label: c.label,
            ...(c.businessDays ? { businessDays: c.businessDays } : { durationHours: c.durationHours }),
          });
        } else {
          d.config.regulatoryClocks = d.config.regulatoryClocks.filter((x) => x.key !== c.key);
          pruneClockEffects(d);
        }
      }),
    );
  }

  const rows = [...REGULATORY_CLOCK_PRESETS, ...custom];
  return (
    <Card>
      <SectionTitle>{L.clocks}</SectionTitle>
      <ul className="grid gap-1 sm:grid-cols-2">
        {rows.map((c) => {
          const on = selectedKeys.has(c.key);
          return (
            <li key={c.key}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-[color:var(--color-muted)]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[color:var(--mist-indigo)]"
                  checked={on}
                  disabled={!on && full}
                  onChange={(e) => toggle(c, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="block">{c.label}</span>
                  <span className="block text-[12px] text-[color:var(--color-muted-foreground)]">{clockDuration(c)}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Exercise aids, not legal advice.</p>
    </Card>
  );
}

function Objectives({ state, update, capabilities }: { state: EditorState; update: Update; capabilities: Options }) {
  return (
    <Card>
      <SectionTitle
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={state.objectives.length >= MAX_OBJECTIVES}
            onClick={() =>
              update((s) =>
                produce(s, (d) => {
                  d.objectives.push({ key: nextObjectiveKey(d.objectives), text: "", capabilityKeys: [] });
                }),
              )
            }
          >
            <Plus className="h-4 w-4" />
            Add objective
          </Button>
        }
      >
        {L.objectives}
      </SectionTitle>
      {state.objectives.length === 0 && (
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No objectives yet.</p>
      )}
      <ul className="flex flex-col gap-4">
        {state.objectives.map((o, i) => (
          <li key={o.key} className="flex flex-col gap-2 rounded-lg border border-[color:var(--color-border)] p-3">
            <div className="flex items-start gap-2">
              <Badge variant="outline" className="mt-2 font-mono">
                {o.key}
              </Badge>
              <Textarea
                aria-label={`Objective ${o.key}`}
                value={o.text}
                maxLength={500}
                rows={2}
                onChange={(e) => {
                  const text = e.target.value;
                  update((s) => produce(s, (d) => void (d.objectives[i].text = text)));
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove objective ${o.key}`}
                onClick={() =>
                  update((s) =>
                    produce(s, (d) => {
                      d.objectives.splice(i, 1);
                      for (const inj of d.injects) inj.objectiveKeys = inj.objectiveKeys.filter((k) => k !== o.key);
                    }),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <KeyPicker
              label={`Capabilities for ${o.key}`}
              addLabel="Add capability"
              options={capabilities}
              value={o.capabilityKeys}
              max={8}
              onChange={(next) => update((s) => produce(s, (d) => void (d.objectives[i].capabilityKeys = next)))}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
