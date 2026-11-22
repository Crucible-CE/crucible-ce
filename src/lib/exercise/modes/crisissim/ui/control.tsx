"use client";

// Control room main area. The exercise shell owns Close, +2, +5, Next and the
// countdown; this view holds the mode detail: score and path, the live
// decision per team, recommendation split, hidden quality, deliverables,
// reveal settings and clocks. Labels are no-fault because it may be projected.

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CloudSeam } from "@/components/cloud/cloud-seam";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FieldSelect } from "@/components/form/field-select";
import { Switch } from "@/components/ui/switch";
import { DELIVERABLE_LABELS, PATH_KEYS, PATH_LABELS, pathFor, type PathKey, type Quality } from "../schema";
import { SafeMarkdown } from "./markdown";
import { decisionText } from "./player";
import { ArtifactCard, PATH_TONE, PathBadge, QUALITY_LABEL, QUALITY_TONE, SectionLabel, teamNameOf } from "./shared";
import { asState, type CsInject, type CsState, type ModeViewProps } from "./types";

function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v > 0 ? `+${v}` : String(v);
}

export function ControlView(props: ModeViewProps) {
  const state = asState(props.state);
  const [busy, setBusy] = useState(false);
  if (!state) return <p className="text-sm text-[color:var(--color-muted-foreground)]">Loading the exercise.</p>;

  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const canDrive = state.viewer.isDriver;

  async function setConfig(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      let r = await props.act("config", { config: patch });
      if (!r.ok) {
        // Fallback when the control route has no config action: PATCH the exercise.
        const res = await fetch(`/api/exercises/${props.exerciseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: patch }),
        }).catch(() => null);
        const data = (await res?.json().catch(() => null)) as { error?: string } | null;
        r = { ok: Boolean(res?.ok), error: data?.error };
      }
      if (!r.ok) toast.error(r.error ?? "The setting was not saved. Try again.");
      else props.refresh();
    } finally {
      setBusy(false);
    }
  }

  const triggers = current?.control?.clockTriggers ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <ScoreCard state={state} />

        <Card className="gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel>{current ? `Update ${current.seq}` : "No update yet"}</SectionLabel>
            {current && <StatusPill inject={current} />}
          </div>
          {current && <p className="text-lg font-semibold leading-snug">{current.title}</p>}
          {triggers.length > 0 && (
            <p className="text-sm text-[color:var(--mist-warn)]">
              Starts {triggers.map((k) => state.clocks.find((c) => c.key === k)?.label ?? k).join(", ")} when it opens.
            </p>
          )}

          {canDrive && (
            <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-[color:var(--color-border)] pt-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={state.config.holdAfterClose} disabled={busy} onCheckedChange={(v) => void setConfig({ holdAfterClose: v })} />
                Hold after close
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={state.config.revealSplit} disabled={busy} onCheckedChange={(v) => void setConfig({ revealSplit: v })} />
                Show teams their vote split
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={state.config.revealBest} disabled={busy} onCheckedChange={(v) => void setConfig({ revealBest: v })} />
                Show the intended option
              </label>
            </div>
          )}
        </Card>

        {current && <VoteProgress inject={current} state={state} />}
        {current && <Decisions inject={current} state={state} />}
        {current && <VotesTable inject={current} state={state} />}
        {current && <QualityTable inject={current} state={state} />}
        {current?.control?.deliverables.length ? <Deliverables exerciseId={props.exerciseId} inject={current} state={state} refresh={props.refresh} /> : null}

        {current && (
          <details className="rounded-xl bg-[color:var(--color-card)] shadow-[var(--elevation-1)]">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium">What players see</summary>
            <div className="space-y-3 border-t border-[color:var(--color-border)] px-5 py-4">
              {current.outcomes.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {current.outcomes.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">{f.team}.</span> {f.text}
                    </li>
                  ))}
                </ul>
              )}
              <SafeMarkdown text={current.narrativeMd} className="text-sm" />
              {current.consequenceText && <SafeMarkdown text={current.consequenceText} className="text-sm text-[color:var(--color-muted-foreground)]" />}
              {current.artifacts.map((a) => (
                <ArtifactCard key={a.id} artifact={a} />
              ))}
            </div>
          </details>
        )}
      </div>

      {/* The shell owns the clocks panel (start, met, reset). */}
      <div className="space-y-4">
        <InjectLog state={state} />
      </div>
    </div>
  );
}

function StatusPill({ inject }: { inject: CsInject }) {
  const label = inject.status === "open" ? "Open" : inject.status === "closed" ? "Closed" : inject.status === "held" ? "Held" : "Preparing";
  return <span className="rounded-full bg-[color:var(--color-muted)] px-2 py-0.5 text-xs font-medium">{label}</span>;
}

/** Score and path with the thresholds bar. Control only. */
function ScoreCard({ state }: { state: CsState }) {
  const score = state.score;
  if (!score) return null;
  const t = score.thresholds;
  const lo = Math.min(t.degrading - 6, score.cumulative - 2);
  const hi = Math.max(t.optimal + 6, score.cumulative + 2);
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  const last = [...state.injects].filter((i) => i.status === "closed").sort((a, b) => b.seq - a.seq)[0];
  const delta = last?.control?.summary?.delta ?? null;
  return (
    <Card className="gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <SectionLabel>Score</SectionLabel>
          <p className="font-display text-4xl font-semibold tabular-nums">{Math.round(score.cumulative * 10) / 10}</p>
        </div>
        <div className="pb-1">
          <PathBadge path={state.path.key} />
        </div>
        {delta !== null && <p className="pb-1.5 text-sm text-[color:var(--color-muted-foreground)]">Last update {signed(delta)}</p>}
      </div>
      <div>
        <div className="relative h-3 overflow-hidden rounded-full">
          <div className="absolute inset-y-0" style={{ left: 0, width: pos(t.degrading), background: PATH_TONE.critical.dot, opacity: 0.25 }} />
          <div
            className="absolute inset-y-0"
            style={{ left: pos(t.degrading), width: `calc(${pos(t.optimal)} - ${pos(t.degrading)})`, background: PATH_TONE.degrading.dot, opacity: 0.25 }}
          />
          <div className="absolute inset-y-0 right-0" style={{ left: pos(t.optimal), background: PATH_TONE.optimal.dot, opacity: 0.25 }} />
          <div
            className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--color-foreground)]"
            style={{ left: pos(score.cumulative) }}
            aria-label={`Score ${score.cumulative}`}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[color:var(--color-muted-foreground)]">
          <span>
            {PATH_LABELS.critical} below {t.degrading}
          </span>
          <span>
            {PATH_LABELS.optimal} at {t.optimal}
          </span>
        </div>
      </div>
      {Object.keys(score.teamScores).length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--color-muted-foreground)]">
          {Object.entries(score.teamScores).map(([team, s]) => (
            <span key={team}>
              {team} <span className="font-semibold tabular-nums text-[color:var(--color-foreground)]">{signed(s.cumulative ?? 0)}</span>
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-[color:var(--color-muted-foreground)]">Each team counts once per update: the average of its recommendations.</p>
    </Card>
  );
}

function VoteProgress({ inject, state }: { inject: CsInject; state: CsState }) {
  const c = inject.control;
  if (!c) return null;
  const voted = new Set(c.votes.filter((v) => !v.abstain).map((v) => v.participantId));
  const byTeam = new Map<string, string[]>();
  for (const id of c.required) {
    const p = state.roster.find((r) => r.id === id);
    const team = p?.teamId ?? "";
    byTeam.set(team, [...(byTeam.get(team) ?? []), id]);
  }
  if (byTeam.size === 0) return null;
  return (
    <Card dense className="gap-3">
      <SectionLabel>Votes</SectionLabel>
      <ul className="space-y-3">
        {[...byTeam.entries()].map(([teamId, ids]) => {
          const n = ids.filter((id) => voted.has(id)).length;
          const waiting = ids.filter((id) => !voted.has(id)).map((id) => state.roster.find((r) => r.id === id)?.displayName ?? "Unknown");
          return (
            <li key={teamId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{teamNameOf(state, teamId)}</span>
                <span className="tabular-nums text-[color:var(--color-muted-foreground)]">
                  {n} of {ids.length}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--color-muted)]">
                <div className="h-full rounded-full bg-[color:var(--mist-navy)]" style={{ width: `${(n / ids.length) * 100}%` }} />
              </div>
              {inject.status === "open" && waiting.length > 0 && (
                <p className="text-xs text-[color:var(--color-muted-foreground)]">Waiting on {waiting.join(", ")}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** The team decision (decision owner, else majority, a tie is none) and the recommendation split. */
function Decisions({ inject, state }: { inject: CsInject; state: CsState }) {
  const c = inject.control;
  const questions = inject.questions ?? [];
  if (!c || questions.length === 0) return null;
  return (
    <Card dense className="gap-3">
      <SectionLabel>{inject.status === "open" ? "Decisions so far" : "Decisions"}</SectionLabel>
      <ul className="space-y-3">
        {questions.map((q) => {
          const counts: Record<string, number> = {};
          for (const v of c.votes) if (v.teamId === q.teamId && v.optionId && !v.abstain) counts[v.optionId] = (counts[v.optionId] ?? 0) + 1;
          const owner = state.roster.find((r) => r.teamId === q.teamId && r.isDecisionMaker);
          return (
            <li key={q.team} className="space-y-1 text-sm">
              <p>
                <span className="font-semibold">{q.team}.</span> {decisionText(c.decisions?.[q.team], q.options)}
              </p>
              <p className="text-xs text-[color:var(--color-muted-foreground)]">
                Recommendations {q.options.map((o) => `${o.id.toUpperCase()} ${counts[o.id] ?? 0}`).join(", ")}.
                {owner ? "" : " No decision maker is set. The majority decides."}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function optionText(inject: CsInject, teamId: string | null, optionId: string | null): string {
  if (!optionId) return "No vote";
  const q = inject.questions?.find((x) => x.teamId === teamId);
  const o = q?.options.find((x) => x.id === optionId);
  return o ? `${optionId.toUpperCase()}. ${o.text}` : optionId.toUpperCase();
}

function VotesTable({ inject, state }: { inject: CsInject; state: CsState }) {
  const [showNames, setShowNames] = useState(false);
  const votes = inject.control?.votes ?? [];
  if (!votes.length) return null;
  return (
    <Card dense className="gap-3 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Choices</SectionLabel>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={showNames} onCheckedChange={setShowNames} aria-label="Show names" />
          Show names
        </label>
      </div>
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="text-xs text-[color:var(--color-muted-foreground)]">
          <tr>
            {showNames && <th className="py-1.5 pr-3 font-medium">Person</th>}
            <th className="py-1.5 pr-3 font-medium">Team</th>
            <th className="py-1.5 pr-3 font-medium">Choice</th>
            <th className="py-1.5 pr-3 font-medium">Comment</th>
            {inject.status === "closed" && <th className="py-1.5 font-medium">Quality</th>}
          </tr>
        </thead>
        <tbody>
          {votes.map((v) => (
            <tr key={v.participantId} className="border-t border-[color:var(--color-border)] align-top">
              {showNames && <td className="py-1.5 pr-3">{state.roster.find((r) => r.id === v.participantId)?.displayName ?? "Unknown"}</td>}
              <td className="py-1.5 pr-3">
                {teamNameOf(state, v.teamId)}
                {v.decider && <span className="ml-1 text-xs text-[color:var(--color-muted-foreground)]">(decides)</span>}
              </td>
              <td className="py-1.5 pr-3">
                {v.abstain ? <span className="text-[color:var(--color-muted-foreground)]">No vote</span> : optionText(inject, v.teamId, v.optionId)}
              </td>
              <td className="py-1.5 pr-3 text-[color:var(--color-muted-foreground)]">{v.comment ?? ""}</td>
              {inject.status === "closed" && (
                <td className={cn("py-1.5", v.quality ? QUALITY_TONE[v.quality] : "")}>{v.quality ? QUALITY_LABEL[v.quality] : ""}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function QualityTable({ inject, state }: { inject: CsInject; state: CsState }) {
  const c = inject.control;
  if (!c || !inject.questions?.length) return null;
  const path = inject.playedOnPath ?? state.path.key;
  return (
    <Card dense className="gap-4">
      <SectionLabel>Option quality</SectionLabel>
      {inject.questions.map((q) => {
        const best = inject.reveal?.best?.[q.team] ?? null;
        const dist = inject.reveal?.distribution?.[q.team] ?? {};
        return (
          <div key={q.team} className="space-y-2 overflow-x-auto">
            <p className="text-sm">
              <span className="font-semibold">{q.team}.</span> {q.stem}
              {q.decisionOwner && <span className="text-[color:var(--color-muted-foreground)]"> {q.decisionOwner} decides.</span>}
            </p>
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="text-xs text-[color:var(--color-muted-foreground)]">
                <tr>
                  <th className="py-1 pr-3 font-medium">Option</th>
                  {PATH_KEYS.map((p) => (
                    <th key={p} className={cn("py-1 pr-3 font-medium", p === path && "text-[color:var(--color-foreground)]")}>
                      {PATH_LABELS[p]}
                    </th>
                  ))}
                  {inject.status === "closed" && <th className="py-1 font-medium">Votes</th>}
                </tr>
              </thead>
              <tbody>
                {q.options.map((o) => (
                  <tr key={o.id} className="border-t border-[color:var(--color-border)] align-top">
                    <td className="py-1 pr-3">
                      <span className="font-semibold uppercase">{o.id}</span> {o.text}
                      {best === o.id && <span className="ml-2 text-xs font-semibold text-[color:var(--mist-ok)]">Intended</span>}
                      {(c.clockEffects[q.team]?.[o.id] ?? []).map((e) => (
                        <span key={`${e.key}-${e.action}`} className="ml-2 text-xs text-[color:var(--mist-warn)]">
                          {e.action === "trigger" ? "Starts" : "Meets"} {state.clocks.find((x) => x.key === e.key)?.label ?? e.key}
                        </span>
                      ))}
                      {c.rationales?.[q.team]?.[o.id] && (
                        <span className="block text-xs text-[color:var(--color-muted-foreground)]">{c.rationales[q.team][o.id]}</span>
                      )}
                    </td>
                    {PATH_KEYS.map((p) => {
                      const level = c.quality[q.team]?.[o.id]?.[p] as Quality | undefined;
                      return (
                        <td key={p} className={cn("py-1 pr-3", level && QUALITY_TONE[level], p === path ? "font-semibold" : "opacity-70")}>
                          {level ? QUALITY_LABEL[level] : ""}
                        </td>
                      );
                    })}
                    {inject.status === "closed" && <td className="py-1 tabular-nums">{dist[o.id] ?? 0}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </Card>
  );
}

function Deliverables({ exerciseId, inject, state, refresh }: { exerciseId: string; inject: CsInject; state: CsState; refresh: () => void }) {
  const c = inject.control!;
  return (
    <Card dense className="gap-3">
      <SectionLabel>{inject.deliverable ? DELIVERABLE_LABELS[inject.deliverable.kind] : "Written task"}</SectionLabel>
      {state.viewer.isControl && <CloudSeam feature="ai-grading-deliverables" />}
      {c.deliverableCriteria.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-[color:var(--color-muted-foreground)]">Criteria</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {c.deliverableCriteria.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      )}
      {c.deliverables.map((d) => (
        <div key={d.responseId} className="space-y-2 rounded-lg bg-[color:var(--color-muted)] p-3">
          <p className="text-xs font-semibold">{teamNameOf(state, d.teamId)}</p>
          <p className="whitespace-pre-wrap text-sm">{d.text}</p>
          <GradeLine grade={d.grade} closed={inject.status === "closed"} />
          {state.viewer.isControl && <DeliverableGradeForm exerciseId={exerciseId} responseId={d.responseId} grade={d.grade} onSaved={refresh} />}
        </div>
      ))}
    </Card>
  );
}

const DELIVERABLE_RATINGS = [
  { value: "met", label: "Met" },
  { value: "partially_met", label: "Partially met" },
  { value: "not_met", label: "Not met" },
];

function ratingForScore(score: number): string {
  if (score >= 3) return "met";
  if (score >= 2) return "partially_met";
  return "not_met";
}

function DeliverableGradeForm({
  exerciseId,
  responseId,
  grade,
  onSaved,
}: {
  exerciseId: string;
  responseId: string;
  grade: { score: number | null; rating: string | null } | null | undefined;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(String(grade?.score ?? 2));
  const [rating, setRating] = useState(grade?.rating ?? ratingForScore(Number(grade?.score ?? 2)));
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>
        {grade ? "Change the grade" : "Grade"}
      </Button>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let error: string | null = null;
    try {
      const res = await fetch(`/api/exercises/${exerciseId}/grades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseId, score: Number(score), rating, rationale: rationale.trim() }),
      });
      if (!res.ok) error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The grade was not saved. Try again.";
    } catch {
      error = "Could not reach the server. Check your connection and try again.";
    }
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Grade saved.");
    setOpen(false);
    setRationale("");
    onSaved();
  }

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <FieldSelect
          aria-label="Score"
          value={score}
          onChange={(v) => {
            setScore(v);
            setRating(ratingForScore(Number(v)));
          }}
          options={[0, 1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} of 4` }))}
        />
        <FieldSelect aria-label="Rating" value={rating} onChange={setRating} options={DELIVERABLE_RATINGS} />
      </div>
      <Textarea aria-label="Rationale" placeholder="Why this grade." rows={2} maxLength={2000} value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="accent" disabled={busy || !rationale.trim()}>
          Save grade
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function GradeLine({
  grade,
  closed,
}: {
  grade: { score: number | null; rating: string | null; rationale: string | null } | null | undefined;
  closed: boolean;
}) {
  if (!grade) {
    return <p className="text-xs text-[color:var(--color-muted-foreground)]">{closed ? "Not graded yet." : "Grade after close."}</p>;
  }
  return (
    <p className="text-xs">
      <span className="font-semibold">
        {grade.rating === "met" ? "Met" : grade.rating === "partially_met" ? "Partially met" : "Not met"}
        {grade.score !== null ? `, ${grade.score} of 4` : ""}.
      </span>{" "}
      <span className="text-[color:var(--color-muted-foreground)]">{grade.rationale}</span>
    </p>
  );
}

function InjectLog({ state }: { state: CsState }) {
  const closed = state.injects.filter((i) => i.status === "closed").sort((a, b) => a.seq - b.seq);
  if (!closed.length) return null;
  return (
    <Card dense className="gap-2">
      <SectionLabel>Path so far</SectionLabel>
      <ol className="space-y-1.5">
        {closed.map((i) => {
          const s = i.control?.summary;
          const after: PathKey | null =
            s?.scoreAfter !== null && s?.scoreAfter !== undefined && state.score ? pathFor(s.scoreAfter, state.score.thresholds) : null;
          return (
            <li key={i.id} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-xs tabular-nums text-[color:var(--color-muted-foreground)]">{i.seq}</span>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              {s?.delta !== null && s?.delta !== undefined && (
                <span className="text-xs tabular-nums text-[color:var(--color-muted-foreground)]">{signed(s.delta)}</span>
              )}
              {after && <span className="h-2 w-2 rounded-full" style={{ background: PATH_TONE[after].dot }} aria-label={PATH_LABELS[after]} />}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
