"use client";

// Template settings: title, summary, teams, scenario start, duration,
// library reference, objectives, regulatory clocks and the executive brief.

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { Field, KeyPicker, NumberField } from "@/components/templates/editor/fields";
import { REGULATORY_CLOCK_PRESETS } from "@/lib/exercise/content/regulatory-clocks";
import { STRATEGIC_LABELS as L, clockDuration } from "@/lib/exercise/build-guide/labels";
import { listScenarioDomains } from "@/lib/exercise/content/domains";
import { WEEKDAYS } from "@/lib/exercise/modes/crisissim/schema";
import { removeTeam, renameTeam, type DraftClock, type DraftGraph } from "@/lib/exercise/studio/editor";
import type { StudioIssue } from "@/lib/exercise/studio/graph";
import type { StudioMode } from "@/lib/exercise/studio/schema";
import { ReferenceCard, ScenarioLibraryPicker } from "@/components/templates/editor/scenario-library";
import { IssueLines, MarkdownField, PanelSection } from "./bits";

type Options = Array<{ value: string; label: string }>;
type Update = (fn: (g: DraftGraph) => DraftGraph) => void;

const MAX_TEAMS = 10;
const MAX_CLOCKS = 10;
const MAX_OBJECTIVES = 20;
const DOMAINS = listScenarioDomains();

export interface DocumentInfo {
  id: string | null;
  title: string | null;
  sha256: string | null;
  missing: boolean;
  changed: boolean;
}

