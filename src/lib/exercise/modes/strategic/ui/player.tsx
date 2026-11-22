"use client";

// Player main area. The shell owns the header, timers, clocks, chat and feed.
// This view holds the shared update, the team's own variant, the answer
// composer (decision maker or scribe), and the history of closed updates with
// the team's own answers.

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SafeMarkdown } from "@/components/markdown/safe-markdown";
import { InjectBody, Notice, SectionLabel, injectLine } from "./shared";
import { asState, type ModeViewProps, type StInject, type StState } from "./types";

export function PlayerView(props: ModeViewProps) {
  const state = asState(props.state);
  if (!state) return <Notice text="Loading the exercise." />;
  if (state.exercise.status === "draft" || state.exercise.status === "lobby") return <Notice text="The exercise has not started yet." />;

  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const history = state.injects.filter((i) => i.status === "closed" && i.id !== current?.id).sort((a, b) => b.seq - a.seq);
  const paused = state.exercise.status === "paused";
  const ended = state.exercise.status === "ended" || state.exercise.status === "abandoned";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
      {!current && !ended && <Notice text="Waiting for the first update." />}
      {current && (
        <>
          <InjectBody state={state} inject={current} />
          <TeamPanel key={current.id} state={state} inject={current} respond={props.respond} paused={paused} />
          {current.status === "closed" && !ended && <Notice text="Waiting for the next update." />}
        </>
      )}
      {history.length > 0 && (
        <section className="space-y-2">
          <SectionLabel>Earlier updates</SectionLabel>
          {history.map((i) => (
            <HistoryItem key={i.id} state={state} inject={i} />
          ))}
        </section>
      )}
    </div>
  );
}

function TeamPanel({ state, inject, respond, paused }: { state: StState; inject: StInject; respond: ModeViewProps["respond"]; paused: boolean }) {
  const v = inject.myVariant;
  if (!state.me?.teamId) return <Notice icon="info" text="You are observing this exercise." />;
  if (!v) return <Notice icon="info" text="This update has nothing for your team." />;
  if (v.status === "standby") {
    return (
      <Card dense className="gap-2">
        <SectionLabel>Your team is on standby</SectionLabel>
        <SafeMarkdown text={v.narrativeMd} className="text-sm" />
      </Card>
    );
  }
  return (
    <Card className="gap-4">
      <div className="space-y-2">
        <SectionLabel>For your team</SectionLabel>
        <SafeMarkdown text={v.narrativeMd} className="text-sm" />
      </div>
      {v.questions.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-sm font-medium">
          {v.questions.map((q) => (
            <li key={q.key}>{q.text}</li>
          ))}
        </ol>
      )}
      {inject.status === "open" && inject.canAnswer ? (
        <Composer inject={inject} respond={respond} disabled={paused} />
      ) : inject.myAnswer ? (
        <SubmittedAnswer inject={inject} open={inject.status === "open"} />
      ) : inject.status === "open" ? (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          No answer yet.{" "}
          {state.submitters.length ? `${state.submitters.join(", ")} submits for your team.` : "Your decision maker submits for your team."} Suggest wording in team chat.
        </p>
      ) : (
        <p className="text-sm text-[color:var(--color-muted-foreground)]">Your team did not submit an answer.</p>
      )}
    </Card>
  );
}

function SubmittedAnswer({ inject, open }: { inject: StInject; open: boolean }) {
  const a = inject.myAnswer!;
  return (
    <div className="space-y-2 rounded-md bg-[color:var(--color-muted)] p-3">
      <p className="flex items-center gap-1.5 text-xs text-[color:var(--color-muted-foreground)]">
        <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--mist-ok)]" aria-hidden />
        {a.by ? `Submitted by ${a.by}.` : "Submitted."}
        {open ? " It can change until the update closes." : ""}
      </p>
      <p className="whitespace-pre-wrap text-sm">{a.text}</p>
    </div>
  );
}

function Composer({ inject, respond, disabled }: { inject: StInject; respond: ModeViewProps["respond"]; disabled: boolean }) {
  const [text, setText] = useState(inject.myAnswer?.text ?? "");
  const [busy, setBusy] = useState(false);
  const saved = inject.myAnswer?.text ?? "";
  // A teammate (the scribe or decision maker) may have saved a newer answer.
  useEffect(() => {
    setText((t) => (t === "" || t === saved ? saved : t));
  }, [saved]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const r = await respond(inject.id, "answer", { text: text.trim() });
    setBusy(false);
    if (!r.ok) toast.error(r.error ?? "The answer was not saved. Try again.");
    else toast.success(inject.myAnswer ? "Answer updated." : "Answer submitted.");
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Label htmlFor={`answer-${inject.id}`}>Team answer</Label>
      <Textarea
        id={`answer-${inject.id}`}
        rows={6}
        maxLength={6000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your team's decision, who owns it, and what happens next."
        disabled={disabled || busy}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="accent" disabled={disabled || busy || !text.trim() || text.trim() === saved.trim()}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {inject.myAnswer ? "Update answer" : "Submit answer"}
        </Button>
        {inject.myAnswer && <span className="text-xs text-[color:var(--color-muted-foreground)]">{inject.myAnswer.by ? `Last saved by ${inject.myAnswer.by}.` : "Saved."}</span>}
        {disabled && <span className="text-xs text-[color:var(--color-muted-foreground)]">The exercise is paused.</span>}
      </div>
    </form>
  );
}

function HistoryItem({ state, inject }: { state: StState; inject: StInject }) {
  const v = inject.myVariant;
  return (
    <details className="group rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{inject.title}</span>
          <span className="block text-xs text-[color:var(--color-muted-foreground)]">
            {injectLine(state, inject)}
            {v ? (v.status === "standby" ? ", standby" : inject.myAnswer ? ", answered" : ", no answer") : ""}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-[color:var(--color-border)] px-4 py-3 text-sm">
        <SafeMarkdown text={inject.narrativeMd} />
        {v && v.status === "active" && (
          <>
            {v.questions.length > 0 && (
              <ol className="list-decimal space-y-1 pl-5 font-medium">
                {v.questions.map((q) => (
                  <li key={q.key}>{q.text}</li>
                ))}
              </ol>
            )}
            {inject.myAnswer ? (
              <div className="rounded-md bg-[color:var(--color-muted)] p-3">
                <SectionLabel className="mb-1">Your team&apos;s answer</SectionLabel>
                <p className="whitespace-pre-wrap">{inject.myAnswer.text}</p>
              </div>
            ) : (
              <p className="text-[color:var(--color-muted-foreground)]">Your team did not submit an answer.</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
