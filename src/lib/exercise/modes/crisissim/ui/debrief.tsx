"use client";

// Live debrief at ENDEX: path arc, key decisions with the recommendation
// split and the intended option, clock outcomes, decisions that moved the
// path, and written deliverables. No-fault wording; no names in splits.

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { DELIVERABLE_LABELS, PATH_KEYS, PATH_LABELS, type PathKey } from "../schema";
import { GradeLine } from "./control";
import { ClockList, PATH_TONE, PathBadge, QUALITY_LABEL, QUALITY_TONE, SectionLabel, scenarioLabel, teamNameOf } from "./shared";
import { asState, type CsDebrief, type CsDebriefDecision, type CsState, type ModeViewProps } from "./types";

const RANK: Record<PathKey, number> = { optimal: 2, degrading: 1, critical: 0 };

const SOURCE_LABEL: Record<CsDebriefDecision["source"], string> = {
  owner: "Decision owner",
  majority: "Team majority",
  tie: "No decision, tied",
  none: "No decision",
};

export function DebriefView(props: ModeViewProps) {
  const state = asState(props.state);
  const d = state?.debrief;
  if (!state || !d) return <p className="text-sm text-[color:var(--color-muted-foreground)]">The debrief appears after the exercise ends.</p>;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-10">
      <Card className="gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-semibold">Debrief</h2>
          <span className="text-sm text-[color:var(--color-muted-foreground)]">Ended on</span>
          <PathBadge path={d.finalPath} />
          {d.finalScore !== undefined && (
            <span className="text-sm text-[color:var(--color-muted-foreground)]">
              Score <span className="font-semibold tabular-nums text-[color:var(--color-foreground)]">{Math.round(d.finalScore * 10) / 10}</span>
            </span>
          )}
        </div>
        <PathArc debrief={d} />
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          {d.voteCount} votes, {d.noVoteCount ?? 0} no vote.
        </p>
      </Card>

      <Card className="gap-4">
        <SectionLabel>Key decisions</SectionLabel>
        {(d.keyDecisions ?? []).length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">No key decisions in this exercise.</p>
        ) : (
          <ol className="space-y-5">
            {d.keyDecisions.map((k) => (
              <li key={`${k.injectId}-${k.team}`}>
                <DecisionBlock decision={k} state={state} showHeader />
              </li>
            ))}
          </ol>
        )}
      </Card>

      {d.clocks.length > 0 && (
        <Card className="gap-3">
          <SectionLabel>Regulatory clocks</SectionLabel>
          <ClockList clocks={d.clocks} state={state} />
        </Card>
      )}

      <Card className="gap-4">
        <SectionLabel>Decisions that moved the path</SectionLabel>
        {d.moves.length === 0 ? (
          <p className="text-sm text-[color:var(--color-muted-foreground)]">The path did not change.</p>
        ) : (
          <ol className="space-y-5">
            {d.moves.map((m) => {
              const up = RANK[m.to] > RANK[m.from];
              return (
                <li key={m.injectId} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {up ? (
                      <ArrowUpRight className="h-4 w-4 text-[color:var(--mist-ok)]" aria-hidden />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-[color:var(--mist-danger)]" aria-hidden />
                    )}
                    <span className="font-medium">
                      Update {m.seq}. {m.title}
                    </span>
                    <span className="text-sm text-[color:var(--color-muted-foreground)]">
                      {PATH_LABELS[m.from]} to {PATH_LABELS[m.to]}
                    </span>
                  </div>
                  <ul className="space-y-3 pl-6">
                    {m.decisions.map((dec) => (
                      <li key={dec.team}>
                        <DecisionBlock decision={dec} state={state} />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {(d.deliverables ?? []).length > 0 && (
        <Card className="gap-4">
          <SectionLabel>Written deliverables</SectionLabel>
          {d.deliverables.map((x, i) => (
            <div key={`${x.injectId}-${i}`} className="space-y-2">
              <p className="text-sm font-medium">
                {DELIVERABLE_LABELS[x.kind]}, {x.team}. Update {x.seq}.
              </p>
              <p className="text-xs text-[color:var(--color-muted-foreground)]">{x.prompt}</p>
              <p className="whitespace-pre-wrap rounded-lg bg-[color:var(--color-muted)] p-3 text-sm">{x.text}</p>
              {state.viewer.isControl && <GradeLine grade={x.grade} closed />}
            </div>
          ))}
        </Card>
      )}

      {d.individual && d.individual.length > 0 && <Individual debrief={d} state={state} />}
    </div>
  );
}

function DecisionBlock({ decision: k, state, showHeader = false }: { decision: CsDebriefDecision; state: CsState; showHeader?: boolean }) {
  const total = k.split.reduce((a, s) => a + s.votes, 0);
  return (
    <div className="space-y-1.5 text-sm">
      {showHeader && (
        <p className="text-xs text-[color:var(--color-muted-foreground)]">
          Update {k.seq}. {k.title}
          {k.scenarioTime ? `, ${scenarioLabel(state, k.scenarioTime)}` : ""}
        </p>
      )}
      <p>
        <span className="font-semibold">{k.team}.</span> {k.stem}
        {k.decisionOwner && <span className="text-[color:var(--color-muted-foreground)]"> {k.decisionOwner} decides.</span>}
      </p>
      <p>
        <span className="font-medium">{SOURCE_LABEL[k.source]}:</span>{" "}
        {k.decision ? `${k.decision.optionId.toUpperCase()}. ${k.decision.text}` : <span className="text-[color:var(--color-muted-foreground)]">none</span>}
        {k.quality && <span className={cn("ml-2 text-xs font-semibold", QUALITY_TONE[k.quality])}>{QUALITY_LABEL[k.quality]}</span>}
      </p>
      {k.decision?.rationale && <p className="text-xs text-[color:var(--color-muted-foreground)]">{k.decision.rationale}</p>}
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        {total === 0 ? "No recommendations." : `Recommendations: ${k.split.map((s) => `${s.optionId.toUpperCase()} ${s.votes}`).join(", ")}.`}
        {k.noVotes > 0 ? ` No vote ${k.noVotes}.` : ""}
      </p>
      {k.best && k.best.optionId !== k.decision?.optionId && (
        <p className="text-xs">
          <span className="font-semibold text-[color:var(--mist-ok)]">Intended:</span> {k.best.optionId.toUpperCase()}. {k.best.text}
          {k.best.rationale && <span className="block text-[color:var(--color-muted-foreground)]">{k.best.rationale}</span>}
        </p>
      )}
      {k.best && k.best.optionId === k.decision?.optionId && <p className="text-xs font-semibold text-[color:var(--mist-ok)]">This was the intended option.</p>}
      {k.clockChanges.length > 0 && (
        <p className="text-xs text-[color:var(--mist-warn)]">
          {k.clockChanges.map((e) => `${e.action === "trigger" ? "Started" : "Met"} ${e.label}`).join(". ")}.
        </p>
      )}
    </div>
  );
}

/** One line across the updates over three path bands. Control sees the score line. */
export function PathArc({ debrief }: { debrief: CsDebrief }) {
  const W = 640;
  const H = 180;
  const padL = 8;
  const padR = 8;
  const padT = 10;
  const padB = 24;
  const n = debrief.arc.length;
  if (n === 0) return <p className="text-sm text-[color:var(--color-muted-foreground)]">No updates closed.</p>;

  const useScore = debrief.thresholds !== undefined && debrief.arc.every((a) => typeof a.scoreAfter === "number");
  const xs = (i: number) => padL + (i / n) * (W - padL - padR);
  const innerH = H - padT - padB;

  let yOf: (i: number) => number;
  let bands: Array<{ path: PathKey; y: number; h: number }>;
  if (useScore) {
    const t = debrief.thresholds!;
    const values = [0, ...debrief.arc.map((a) => a.scoreAfter as number)];
    const lo = Math.min(t.degrading - 3, ...values);
    const hi = Math.max(t.optimal + 3, ...values);
    const y = (v: number) => padT + ((hi - v) / (hi - lo)) * innerH;
    yOf = (i) => y(values[i]);
    bands = [
      { path: "optimal", y: y(hi), h: y(t.optimal) - y(hi) },
      { path: "degrading", y: y(t.optimal), h: y(t.degrading) - y(t.optimal) },
      { path: "critical", y: y(t.degrading), h: y(lo) - y(t.degrading) },
    ];
  } else {
    const bandH = innerH / 3;
    const center = (p: PathKey) => padT + (2 - RANK[p]) * bandH + bandH / 2;
    const paths: PathKey[] = [debrief.initialPath, ...debrief.arc.map((a) => a.newPath)];
    yOf = (i) => center(paths[i]);
    bands = PATH_KEYS.map((p) => ({ path: p, y: padT + (2 - RANK[p]) * bandH, h: bandH }));
  }

  const points = Array.from({ length: n + 1 }, (_, i) => `${xs(i).toFixed(1)},${yOf(i).toFixed(1)}`).join(" ");
  const finalPath = debrief.finalPath;
  const summary = `Path went from ${PATH_LABELS[debrief.initialPath]} to ${PATH_LABELS[finalPath]} over ${n} updates.`;

  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={summary}>
        {bands.map((b) => (
          <g key={b.path}>
            <rect x={padL} y={b.y} width={W - padL - padR} height={Math.max(0, b.h)} fill={PATH_TONE[b.path].dot} opacity={0.1} />
            <text x={W - padR - 4} y={b.y + 13} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.55}>
              {PATH_LABELS[b.path]}
            </text>
          </g>
        ))}
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {Array.from({ length: n + 1 }, (_, i) => (
          <circle key={i} cx={xs(i)} cy={yOf(i)} r={3.5} fill="var(--color-card)" stroke="currentColor" strokeWidth={2} />
        ))}
        {debrief.arc.map((a, i) => (
          <text key={a.injectId} x={xs(i + 1)} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity={0.6}>
            {a.seq}
          </text>
        ))}
        <text x={xs(0)} y={H - 6} textAnchor="start" fontSize="11" fill="currentColor" opacity={0.6}>
          Start
        </text>
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

function Individual({ debrief, state }: { debrief: CsDebrief; state: CsState }) {
  return (
    <Card className="gap-3 overflow-x-auto">
      <SectionLabel>Individual choices</SectionLabel>
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="text-xs text-[color:var(--color-muted-foreground)]">
          <tr>
            <th className="py-1.5 pr-3 font-medium">Person</th>
            <th className="py-1.5 pr-3 font-medium">Team</th>
            <th className="py-1.5 pr-3 font-medium">Votes</th>
            <th className="py-1.5 pr-3 font-medium">No vote</th>
            <th className="py-1.5 pr-3 font-medium">{QUALITY_LABEL.great}</th>
            <th className="py-1.5 pr-3 font-medium">{QUALITY_LABEL.good}</th>
            <th className="py-1.5 pr-3 font-medium">{QUALITY_LABEL.neutral}</th>
            <th className="py-1.5 font-medium">{QUALITY_LABEL.bad}</th>
          </tr>
        </thead>
        <tbody>
          {debrief.individual!.map((r) => (
            <tr key={r.participantId} className="border-t border-[color:var(--color-border)] tabular-nums">
              <td className="py-1.5 pr-3">{r.displayName}</td>
              <td className="py-1.5 pr-3">{teamNameOf(state, r.teamId)}</td>
              <td className="py-1.5 pr-3">{r.votes}</td>
              <td className="py-1.5 pr-3">{r.abstains}</td>
              <td className="py-1.5 pr-3">{r.great}</td>
              <td className="py-1.5 pr-3">{r.good}</td>
              <td className="py-1.5 pr-3">{r.neutral}</td>
              <td className="py-1.5">{r.bad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