export function SettingsPanel({
  mode,
  templateId,
  graph,
  readOnly,
  issues,
  capabilities,
  document,
  update,
}: {
  mode: StudioMode;
  templateId: string;
  graph: DraftGraph;
  readOnly: boolean;
  issues: StudioIssue[];
  capabilities: Options;
  document: DocumentInfo | null;
  update: Update;
}) {
  const t = graph.template;
  const cfg = t.config as Record<string, unknown> & { teams: string[]; regulatoryClocks: DraftClock[] };
  const setTemplate = (patch: Partial<DraftGraph["template"]>) => update((g) => ({ ...g, template: { ...g.template, ...patch } }));
  const setConfig = (patch: Record<string, unknown>) => update((g) => ({ ...g, template: { ...g.template, config: { ...g.template.config, ...patch } } }));
  const anchor = (cfg.scenarioAnchor as { weekday: number; time: string } | null | undefined) ?? null;
  const scenario = (cfg.scenario ?? {}) as { domain?: string; crisisType?: string; contextMd?: string; threatActorKey?: string | null; replayKey?: string | null; industryKey?: string | null };
  const domain = DOMAINS.find((d) => d.key === scenario.domain) ?? DOMAINS[0];

  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-5">
      <IssueLines issues={issues.filter((i) => i.nodeId === null && i.branch === undefined)} />
      <PanelSection title={L.templateTab}>
        <Field label={L.title} htmlFor="set-title">
          <Input id="set-title" value={t.title} maxLength={160} onChange={(e) => setTemplate({ title: e.target.value })} />
        </Field>
        <Field label={L.summary} htmlFor="set-summary">
          <Textarea id="set-summary" rows={3} maxLength={800} value={t.summary ?? ""} onChange={(e) => setTemplate({ summary: e.target.value || null })} />
        </Field>
      </PanelSection>

      {mode === "document" && (
        <PanelSection title="Source document">
          {document?.title ? (
            <p className="text-[13px]">{document.title}</p>
          ) : (
            <p className="text-[13px] text-[color:var(--color-muted-foreground)]">{document?.missing ? "The source document is not in the library." : "No source document."}</p>
          )}
          {document?.changed && <p className="text-[12px] text-[color:var(--mist-warn)]">The document changed after this template was written.</p>}
          <Link href={`/documents/templates/${templateId}`} className="text-[13px] text-[color:var(--mist-indigo)] hover:underline">
            Edit rubrics in the Playbook Exercise editor
          </Link>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Minutes per module" htmlFor="set-module-min" hint="Blank means no timer.">
              <NumberField id="set-module-min" allowEmpty value={(cfg.moduleMinutes as number | null) ?? null} onChange={(moduleMinutes) => setConfig({ moduleMinutes })} />
            </Field>
            <Field label="Pacing" htmlFor="set-paced">
              <FieldSelect
                id="set-paced"
                className="h-9"
                value={(cfg.paced as string) ?? "facilitator"}
                options={[
                  { value: "facilitator", label: "Facilitator advances" },
                  { value: "timer", label: "Timer" },
                ]}
                onChange={(paced) => setConfig({ paced })}
              />
            </Field>
          </div>
        </PanelSection>
      )}

      {mode === "strategic" && (
        <PanelSection title={L.scenario}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L.startDay} htmlFor="set-day" hint="Scenario day at minute 0.">
              <FieldSelect
                id="set-day"
                className="h-9"
                value={anchor ? String(anchor.weekday) : ""}
                options={[{ value: "", label: "Not set" }, ...WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))]}
                onChange={(v) => setConfig({ scenarioAnchor: v === "" ? null : { weekday: Number(v), time: anchor?.time ?? "09:00" } })}
              />
            </Field>
            <Field label={L.startTime} htmlFor="set-time">
              <Input
                id="set-time"
                type="time"
                className="h-9"
                disabled={!anchor}
                value={anchor?.time ?? ""}
                onChange={(e) => {
                  if (anchor && /^\d\d:\d\d$/.test(e.target.value)) setConfig({ scenarioAnchor: { ...anchor, time: e.target.value } });
                }}
              />
            </Field>
          </div>
          <Field label={L.targetMinutes} htmlFor="set-duration" hint="From 15 to 1440.">
            <NumberField id="set-duration" className="w-32" value={(cfg.targetDurationMin as number) ?? 90} onChange={(n) => setConfig({ targetDurationMin: n ?? 90 })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Domain" htmlFor="set-domain">
              <FieldSelect
                id="set-domain"
                className="h-9"
                value={domain.key}
                options={DOMAINS.map((d) => ({ value: d.key, label: d.label }))}
                onChange={(v) => setConfig({ scenario: { ...scenario, domain: v } })}
              />
            </Field>
            <Field label={L.crisisType} htmlFor="set-crisis">
              <FieldSelect
                id="set-crisis"
                className="h-9"
                value={scenario.crisisType ?? ""}
                options={[{ value: "", label: "Not set" }, ...domain.crisisTypes.map((c) => ({ value: c, label: c }))]}
                onChange={(v) => setConfig({ scenario: { ...scenario, crisisType: v } })}
              />
            </Field>
          </div>
          <Field label={L.executiveBrief} htmlFor="set-brief" hint="Players read it before the first inject. Markdown.">
            <MarkdownField id="set-brief" value={(cfg.executiveBriefMd as string) ?? ""} maxLength={6000} onChange={(executiveBriefMd) => setConfig({ executiveBriefMd })} />
          </Field>
        </PanelSection>
      )}

      {mode === "strategic" && (
        <PanelSection title={L.reference}>
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Used in the build prompt and hidden from players.</p>
          <ScenarioLibraryPicker
            idPrefix="set-ref"
            value={{ threatActorKey: scenario.threatActorKey ?? null, replayKey: scenario.replayKey ?? null, industryKey: scenario.industryKey ?? null }}
            onChange={(patch) => setConfig({ scenario: { ...scenario, ...patch } })}
          />
          <ReferenceCard keys={scenario} />
        </PanelSection>
      )}

      <Teams teams={cfg.teams} mode={mode} update={update} />

      <PanelSection title={L.objectives}>
        {t.objectives.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No objectives yet.</p>}
        {t.objectives.map((o, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-[color:var(--color-border)] p-3">
            <div className="flex items-start gap-2">
              <Input
                aria-label={`Objective ${i + 1} key`}
                className="h-9 w-24 font-mono"
                maxLength={40}
                value={o.key}
                onChange={(e) => {
                  const key = e.target.value.replace(/\s+/g, "_");
                  update((g) => renameObjective(g, i, key));
                }}
              />
              <Textarea
                aria-label={`Objective ${i + 1}`}
                rows={2}
                maxLength={1000}
                value={o.text}
                onChange={(e) => setTemplate({ objectives: t.objectives.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
              />
              <Button size="icon-sm" variant="ghost" aria-label={`Remove objective ${o.key}`} onClick={() => update((g) => removeObjective(g, i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <KeyPicker
              label={`Capabilities for ${o.key}`}
              addLabel="Add capability"
              options={capabilities}
              value={o.capabilityKeys}
              max={12}
              onChange={(capabilityKeys) => setTemplate({ objectives: t.objectives.map((x, j) => (j === i ? { ...x, capabilityKeys } : x)) })}
            />
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={t.objectives.length >= MAX_OBJECTIVES}
          onClick={() => setTemplate({ objectives: [...t.objectives, { key: nextObjectiveKey(t.objectives), text: "", capabilityKeys: [] }] })}
        >
          <Plus className="h-4 w-4" />
          Add objective
        </Button>
      </PanelSection>

      <PanelSection title={L.clocks}>
        <ul className="flex flex-col gap-1">
          {[...REGULATORY_CLOCK_PRESETS, ...cfg.regulatoryClocks.filter((c) => !REGULATORY_CLOCK_PRESETS.some((p) => p.key === c.key))].map((c) => {
            const on = cfg.regulatoryClocks.some((x) => x.key === c.key);
            return (
              <li key={c.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-[color:var(--color-muted)]">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[color:var(--mist-indigo)]"
                    checked={on}
                    disabled={!on && cfg.regulatoryClocks.length >= MAX_CLOCKS}
                    onChange={(e) => update((g) => toggleClock(g, c, e.target.checked))}
                  />
                  <span>
                    <span className="block">{c.label}</span>
                    <span className="block text-[12px] text-[color:var(--color-muted-foreground)]">{clockDuration(c)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Exercise aids, not legal advice.</p>
      </PanelSection>
    </fieldset>
  );
}

function nextObjectiveKey(list: Array<{ key: string }>): string {
  const used = new Set(list.map((o) => o.key));
  for (let n = 1; ; n++) if (!used.has(`o${n}`)) return `o${n}`;
}

function renameObjective(g: DraftGraph, index: number, key: string): DraftGraph {
  const from = g.template.objectives[index]?.key;
  if (from === undefined) return g;
  const swap = (k: string) => (k === from ? key : k);
  return {
    ...g,
    template: { ...g.template, objectives: g.template.objectives.map((o, j) => (j === index ? { ...o, key } : o)) },
    injects: g.injects.map((i) => ({
      ...i,
      objectiveKeys: i.objectiveKeys.map(swap),
      content: "questions" in i.content ? { ...i.content, questions: i.content.questions.map((q) => ({ ...q, objectiveKeys: q.objectiveKeys.map(swap) })) } : i.content,
    })),
  };
}

function removeObjective(g: DraftGraph, index: number): DraftGraph {
  const key = g.template.objectives[index]?.key;
  return {
    ...g,
    template: { ...g.template, objectives: g.template.objectives.filter((_, j) => j !== index) },
    injects: g.injects.map((i) => ({
      ...i,
      objectiveKeys: i.objectiveKeys.filter((k) => k !== key),
      content: "questions" in i.content ? { ...i.content, questions: i.content.questions.map((q) => ({ ...q, objectiveKeys: q.objectiveKeys.filter((k) => k !== key) })) } : i.content,
    })),
  };
}

function toggleClock(g: DraftGraph, c: DraftClock, on: boolean): DraftGraph {
  const clocks = g.template.config.regulatoryClocks;
  const next = on
    ? [...clocks, { key: c.key, label: c.label, ...(c.businessDays ? { businessDays: c.businessDays } : { durationHours: c.durationHours }) }]
    : clocks.filter((x) => x.key !== c.key);
  return {
    ...g,
    template: { ...g.template, config: { ...g.template.config, regulatoryClocks: next } },
    injects: on
      ? g.injects
      : g.injects.map((i) =>
          "clockUpdates" in i.secret ? { ...i, secret: { ...i.secret, clockUpdates: i.secret.clockUpdates.filter((u) => u.key !== c.key) } } : i,
        ),
  };
}

function Teams({ teams, mode, update }: { teams: string[]; mode: StudioMode; update: Update }) {
  const min = mode === "strategic" ? 2 : 0;
  return (
    <PanelSection
      title={L.teams}
      action={
        <Button
          size="sm"
          variant="outline"
          disabled={teams.length >= MAX_TEAMS}
          onClick={() =>
            update((g) => {
              const used = new Set(g.template.config.teams);
              let n = g.template.config.teams.length + 1;
              while (used.has(`Team ${n}`)) n++;
              return { ...g, template: { ...g.template, config: { ...g.template.config, teams: [...g.template.config.teams, `Team ${n}`] } } };
            })
          }
        >
          <Plus className="h-4 w-4" />
          Add team
        </Button>
      }
    >
      {teams.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No teams. Everyone plays together.</p>}
      <ul className="flex flex-col gap-2">
        {teams.map((t, i) => (
          <TeamRow
            key={`${i}:${t}`}
            name={t}
            others={teams.filter((_, j) => j !== i)}
            canRemove={teams.length > min}
            onRename={(to) => update((g) => renameTeam(g, t, to))}
            onRemove={() => update((g) => removeTeam(g, t))}
          />
        ))}
      </ul>
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
        {mode === "strategic" ? "Use two to ten teams. " : ""}Renaming a team updates every inject and branch.
      </p>
    </PanelSection>
  );
}

function TeamRow({ name, others, canRemove, onRename, onRemove }: { name: string; others: string[]; canRemove: boolean; onRename: (to: string) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  function commit() {
    const to = draft.trim();
    if (to === name) return setError(null);
    if (!to) {
      setError("Enter a team name.");
      setDraft(name);
      return;
    }
    if (others.some((o) => o.toLowerCase() === to.toLowerCase())) {
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
          className="h-9"
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
