"use client";

// Player main area. The exercise shell owns the header (update N of M,
// scenario time, countdown, path label); this view holds the update, the
// team question, the written task, and the team's result after close.

import { useState } from "react";
import { CheckCircle2, CornerDownRight, Hourglass, Loader2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DELIVERABLE_LABELS } from "../schema";
import { SafeMarkdown } from "./markdown";
import { ArtifactCard, ClockList, PathBadge, SectionLabel, scenarioLabel } from "./shared";
import { asState, type CsInject, type CsQuestion, type CsState, type CsTeamDecision, type ModeViewProps } from "./types";

export function PlayerView(props: ModeViewProps) {
  const state = asState(props.state);
  if (!state) return <Notice icon="wait" text="Loading the exercise." />;

  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const history = state.injects.filter((i) => i.status === "closed" && i.id !== current?.id).sort((a, b) => b.seq - a.seq);
  const paused = state.exercise.status === "paused";
  const onTeam = Boolean(state.me?.teamId);

  if (state.exercise.status === "draft" || state.exercise.status === "lobby") {
    return <Notice icon="wait" text="The exercise has not started yet." />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
      {!current && <Notice icon="wait" text="Waiting for the first update." />}

      {current && current.forMyTeam === false && <Notice icon="info" text="This update is for other teams." />}

      {current && current.forMyTeam !== false && (
        <>
          <InjectBody inject={current} />
          {current.status === "open" ? (
            <>
              {current.question ? (
                <QuestionCard key={current.id} inject={current} question={current.question} respond={props.respond} disabled={paused} />
              ) : (
                <Notice icon="info" text={onTeam ? "Your team has no decision on this update." : "You are observing this exercise."} />
              )}
              {current.deliverable && <DeliverableCard key={`d-${current.id}`} inject={current} respond={props.respond} disabled={paused} />}
              {current.question?.discussionPrompt && <DiscussionCard prompt={current.question.discussionPrompt} />}
            </>
          ) : (
            <>
              <Result inject={current} />
              {state.exercise.status !== "ended" && <Notice icon="wait" text="Waiting for the next update." />}
            </>
          )}
        </>
      )}

      {state.clocks.some((c) => c.status !== "pending") && (
        <Card dense>
          <SectionLabel>Regulatory clocks</SectionLabel>
          <ClockList clocks={state.clocks.filter((c) => c.status !== "pending")} state={state} />
        </Card>
      )}

      {history.length > 0 && <History injects={history} state={state} />}
    </div>
  );
}

function Notice({ icon, text }: { icon: "wait" | "info"; text: string }) {
  return (
    <Card dense className="flex-row items-center gap-3 text-sm text-[color:var(--color-muted-foreground)]">
      {icon === "wait" ? <Hourglass className="h-4 w-4 shrink-0" aria-hidden /> : <MessagesSquare className="h-4 w-4 shrink-0" aria-hidden />}
      <span>{text}</span>
    </Card>
  );
}

