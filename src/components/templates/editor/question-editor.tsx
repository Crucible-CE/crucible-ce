"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  OPTION_TRIGGER_CLOCKS,
  PATH_KEYS,
  PATH_LABELS,
  QUALITY_LEVELS,
  QUESTION_TYPES,
  type PathKey,
  type Quality,
  type QuestionPublic,
  type QuestionType,
} from "@/lib/exercise/modes/crisissim/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { Field, KeyPicker } from "./fields";
import { CRISISSIM_LABELS as L, OPTION_CLOCK_LABELS, QUALITY_LABELS, QUESTION_TYPE_LABELS } from "@/lib/exercise/build-guide/labels";
import { OPTION_IDS, type ClockEffect, type EditorInject, type EditorState } from "./state";

type EditInject = (fn: (d: EditorInject) => void) => void;
type Options = Array<{ value: string; label: string }>;

const QUALITY_OPTIONS = QUALITY_LEVELS.map((q) => ({ value: q, label: QUALITY_LABELS[q] }));
const TYPE_OPTIONS = QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }));
const CLOCK_OPTIONS = (Object.keys(OPTION_CLOCK_LABELS) as Array<keyof typeof OPTION_CLOCK_LABELS>).map((k) => ({ value: k, label: OPTION_CLOCK_LABELS[k] }));
/** Options start only the materiality and ransom payment clocks; the rest start from the inject. */
const MEET_ONLY_OPTIONS = CLOCK_OPTIONS.filter((o) => o.value !== "trigger");

const NEUTRAL = { optimal: "neutral", degrading: "neutral", critical: "neutral" } as const;

