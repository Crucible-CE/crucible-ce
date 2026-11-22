"use client";

// Debrief after ENDEX. Control sees, per update, each team's answer and its
// evaluator rating, and a grid of team outcomes over time. Players see their
// own team's answers. Teams are rated against expected actions, never people.

import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { Card } from "@/components/ui/card";
import { Notice, RatingBadge, SectionLabel, injectLine, ratingLabel, teamName } from "./shared";
import { asState, type ModeViewProps, type StInject, type StState } from "./types";

export function DebriefView(props: ModeViewProps) {
  const state = asState(props.state);
  const isControl = Boolean(state?.viewer.isControl);
  if (!state) return null;
  const closed = state.injects.filter((i) => i.status === "closed").sort((a, b) => a.seq - b.seq);
  if (closed.length === 0) return <Notice icon="info" text="No update closed before the end." />;

  if (!isControl) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 pb-10">
        <SectionLabel>Your team&apos;s answers</SectionLabel>
        {closed.map((i) => (
          <Card key={i.id} dense className="gap-2">
            <p className="text-xs text-[color:var(--color-muted-foreground)]">{injectLine(state, i)}</p>
            <p className="font-medium">{i.title}</p>
            {i.myVariant?.status === "active" ? (
              i.myAnswer ? (
                <p className="whitespace-pre-wrap text-sm">{i.myAnswer.text}</p>
              ) : (
                <p className="text-sm text-[color:var(--color-muted-foreground)]">Your team did not submit an answer.</p>
              )
            ) : (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">{i.myVariant ? "Your team was on standby." : "This update had nothing for your team."}</p>
            )}
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="space-y-2">
        <SectionLabel>Team outcomes over time</SectionLabel>
        <OutcomeGrid state={state} injects={closed.filter((i) => !i.contingency)} />
      </section>

      <section className="space-y-2">
        <SectionLabel>Answers by update</SectionLabel>
        {closed.map((i) => (
          <UpdateAnswers key={i.id} state={state} inject={i} />
        ))}
      </section>
    </div>
  );
}

function UpdateAnswers({ state, inject }: { state: StState; inject: StInject }) {
  const answers = inject.control?.answers ?? [];
  const active = inject.control?.activeTeamIds ?? [];
  return (
    <details className="group rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{inject.title}</span>
          <span className="block text-xs text-[color:var(--color-muted-foreground)]">
            {injectLine(state, inject)}, {answers.length} of {active.length} teams answered
          </span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-[color:var(--color-border)] p-4">
        <SafeMarkdown text={inject.narrativeMd} className="text-sm" />
        {active.map((teamId) => {
          const a = answers.find((x) => x.teamId === teamId);
          return (
            <div key={teamId} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{teamName(state, teamId)}</span>
                {a ? <RatingBadge rating={a.effective?.rating} score={a.effective?.score} source={a.effective?.source} /> : null}
              </div>
              {a ? (
                <>
                  <p className="whitespace-pre-wrap text-sm">{a.text}</p>
                  {a.effective?.rationale && <p className="text-xs text-[color:var(--color-muted-foreground)]">{a.effective.rationale}</p>}
                </>
              ) : (
                <p className="text-sm text-[color:var(--color-muted-foreground)]">No answer.</p>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

// Status encoding: a rating means good or bad, so it uses the status tokens,
// always with a letter in the cell and a legend, never color alone.
const CELL: Record<string, { fill: string; mark: string }> = {
  effective: { fill: "var(--mist-ok)", mark: "E" },
  partially_effective: { fill: "var(--mist-warn)", mark: "P" },
  ineffective: { fill: "var(--mist-danger)", mark: "N" },
};

function OutcomeGrid({ state, injects }: { state: StState; injects: StInject[] }) {
  const teams = state.teams;
  if (injects.length === 0 || teams.length === 0) return <p className="text-sm text-[color:var(--color-muted-foreground)]">No outcomes yet.</p>;
  const labelW = 140;
  const cell = 32;
  const gap = 2;
  const headH = 22;
  const width = labelW + injects.length * (cell + gap);
  const height = headH + teams.length * (cell + gap);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Team outcome by update" className="text-[color:var(--color-foreground)]">
          {injects.map((i, x) => (
            <text key={i.id} x={labelW + x * (cell + gap) + cell / 2} y={14} textAnchor="middle" fontSize={11} fill="var(--color-muted-foreground)">
              {i.seq}
            </text>
          ))}
          {teams.map((t, y) => {
            const top = headH + y * (cell + gap);
            return (
              <g key={t.id}>
                <text x={labelW - 8} y={top + cell / 2 + 4} textAnchor="end" fontSize={12} fill="currentColor">
                  {t.name.length > 18 ? `${t.name.slice(0, 17)}…` : t.name}
                </text>
                {injects.map((i, x) => {
                  const left = labelW + x * (cell + gap);
                  const isActive = i.control?.activeTeamIds.includes(t.id) ?? false;
                  const a = i.control?.answers.find((r) => r.teamId === t.id);
                  const rating = a?.effective?.rating ?? null;
                  const style = rating ? CELL[rating] : undefined;
                  const label = !isActive ? "Standby" : !a ? "No answer" : rating ? ratingLabel(rating) : "Not rated yet";
                  return (
                    <g key={i.id}>
                      <title>{`${t.name}, update ${i.seq}: ${label}`}</title>
                      <rect
                        x={left}
                        y={top}
                        width={cell}
                        height={cell}
                        rx={4}
                        fill={style ? style.fill : "var(--color-muted)"}
                        fillOpacity={style ? 0.85 : 1}
                        stroke={isActive && !style ? "var(--color-border)" : "none"}
                      />
                      <text x={left + cell / 2} y={top + cell / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={style ? "#fff" : "var(--color-muted-foreground)"}>
                        {style ? style.mark : isActive ? (a ? "?" : "0") : ""}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-[color:var(--color-muted-foreground)]">
        E effective, P partly effective, N not effective, 0 no answer, ? not rated yet. Blank cells mean standby. Columns are update numbers.
      </p>
    </div>
  );
}