function InjectBody({ inject }: { inject: CsInject }) {
  return (
    <Card className="gap-4">
      <h2 className="font-display text-xl font-semibold leading-tight">{inject.title}</h2>
      {inject.outcomes.length > 0 && (
        <div className="space-y-1.5">
          <SectionLabel>Since your last decision</SectionLabel>
          <ul className="space-y-1.5">
            {inject.outcomes.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-[color:var(--color-muted-foreground)]">
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SafeMarkdown text={inject.narrativeMd} className="text-[15px]" />
      {inject.consequenceText && (
        <div className="rounded-lg bg-[color:var(--color-muted)] px-4 py-3 text-sm">
          <SafeMarkdown text={inject.consequenceText} />
        </div>
      )}
      {inject.artifacts.length > 0 && (
        <div className="space-y-2">
          {inject.artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </Card>
  );
}

const TYPE_TAG: Partial<Record<CsQuestion["type"], string>> = { materiality: "Materiality decision", ransom: "Ransom decision" };

/** "General counsel decides. Your team recommends." */
export function ownerLine(q: Pick<CsQuestion, "decisionOwner" | "iDecide" | "team">): string {
  if (q.iDecide) return `You decide for ${q.team}. Your team recommends.`;
  return `${q.decisionOwner?.trim() || "The decision owner"} decides. Your team recommends.`;
}

function QuestionCard({
  inject,
  question,
  respond,
  disabled,
}: {
  inject: CsInject;
  question: CsQuestion;
  respond: ModeViewProps["respond"];
  disabled: boolean;
}) {
  const submitted = inject.myVote?.optionId ?? null;
  const [choice, setChoice] = useState<string | null>(submitted);
  const [comment, setComment] = useState(inject.myVote?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const changed = choice !== submitted || (comment.trim() || null) !== (inject.myVote?.comment ?? null);
  const decide = Boolean(question.iDecide);
  const mineLabel = decide ? "Your decision" : "Your vote";

  async function submit() {
    if (!choice) return;
    setBusy(true);
    try {
      const r = await respond(inject.id, "vote", { optionId: choice, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      if (!r.ok) toast.error(r.error ?? "Your choice was not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-4">
      <div className="space-y-1">
        {TYPE_TAG[question.type] && (
          <span className="inline-block rounded bg-[color:var(--mist-navy-soft)] px-2 py-0.5 text-xs font-semibold text-[color:var(--mist-navy)]">
            {TYPE_TAG[question.type]}
          </span>
        )}
        <p className="text-lg font-semibold leading-snug">{question.stem}</p>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{ownerLine(question)}</p>
      </div>

      <div className="grid gap-2.5" role="radiogroup" aria-label={question.stem}>
        {question.options.map((o) => {
          const selected = choice === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || busy}
              onClick={() => setChoice(o.id)}
              className={cn(
                "flex min-h-14 w-full items-start gap-3 rounded-xl border-2 px-4 py-3 text-left text-[15px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-ring)] disabled:opacity-60",
                selected
                  ? "border-[color:var(--mist-navy)] bg-[color:var(--mist-navy-soft)]"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-card)] hover:bg-[color:var(--color-muted)]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold uppercase",
                  selected ? "border-[color:var(--mist-navy)] bg-[color:var(--mist-navy)] text-white" : "border-[color:var(--color-border)]",
                )}
                aria-hidden
              >
                {o.id}
              </span>
              <span className="flex-1">{o.text}</span>
              {submitted === o.id && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--mist-ok)]" aria-label={mineLabel} />}
            </button>
          );
        })}
      </div>

      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        placeholder="Why this choice (optional)"
        aria-label="Comment"
        disabled={disabled || busy}
        className="h-11"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" className="min-h-12 flex-1 sm:flex-none" disabled={!choice || !changed || busy || disabled} onClick={() => void submit()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {decide ? (submitted ? "Change decision" : "Submit decision") : submitted ? "Change vote" : "Submit vote"}
        </Button>
        {submitted && !changed && (
          <span className="text-sm text-[color:var(--color-muted-foreground)]">
            {decide ? "Decision in." : "Vote in."} You can change it until the update closes.
          </span>
        )}
        {inject.progress.required > 0 && (
          <span className="text-xs text-[color:var(--color-muted-foreground)]">
            {inject.progress.voted} of {inject.progress.required} voted
          </span>
        )}
      </div>
    </Card>
  );
}

function DeliverableCard({ inject, respond, disabled }: { inject: CsInject; respond: ModeViewProps["respond"]; disabled: boolean }) {
  const d = inject.deliverable!;
  const [text, setText] = useState(inject.myDeliverable?.text ?? "");
  const [busy, setBusy] = useState(false);
  const saved = inject.myDeliverable?.text ?? "";

  async function submit() {
    setBusy(true);
    try {
      const r = await respond(inject.id, "deliverable", { text: text.trim() });
      if (!r.ok) toast.error(r.error ?? "The response was not saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3">
      <SectionLabel>{DELIVERABLE_LABELS[d.kind]}</SectionLabel>
      <p className="text-[15px]">{d.prompt}</p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        maxLength={6000}
        aria-label={DELIVERABLE_LABELS[d.kind]}
        disabled={disabled || busy}
        placeholder="One response for your team."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!text.trim() || text.trim() === saved.trim() || busy || disabled} onClick={() => void submit()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {saved ? "Update" : "Submit"}
        </Button>
        {saved && text.trim() === saved.trim() && <span className="text-sm text-[color:var(--color-muted-foreground)]">Submitted for your team.</span>}
      </div>
    </Card>
  );
}

function DiscussionCard({ prompt }: { prompt: string }) {
  return (
    <Card dense className="gap-2">
      <SectionLabel>Discuss</SectionLabel>
      <p className="text-sm">{prompt}</p>
      <p className="text-xs text-[color:var(--color-muted-foreground)]">Not scored.</p>
    </Card>
  );
}

export function decisionText(d: CsTeamDecision | undefined, options: Array<{ id: string; text: string }>): string {
  if (!d || !d.optionId) return d?.source === "tie" ? "No decision. The recommendations were tied." : "No decision.";
  const o = options.find((x) => x.id === d.optionId);
  const by = d.source === "owner" ? "Decision owner" : "Team majority";
  return `${by}: ${d.optionId.toUpperCase()}${o ? `. ${o.text}` : ""}`;
}

/** My choice on a closed update, plus my team's split and decision when they are shown. */
function Result({ inject }: { inject: CsInject }) {
  const q = inject.question;
  if (!q) return null;
  const mine = inject.myVote?.optionId ?? null;
  const mineLabel = inject.myVote?.decider ? "Your decision" : "Your vote";
  const dist = inject.reveal?.distribution?.[q.team] ?? null;
  const best = inject.reveal?.best?.[q.team] ?? null;
  const decision = inject.reveal?.decisions?.[q.team];
  const total = dist ? Object.values(dist).reduce((a, b) => a + b, 0) : 0;
  return (
    <Card dense className="gap-3">
      <p className="text-sm font-medium">{q.stem}</p>
      <ul className="space-y-2">
        {q.options.map((o) => {
          const n = dist?.[o.id] ?? 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <li key={o.id} className="space-y-1">
              <div className="flex items-start gap-2 text-sm">
                <span className="w-5 shrink-0 font-semibold uppercase">{o.id}</span>
                <span className="flex-1">{o.text}</span>
                {mine === o.id && <span className="shrink-0 text-xs font-semibold text-[color:var(--mist-navy)]">{mineLabel}</span>}
                {best === o.id && <span className="shrink-0 text-xs font-semibold text-[color:var(--mist-ok)]">Intended best</span>}
              </div>
              {dist && (
                <div className="ml-7 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-muted)]">
                    <div className="h-full rounded-full bg-[color:var(--mist-ink-4)]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-[color:var(--color-muted-foreground)]">{n}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {inject.reveal?.decisions && <p className="text-sm font-medium">{decisionText(decision, q.options)}</p>}
      {!mine && <p className="text-xs text-[color:var(--color-muted-foreground)]">No vote.</p>}
    </Card>
  );
}

function History({ injects, state }: { injects: CsInject[]; state: CsState }) {
  return (
    <section className="space-y-2">
      <SectionLabel>Earlier updates</SectionLabel>
      {injects.map((i) => (
        <details key={i.id} className="rounded-xl bg-[color:var(--color-card)] shadow-[var(--elevation-1)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
            <span className="text-xs tabular-nums text-[color:var(--color-muted-foreground)]">{i.seq}</span>
            <span className="flex-1 truncate text-sm font-medium">{i.title}</span>
            {i.playedOnPath && <PathBadge path={i.playedOnPath} className="hidden sm:inline-flex" />}
          </summary>
          <div className="space-y-3 border-t border-[color:var(--color-border)] px-4 py-3">
            {i.forMyTeam === false ? (
              <p className="text-sm text-[color:var(--color-muted-foreground)]">This update was for other teams.</p>
            ) : (
              <>
                {i.scenarioTime && <p className="text-xs text-[color:var(--color-muted-foreground)]">{scenarioLabel(state, i.scenarioTime)}</p>}
                <SafeMarkdown text={i.narrativeMd} className="text-sm" />
                <Result inject={i} />
              </>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