export function QuestionEditor({
  inject,
  qi,
  clocks,
  capabilities,
  edit,
}: {
  inject: EditorInject;
  qi: number;
  clocks: EditorState["config"]["regulatoryClocks"];
  capabilities: Options;
  edit: EditInject;
}) {
  const q = inject.content.questions[qi];
  const team = q.team;
  const base = `${inject.key}-q-${team}`;
  const quality = inject.secret.quality[team] ?? {};
  const followUps = inject.secret.followUps[team] ?? {};
  const effects = inject.secret.clockEffects[team] ?? {};
  const rationales = inject.secret.rationales[team] ?? {};

  const editQ = (fn: (d: QuestionPublic) => void) => edit((d) => fn(d.content.questions[qi]));

  function setQuality(optId: string, path: PathKey, level: Quality) {
    edit((d) => {
      const byOpt = (d.secret.quality[team] ??= {});
      byOpt[optId] = { ...NEUTRAL, ...byOpt[optId], [path]: level };
    });
  }

  function setFollowUp(optId: string, text: string) {
    edit((d) => {
      const byOpt = (d.secret.followUps[team] ??= {});
      if (text) byOpt[optId] = text;
      else delete byOpt[optId];
      if (Object.keys(byOpt).length === 0) delete d.secret.followUps[team];
    });
  }

  function setRationale(optId: string, text: string) {
    edit((d) => {
      const byOpt = (d.secret.rationales[team] ??= {});
      if (text) byOpt[optId] = text;
      else delete byOpt[optId];
      if (Object.keys(byOpt).length === 0) delete d.secret.rationales[team];
    });
  }

  function setClock(optId: string, key: string, action: string) {
    edit((d) => {
      const byOpt = (d.secret.clockEffects[team] ??= {});
      const next: ClockEffect[] = (byOpt[optId] ?? []).filter((e) => e.key !== key);
      if (action === "trigger" || action === "met") next.push({ key, action });
      if (next.length) byOpt[optId] = next;
      else delete byOpt[optId];
      if (Object.keys(byOpt).length === 0) delete d.secret.clockEffects[team];
    });
  }

  function addOption() {
    edit((d) => {
      const dq = d.content.questions[qi];
      const id = OPTION_IDS.find((x) => !dq.options.some((o) => o.id === x));
      if (!id) return;
      dq.options.push({ id, text: "" });
      (d.secret.quality[team] ??= {})[id] = { ...NEUTRAL };
    });
  }

  function removeOption(oi: number) {
    edit((d) => {
      const dq = d.content.questions[qi];
      const [removed] = dq.options.splice(oi, 1);
      if (!removed) return;
      delete d.secret.quality[team]?.[removed.id];
      delete d.secret.followUps[team]?.[removed.id];
      delete d.secret.clockEffects[team]?.[removed.id];
      delete d.secret.rationales[team]?.[removed.id];
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[color:var(--color-border)] p-4">
      <div className="flex items-center gap-2">
        <Badge variant="accent">{team}</Badge>
      </div>
      <Field label={L.question} htmlFor={`${base}-stem`}>
        <Textarea
          id={`${base}-stem`}
          rows={3}
          maxLength={1500}
          value={q.stem}
          onChange={(e) => {
            const v = e.target.value;
            editQ((d) => void (d.stem = v));
          }}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={L.decisionOwner} htmlFor={`${base}-owner`} hint="Decides for the team. Everyone else recommends.">
          <Input
            id={`${base}-owner`}
            maxLength={120}
            value={q.decisionOwner ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              editQ((d) => void (d.decisionOwner = v));
            }}
          />
        </Field>
        <Field label={L.type} htmlFor={`${base}-type`}>
          <FieldSelect
            id={`${base}-type`}
            className="h-9"
            value={q.type}
            options={TYPE_OPTIONS}
            onChange={(v) => editQ((d) => void (d.type = (TYPE_OPTIONS.some((t) => t.value === v) ? v : "standard") as QuestionType))}
          />
        </Field>
      </div>
      <Field label={L.discussionPrompt} htmlFor={`${base}-prompt`}>
        <Textarea
          id={`${base}-prompt`}
          rows={2}
          maxLength={800}
          value={q.discussionPrompt ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            editQ((d) => void (d.discussionPrompt = v));
          }}
        />
      </Field>
      <Field label="Capabilities">
        <KeyPicker
          label={`Capabilities for ${team}`}
          addLabel="Add capability"
          options={capabilities}
          value={q.capabilityKeys}
          max={8}
          onChange={(next) => editQ((d) => void (d.capabilityKeys = next))}
        />
      </Field>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[13px] font-medium">{L.options}</h4>
          {q.options.length < 4 && (
            <Button size="sm" variant="outline" onClick={addOption}>
              <Plus className="h-4 w-4" />
              Add option
            </Button>
          )}
        </div>
        {q.options.map((o, oi) => {
          const oBase = `${base}-${o.id}`;
          return (
            <div key={o.id} className="flex flex-col gap-3 rounded-md bg-[color:var(--color-muted)]/50 p-3">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center font-mono text-[13px] font-semibold uppercase">{o.id}</span>
                <Input
                  aria-label={`Option ${o.id} text`}
                  maxLength={400}
                  value={o.text}
                  onChange={(e) => {
                    const v = e.target.value;
                    editQ((d) => void (d.options[oi].text = v));
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove option ${o.id}`}
                  disabled={q.options.length <= 3}
                  onClick={() => removeOption(oi)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {PATH_KEYS.map((p) => (
                  <Field key={p} label={PATH_LABELS[p]} htmlFor={`${oBase}-${p}`}>
                    <FieldSelect
                      id={`${oBase}-${p}`}
                      className="h-9"
                      value={quality[o.id]?.[p] ?? "neutral"}
                      options={QUALITY_OPTIONS}
                      onChange={(v) => setQuality(o.id, p, v as Quality)}
                    />
                  </Field>
                ))}
              </div>
              <Field label={L.followUp} htmlFor={`${oBase}-follow`}>
                <Input
                  id={`${oBase}-follow`}
                  maxLength={600}
                  value={followUps[o.id] ?? ""}
                  onChange={(e) => setFollowUp(o.id, e.target.value)}
                />
              </Field>
              <Field label={L.rationale} htmlFor={`${oBase}-why`} hint="Shown in the debrief only.">
                <Input
                  id={`${oBase}-why`}
                  maxLength={400}
                  value={rationales[o.id] ?? ""}
                  onChange={(e) => setRationale(o.id, e.target.value)}
                />
              </Field>
              {clocks.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {clocks.map((c) => (
                    <Field key={c.key} label={c.label} htmlFor={`${oBase}-clock-${c.key}`}>
                      <FieldSelect
                        id={`${oBase}-clock-${c.key}`}
                        className="h-9"
                        value={(effects[o.id] ?? []).find((e) => e.key === c.key)?.action ?? "none"}
                        options={OPTION_TRIGGER_CLOCKS.includes(c.key) ? CLOCK_OPTIONS : MEET_ONLY_OPTIONS}
                        onChange={(v) => setClock(o.id, c.key, v)}
                      />
                    </Field>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
