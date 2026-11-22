"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { DELIVERABLE_KINDS, DELIVERABLE_LABELS, OPTION_TRIGGER_CLOCKS, anchoredTime, type DeliverableKind } from "@/lib/exercise/modes/crisissim/schema";
import { injectTeams } from "@/lib/exercise/modes/crisissim/validate";
import { CRISISSIM_LABELS as L } from "@/lib/exercise/build-guide/labels";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FieldSelect } from "@/components/form/field-select";
import { ChipGroup, Field, NumberField, SectionTitle } from "./fields";
import { PathTabs } from "./variant-editor";
import { QuestionEditor } from "./question-editor";
import { TechniquePicker } from "./technique-picker";
import { formatOffset, syncQuestions, type EditorInject, type EditorState } from "./state";

type EditInject = (fn: (d: EditorInject) => void) => void;
type Options = Array<{ value: string; label: string }>;

const KIND_OPTIONS = DELIVERABLE_KINDS.map((k) => ({ value: k, label: DELIVERABLE_LABELS[k] }));
const MAX_CRITERIA = 8;

export function InjectEditor({
  templateId,
  state,
  index,
  capabilities,
  edit,
  onMove,
  onDelete,
}: {
  templateId: string;
  state: EditorState;
  index: number;
  capabilities: Options;
  edit: EditInject;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const confirm = useConfirm();
  const inject = state.injects[index];
  const teams = state.config.teams;
  const base = inject.key;
  const asked = injectTeams(inject, teams);
  const injectClocks = state.config.regulatoryClocks.filter((c) => !OPTION_TRIGGER_CLOCKS.includes(c.key));

  async function remove() {
    const ok = await confirm({ title: "Delete this inject?", confirmLabel: "Delete", destructive: true });
    if (ok) onDelete();
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <SectionTitle
          action={
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Move down"
                disabled={index === state.injects.length - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete inject" onClick={() => void remove()}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          }
        >
          {L.inject} {index + 1}
        </SectionTitle>
        <Field label={L.title} htmlFor={`${base}-title`}>
          <Input
            id={`${base}-title`}
            maxLength={160}
            value={inject.title}
            onChange={(e) => {
              const v = e.target.value;
              edit((d) => void (d.title = v));
            }}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={L.scenarioMinutes}
            htmlFor={`${base}-offset`}
            hint={
              state.config.scenarioAnchor
                ? `${formatOffset(inject.scenarioOffsetMin)}, ${anchoredTime(state.config.scenarioAnchor, inject.scenarioOffsetMin).label}`
                : formatOffset(inject.scenarioOffsetMin)
            }
          >
            <NumberField
              id={`${base}-offset`}
              value={inject.scenarioOffsetMin}
              onChange={(n) => edit((d) => void (d.scenarioOffsetMin = n ?? 0))}
            />
          </Field>
          <Field label={L.plannedMinutes} htmlFor={`${base}-planned`} hint="Leave empty for an even split.">
            <NumberField
              id={`${base}-planned`}
              allowEmpty
              placeholder="Even split"
              value={inject.plannedDelayMin}
              onChange={(n) => edit((d) => void (d.plannedDelayMin = n))}
            />
          </Field>
        </div>
        <Field label={L.targetTeams} hint="None selected means all teams.">
          <ChipGroup
            label={L.targetTeams}
            options={teams.map((t) => ({ value: t, label: t }))}
            value={inject.targetTeams}
            onChange={(next) =>
              edit((d) => {
                d.targetTeams = teams.filter((t) => next.includes(t));
                syncQuestions(d, teams);
              })
            }
          />
        </Field>
        {injectClocks.length > 0 && (
          <Field label={L.injectClocks} hint="Options can only meet these clocks.">
            <ChipGroup
              label={L.injectClocks}
              options={injectClocks.map((c) => ({ value: c.key, label: c.label || c.key }))}
              value={inject.secret.clockTriggers}
              onChange={(next) => edit((d) => void (d.secret.clockTriggers = injectClocks.map((c) => c.key).filter((k) => next.includes(k))))}
            />
          </Field>
        )}
        {state.objectives.length > 0 && (
          <Field label={L.objectives}>
            <ChipGroup
              label={L.objectives}
              options={state.objectives.map((o) => ({ value: o.key, label: o.text ? `${o.key} ${truncate(o.text, 40)}` : o.key }))}
              value={inject.objectiveKeys}
              onChange={(next) => edit((d) => void (d.objectiveKeys = state.objectives.map((o) => o.key).filter((k) => next.includes(k))))}
            />
          </Field>
        )}
        <Field label={L.attackTags} htmlFor={`${inject.key}-attack`} hint="Hidden from players.">
          <TechniquePicker
            id={`${inject.key}-attack`}
            label={L.attackTags}
            value={inject.secret.attackTechniques}
            onChange={(next) => edit((d) => void (d.secret.attackTechniques = next))}
          />
        </Field>
      </Card>

      <Card>
        <SectionTitle>{L.narrative}</SectionTitle>
        <PathTabs inject={inject} edit={edit} />
      </Card>

      <Card>
        <SectionTitle>{L.questions}</SectionTitle>
        {inject.content.questions.length === 0 && (
          <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No questions. Select a target team.</p>
        )}
        {inject.content.questions.map((q, qi) => (
          <QuestionEditor
            key={q.team}
            inject={inject}
            qi={qi}
            clocks={state.config.regulatoryClocks}
            capabilities={capabilities}
            edit={edit}
          />
        ))}
        {(asked.length !== inject.content.questions.length || inject.content.questions.some((q) => !asked.includes(q.team))) && (
          <Button variant="outline" size="sm" className="w-fit" onClick={() => edit((d) => syncQuestions(d, teams))}>
            Match questions to target teams
          </Button>
        )}
      </Card>

      <ExpectedActionsEditor inject={inject} teams={asked} edit={edit} />

      <DeliverableEditor inject={inject} teams={teams} edit={edit} />
    </div>
  );
}

/** One action per line per team. Empty lines are dropped on save. */
function ExpectedActionsEditor({ inject, teams, edit }: { inject: EditorInject; teams: string[]; edit: EditInject }) {
  const base = `${inject.key}-ea`;
  return (
    <Card>
      <SectionTitle>{L.expectedActions}</SectionTitle>
      <p className="text-[13px] text-[color:var(--color-muted-foreground)]">Two to four things an evaluator can see each team do. One per line.</p>
      {teams.map((team) => {
        const entry = inject.expectedActions.find((e) => e.team === team);
        return (
          <Field key={team} label={team} htmlFor={`${base}-${team}`}>
            <Textarea
              id={`${base}-${team}`}
              rows={3}
              maxLength={1500}
              value={(entry?.actions ?? []).join("\n")}
              onChange={(e) => {
                const actions = e.target.value.split("\n").slice(0, 6);
                edit((d) => {
                  const row = d.expectedActions.find((x) => x.team === team);
                  if (row) row.actions = actions;
                  else d.expectedActions.push({ team, actions });
                });
              }}
            />
          </Field>
        );
      })}
    </Card>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}

function DeliverableEditor({ inject, teams, edit }: { inject: EditorInject; teams: string[]; edit: EditInject }) {
  const d = inject.content.deliverable;
  const criteria = inject.secret.deliverableCriteria;
  const base = `${inject.key}-deliv`;
  const teamOptions = teams.map((t) => ({ value: t, label: t }));
  if (d && !teams.includes(d.team)) teamOptions.push({ value: d.team, label: d.team || "No team" });

  return (
    <Card>
      <SectionTitle
        action={
          <label className="flex items-center gap-2 text-[13px]">
            <Switch
              checked={Boolean(d)}
              aria-label={L.writtenTask}
              onCheckedChange={(on) =>
                edit((x) => {
                  if (on) {
                    const first = injectTeams(x, teams)[0] ?? teams[0] ?? "";
                    x.content.deliverable = { team: first, kind: "holding_statement", prompt: "" };
                  } else {
                    delete x.content.deliverable;
                  }
                })
              }
            />
            {d ? "On" : "Off"}
          </label>
        }
      >
        {L.writtenTask}
      </SectionTitle>
      {d && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={L.team} htmlFor={`${base}-team`}>
              <FieldSelect
                id={`${base}-team`}
                className="h-9"
                value={d.team}
                options={teamOptions}
                onChange={(v) => edit((x) => void (x.content.deliverable && (x.content.deliverable.team = v)))}
              />
            </Field>
            <Field label={L.kind} htmlFor={`${base}-kind`}>
              <FieldSelect
                id={`${base}-kind`}
                className="h-9"
                value={d.kind}
                options={KIND_OPTIONS}
                onChange={(v) => edit((x) => void (x.content.deliverable && (x.content.deliverable.kind = v as DeliverableKind)))}
              />
            </Field>
          </div>
          <Field label={L.prompt} htmlFor={`${base}-prompt`}>
            <Textarea
              id={`${base}-prompt`}
              rows={3}
              maxLength={1500}
              value={d.prompt}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => void (x.content.deliverable && (x.content.deliverable.prompt = v)));
              }}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-[13px] font-medium">{L.gradingCriteria}</h4>
              <Button
                size="sm"
                variant="outline"
                disabled={criteria.length >= MAX_CRITERIA}
                onClick={() => edit((x) => void x.secret.deliverableCriteria.push(""))}
              >
                <Plus className="h-4 w-4" />
                Add criterion
              </Button>
            </div>
            {criteria.length === 0 && <p className="text-[13px] text-[color:var(--color-muted-foreground)]">No criteria yet.</p>}
            {criteria.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Criterion ${i + 1}`}
                  maxLength={300}
                  value={c}
                  onChange={(e) => {
                    const v = e.target.value;
                    edit((x) => void (x.secret.deliverableCriteria[i] = v));
                  }}
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove criterion ${i + 1}`}
                  onClick={() => edit((x) => void x.secret.deliverableCriteria.splice(i, 1))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
