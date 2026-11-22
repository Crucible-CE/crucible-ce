"use client";

// Strategic TTX inject fields: phase, narrative, artifacts, team variants,
// expected actions (hidden), clock updates, capabilities and objective links.

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { ChipGroup, Field, KeyPicker } from "@/components/templates/editor/fields";
import { TechniquePicker } from "@/components/templates/editor/technique-picker";
import { ReferenceCard } from "@/components/templates/editor/scenario-library";
import { PRESSURE_ARTIFACTS, listPlaceholders } from "@/lib/exercise/content/pressure-artifacts";
import { ARTIFACT_KIND_LABELS } from "@/lib/exercise/modes/crisissim/schema";
import { PHASES } from "@/lib/exercise/modes/strategic/schema";
import { CLOCK_UPDATE_LABELS, PHASE_LABELS, STRATEGIC_LABELS as L, VARIANT_STATUS_LABELS } from "@/lib/exercise/build-guide/labels";
import { type DraftArtifact, type DraftGraph, type DraftInject, type DraftVariant, type StrategicContent, type StrategicSecret } from "@/lib/exercise/studio/editor";
import { absoluteTime, formatOffset } from "@/lib/exercise/studio/time";
import { HiddenBadge, LinesField, MarkdownField, PanelSection } from "./bits";

type Options = Array<{ value: string; label: string }>;

const PHASE_OPTIONS = PHASES.map((p) => ({ value: p, label: PHASE_LABELS[p] }));
const KIND_OPTIONS = Object.entries(ARTIFACT_KIND_LABELS).map(([value, label]) => ({ value, label }));
const MAX_ARTIFACTS = 6;
const MAX_QUESTIONS = 5;

export function StrategicPanel({
  graph,
  inject,
  readOnly,
  capabilities,
  onChange,
}: {
  graph: DraftGraph;
  inject: DraftInject;
  readOnly: boolean;
  capabilities: Options;
  onChange: (fn: (i: DraftInject) => DraftInject) => void;
}) {
  const c = inject.content as StrategicContent;
  const s = inject.secret as StrategicSecret;
  const teams = graph.template.config.teams;
  const clocks = graph.template.config.regulatoryClocks;
  const objectives = graph.template.objectives;
  const setContent = (patch: Partial<StrategicContent>) => onChange((i) => ({ ...i, content: { ...(i.content as StrategicContent), ...patch } }));
  const setSecret = (patch: Partial<StrategicSecret>) => onChange((i) => ({ ...i, secret: { ...(i.secret as StrategicSecret), ...patch } }));

  return (
    <div className="flex flex-col gap-5">
      {!readOnly && <CloudSeam feature="strategic-injects" />}

      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        <PanelSection title="Situation">
          <Field label={L.phase} htmlFor="st-phase">
            <FieldSelect id="st-phase" className="h-9" value={c.phase} options={PHASE_OPTIONS} onChange={(v) => setContent({ phase: v as StrategicContent["phase"] })} />
          </Field>
          <Field label={L.narrative} htmlFor="st-narrative" hint="Shared brief for every team. Markdown.">
            <MarkdownField id="st-narrative" value={c.narrativeMd} maxLength={8000} onChange={(narrativeMd) => setContent({ narrativeMd })} />
          </Field>
        </PanelSection>

        <Artifacts
          artifacts={c.artifacts}
          timeLabel={absoluteTime((graph.template.config as { scenarioAnchor?: { weekday: number; time: string } | null }).scenarioAnchor, inject.scenarioOffsetMin) ?? formatOffset(inject.scenarioOffsetMin)}
          onChange={(artifacts) => setContent({ artifacts })}
        />

        <PanelSection title={L.teams}>
          {teams.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Add teams in Template settings.</p>}
          {teams.map((team) => (
            <VariantEditor
              key={team}
              team={team}
              variant={c.teamVariants.find((v) => v.team === team) ?? null}
              expected={s.expectedActions[team] ?? []}
              onVariant={(v) =>
                onChange((i) => {
                  const ic = i.content as StrategicContent;
                  const isec = i.secret as StrategicSecret;
                  const rest = ic.teamVariants.filter((x) => x.team !== team);
                  const order = (list: DraftVariant[]) => [...list].sort((a, b) => teams.indexOf(a.team) - teams.indexOf(b.team));
                  const ea = { ...isec.expectedActions };
                  if (!v || v.status !== "active") delete ea[team];
                  return { ...i, content: { ...ic, teamVariants: order(v ? [...rest, v] : rest) }, secret: { ...isec, expectedActions: ea } };
                })
              }
              onExpected={(list) => setSecret({ expectedActions: { ...s.expectedActions, [team]: list } })}
            />
          ))}
          {c.teamVariants.some((v) => !teams.includes(v.team)) && (
            <p className="text-[12px] text-[color:var(--mist-danger)]">
              Variants for teams not in this template: {c.teamVariants.filter((v) => !teams.includes(v.team)).map((v) => v.team).join(", ")}.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => setContent({ teamVariants: c.teamVariants.filter((v) => teams.includes(v.team)) })}
              >
                Remove them
              </button>
            </p>
          )}
        </PanelSection>

        <PanelSection title="Objectives and capabilities">
          {objectives.length > 0 ? (
            <Field label="Objectives">
              <ChipGroup
                label="Objectives"
                options={objectives.map((o) => ({ value: o.key, label: o.key }))}
                value={inject.objectiveKeys}
                onChange={(objectiveKeys) => onChange((i) => ({ ...i, objectiveKeys }))}
              />
            </Field>
          ) : (
            <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Add objectives in Template settings to link them.</p>
          )}
          <Field label="Capabilities">
            <KeyPicker label="Capabilities" addLabel="Add capability" options={capabilities} value={s.capabilityKeys} max={8} onChange={(capabilityKeys) => setSecret({ capabilityKeys })} />
          </Field>
        </PanelSection>

        {clocks.length > 0 && (
          <PanelSection title={L.clockUpdates} action={<HiddenBadge />}>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Applied when this inject closes, at its scenario time.</p>
            {clocks.map((clock) => {
              const current = s.clockUpdates.find((u) => u.key === clock.key)?.action ?? "";
              return (
                <Field key={clock.key} label={clock.label} htmlFor={`st-clock-${clock.key}`}>
                  <FieldSelect
                    id={`st-clock-${clock.key}`}
                    className="h-9"
                    value={current}
                    options={[
                      { value: "", label: CLOCK_UPDATE_LABELS.none },
                      { value: "trigger", label: CLOCK_UPDATE_LABELS.trigger },
                      { value: "met", label: CLOCK_UPDATE_LABELS.met },
                    ]}
                    onChange={(v) =>
                      setSecret({
                        clockUpdates: [
                          ...s.clockUpdates.filter((u) => u.key !== clock.key),
                          ...(v ? [{ key: clock.key, action: v as "trigger" | "met" }] : []),
                        ],
                      })
                    }
                  />
                </Field>
              );
            })}
          </PanelSection>
        )}

        <PanelSection title="Grading" action={<HiddenBadge />}>
          <Field label={L.gradingNotes} htmlFor="st-notes">
            <Textarea id="st-notes" rows={3} maxLength={2000} value={s.gradingNotes ?? ""} onChange={(e) => setSecret({ gradingNotes: e.target.value })} />
          </Field>
          <Field label={L.mitreTags} htmlFor="st-mitre">
            <TechniquePicker id="st-mitre" label={L.mitreTags} value={s.mitreTags} onChange={(mitreTags) => setSecret({ mitreTags })} />
          </Field>
        </PanelSection>
      </fieldset>
      <ReferenceCard keys={(graph.template.config as { scenario?: { threatActorKey?: string | null; replayKey?: string | null; industryKey?: string | null } }).scenario ?? {}} className="border-t border-[color:var(--color-border)] pt-4" />
    </div>
  );
}

