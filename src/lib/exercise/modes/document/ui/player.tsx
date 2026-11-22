"use client";

import { Card } from "@/components/ui/card";
import type { ModeViewProps } from "@/lib/exercise/modes/ui";
import { EarlierModules, EntryComposer, EntryRow, ModuleBody, Notice, SectionLabel, scenarioClock } from "./shared";
import { asDocState } from "./types";

export function PlayerView(props: ModeViewProps) {
  const state = asDocState(props.state);
  if (!state) return <Notice text="Loading the exercise." />;
  if (state.exercise.status === "draft" || state.exercise.status === "lobby") return <Notice text="The exercise has not started yet." />;

  const current = state.injects.find((i) => i.id === state.current) ?? null;
  const earlier = state.injects.filter((i) => i.status === "closed" && i.id !== current?.id).sort((a, b) => b.seq - a.seq);
  const paused = state.exercise.status === "paused";
  const ended = state.exercise.status === "ended" || state.exercise.status === "abandoned";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
      {!current && <Notice text="Waiting for the first module." />}
      {current && (
        <>
          <Card className="gap-4">
            <div className="space-y-1">
              <p className="text-xs text-[color:var(--color-muted-foreground)]">
                Module {current.seq}
                {state.modulesTotal ? ` of ${state.modulesTotal}` : ""}
                {scenarioClock(state, current.scenarioTime) ? `, ${scenarioClock(state, current.scenarioTime)}` : ""}
              </p>
              <h2 className="font-display text-xl font-semibold leading-tight">{current.title}</h2>
            </div>
            <ModuleBody state={state} module={current} />
          </Card>

          {current.status === "open" && state.canPost && !ended && <EntryComposer key={current.id} state={state} module={current} respond={props.respond} disabled={paused} />}
          {current.status === "open" && !state.canPost && (
            <Notice icon="info" text={state.config.scribeMode ? "A scribe records the discussion for this exercise." : "You are observing this exercise."} />
          )}
          {current.status === "closed" && !ended && <Notice text="Waiting for the next module." />}

          {current.entries.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Entries</SectionLabel>
              <ul className="space-y-2">
                {current.entries.map((e) => (
                  <EntryRow key={e.id} state={state} module={current} entry={e} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <EarlierModules state={state} modules={earlier} />
    </div>
  );
}