function VariantEditor({
  team,
  variant,
  expected,
  onVariant,
  onExpected,
}: {
  team: string;
  variant: DraftVariant | null;
  expected: string[];
  onVariant: (v: DraftVariant | null) => void;
  onExpected: (list: string[]) => void;
}) {
  const state = variant ? variant.status : "none";
  const slug = team.replace(/[^A-Za-z0-9]+/g, "-");
  const nextKey = (qs: DraftVariant["questions"]) => {
    const used = new Set(qs.map((q) => q.key));
    for (let n = 1; ; n++) if (!used.has(`q${n}`)) return `q${n}`;
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--color-border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">{team}</span>
        <FieldSelect
          aria-label={`${team} status`}
          className="h-8 w-40 text-[13px]"
          value={state}
          options={[
            { value: "none", label: VARIANT_STATUS_LABELS.none },
            { value: "active", label: VARIANT_STATUS_LABELS.active },
            { value: "standby", label: VARIANT_STATUS_LABELS.standby },
          ]}
          onChange={(v) => {
            if (v === "none") onVariant(null);
            else onVariant({ team, narrativeMd: variant?.narrativeMd ?? "", questions: variant?.questions ?? [], status: v as "active" | "standby" });
          }}
        />
      </div>
      {variant && (
        <>
          <Field label={L.teamSees} htmlFor={`var-${slug}-narr`}>
            <Textarea
              id={`var-${slug}-narr`}
              rows={3}
              maxLength={4000}
              value={variant.narrativeMd}
              onChange={(e) => onVariant({ ...variant, narrativeMd: e.target.value })}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium">{L.questions}</span>
            {variant.questions.map((q, n) => (
              <div key={q.key} className="flex items-start gap-2">
                <span className="mt-2 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">{n + 1}</span>
                <Textarea
                  aria-label={`${team} question ${n + 1}`}
                  rows={2}
                  maxLength={800}
                  value={q.text}
                  onChange={(e) => onVariant({ ...variant, questions: variant.questions.map((x) => (x.key === q.key ? { ...x, text: e.target.value } : x)) })}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${team} question ${n + 1}`}
                  onClick={() => onVariant({ ...variant, questions: variant.questions.filter((x) => x.key !== q.key) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {variant.questions.length < MAX_QUESTIONS && (
              <Button
                size="xs"
                variant="outline"
                className="w-fit"
                onClick={() => onVariant({ ...variant, questions: [...variant.questions, { key: nextKey(variant.questions), text: "" }] })}
              >
                <Plus className="h-3 w-3" />
                Add question
              </Button>
            )}
          </div>
          {variant.status === "active" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{L.expectedActions}</span>
                <HiddenBadge />
              </div>
              <LinesField aria-label={`${team} expected actions`} value={expected} max={8} rows={3} placeholder="One per line" onChange={onExpected} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Artifacts({ artifacts, timeLabel, onChange }: { artifacts: DraftArtifact[]; timeLabel: string; onChange: (a: DraftArtifact[]) => void }) {
  const [kit, setKit] = useState("");
  const nextId = () => {
    const used = new Set(artifacts.map((a) => a.id));
    for (let n = 1; ; n++) if (!used.has(`a${n}`)) return `a${n}`;
  };
  const set = (id: string, patch: Partial<DraftArtifact>) => onChange(artifacts.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const full = artifacts.length >= MAX_ARTIFACTS;
  return (
    <PanelSection title={L.artifacts}>
      {artifacts.map((a) => (
        <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-[color:var(--color-border)] p-3">
          <div className="flex items-center gap-2">
            <FieldSelect aria-label="Artifact kind" className="h-8 w-40 text-[13px]" value={a.kind} options={KIND_OPTIONS} onChange={(kind) => set(a.id, { kind })} />
            <Input aria-label="Artifact title" className="h-8" maxLength={200} value={a.title} onChange={(e) => set(a.id, { title: e.target.value })} placeholder="Title" />
            <Button size="icon-sm" variant="ghost" aria-label={`Remove artifact ${a.title || a.id}`} onClick={() => onChange(artifacts.filter((x) => x.id !== a.id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label={L.from} className="h-8" maxLength={200} value={a.from ?? ""} placeholder={L.from} onChange={(e) => set(a.id, { from: e.target.value || undefined })} />
            <Input aria-label={L.sentAt} className="h-8" maxLength={60} value={a.sentAt ?? ""} placeholder={L.sentAt} onChange={(e) => set(a.id, { sentAt: e.target.value || undefined })} />
          </div>
          <Textarea aria-label="Artifact text" rows={5} maxLength={8000} value={a.content} onChange={(e) => set(a.id, { content: e.target.value })} />
          <PlaceholderFill text={a.content} onFill={(content) => set(a.id, { content })} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <FieldSelect
          aria-label="Add from the pressure kit"
          className="h-9 min-w-0 flex-1"
          disabled={full}
          value={kit}
          options={[{ value: "", label: "Add from the pressure kit" }, ...PRESSURE_ARTIFACTS.map((p) => ({ value: p.key, label: p.title }))]}
          onChange={(key) => {
            const p = PRESSURE_ARTIFACTS.find((x) => x.key === key);
            setKit("");
            if (!p) return;
            onChange([...artifacts, { id: nextId(), kind: p.kind, title: p.title, content: p.template, ...(p.from ? { from: p.from } : {}), sentAt: timeLabel }]);
          }}
        />
        <Button size="sm" variant="outline" disabled={full} onClick={() => onChange([...artifacts, { id: nextId(), kind: "email", title: "", content: "", sentAt: timeLabel }])}>
          <Plus className="h-4 w-4" />
          Add blank
        </Button>
      </div>
    </PanelSection>
  );
}

/** Inputs for {{placeholders}} left in an artifact, filled into the text on demand. */
function PlaceholderFill({ text, onFill }: { text: string; onFill: (next: string) => void }) {
  const names = listPlaceholders(text);
  const [values, setValues] = useState<Record<string, string>>({});
  if (names.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-md bg-[color:var(--color-muted)] p-2">
      <p className="text-[12px] text-[color:var(--color-muted-foreground)]">Fill the placeholders.</p>
      <div className="grid grid-cols-2 gap-2">
        {names.map((n) => (
          <Input key={n} aria-label={n} className="h-8" placeholder={n} value={values[n] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))} />
        ))}
      </div>
      <Button
        size="xs"
        variant="outline"
        className="w-fit"
        disabled={!names.some((n) => values[n]?.trim())}
        onClick={() => {
          onFill(text.replace(/\{\{(\w+)\}\}/g, (m, name: string) => (values[name]?.trim() ? values[name].trim() : m)));
          setValues({});
        }}
      >
        Fill
      </Button>
    </div>
  );
}
