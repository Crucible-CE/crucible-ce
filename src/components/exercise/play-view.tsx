"use client";

// Participant view, phone and tablet first. Used by /play/[id] (guests and
// users) and by /exercises/[id] for players and observers.
//
// The header here is the one header on the player screen: path, update N of
// M, scenario time with its zone, "Closes in" and the session time left.
// Player copy says "Update", never "Inject".

import { PlayerFeedbackLink } from "./after-action-links";
import { Clock, FileDown, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMinutes, formatTimer, scenarioLabel } from "@/lib/exercise/time";
import { Brief, hasBrief } from "./brief";
import { ChatPanel } from "./chat-panel";
import { injectRemainingMs, timeboxLeftMs, useNow } from "./clocks";
import { FeedList } from "./feed-list";
import { ModeArea } from "./mode-area";
import { ObservationsPanel } from "./observations-panel";
import type { UseExerciseState } from "./use-exercise-state";
import { ROLE_LABELS, type ExerciseState } from "./types";

/** Guests reach only /api/play/*, so players download from there. */
export function SituationManualLink({ exerciseId }: { exerciseId: string }) {
  return (
    <a
      href={`/api/play/${exerciseId}/exports/situation-manual`}
      download
      className={cn(buttonVariants({ size: "sm", variant: "outline" }), "w-fit")}
    >
      <FileDown className="h-4 w-4" />
      Situation Manual (PDF)
    </a>
  );
}

export function WaitingRoom({ state, timezone }: { state: ExerciseState; timezone: string }) {
  const myTeam = state.teams.find((t) => t.id === state.me?.teamId)?.name;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="items-center gap-3 text-center">
        <Clock className="h-8 w-8 text-[color:var(--mist-indigo)]" />
        <h2 className="text-lg font-semibold">Waiting for the facilitator to start</h2>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">This page updates on its own.</p>
        {state.me && (
          <div className="flex flex-wrap justify-center gap-1.5">
            <Badge variant="secondary">{state.me.displayName}</Badge>
            {myTeam && <Badge variant="accent">{myTeam}</Badge>}
            {state.me.roles.map((r) => (
              <Badge key={r} variant="outline">
                {ROLE_LABELS[r] ?? r}
              </Badge>
            ))}
          </div>
        )}
        {state.exercise.scenarioStartAt && (
          <p className="text-[12.5px] text-[color:var(--color-muted-foreground)]">
            Scenario starts {scenarioLabel(state.exercise.scenarioStartAt, null, timezone)}
          </p>
        )}
      </Card>
      <Card className="gap-3">
        <h2 className="text-base font-semibold">Brief</h2>
        {hasBrief(state) && <Brief state={state} />}
        <SituationManualLink exerciseId={state.exercise.id} />
      </Card>
    </div>
  );
}

export function PlayHeader({ state, timezone, serverOffsetMs, inShell }: { state: ExerciseState; timezone: string; serverOffsetMs: number; inShell?: boolean }) {
  const now = useNow(serverOffsetMs);
  const ex = state.exercise;
  const inject = state.currentInject ?? null;
  const running = ex.status === "live" || ex.status === "paused";
  const left = injectRemainingMs(inject, ex, now);
  const sessionLeft = running ? timeboxLeftMs(ex, now) : null;
  const scenario = scenarioLabel(inject?.scenarioTime ?? null, ex.scenarioStartAt, timezone);
  const myTeam = state.teams.find((t) => t.id === state.me?.teamId)?.name;
  const total = state.injectTotal ?? null;
  return (
    <header className={cn("sticky z-20 rounded-md border border-[color:var(--color-border)] bg-background/90 px-4 py-3 backdrop-blur-xl", inShell ? "top-16" : "top-2")}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold tracking-tight">{ex.title}</h1>
        {state.path?.label && ex.status !== "draft" && ex.status !== "lobby" && <Badge variant="accent">{state.path.label}</Badge>}
        {ex.status === "paused" && <Badge variant="warning">Paused</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[color:var(--color-muted-foreground)]">
        {myTeam && <span>{myTeam}</span>}
        {inject && running && (
          <span data-testid="update-progress">
            Update {inject.seq}
            {total ? ` of ${Math.max(total, inject.seq)}` : ""}
          </span>
        )}
        {scenario && <span className="font-mono tabular-nums">{scenario}</span>}
        {left !== null && (
          <span className={left < 60_000 ? "font-mono font-semibold tabular-nums text-[color:var(--mist-warn)]" : "font-mono tabular-nums"}>
            Closes in {formatTimer(left)}
          </span>
        )}
        {sessionLeft !== null && <span className="font-mono tabular-nums">Session left {formatMinutes(sessionLeft)}</span>}
      </div>
    </header>
  );
}

export function PlayView({
  exerciseId,
  s,
  timezone,
  isGuest,
  inShell = false,
}: {
  exerciseId: string;
  s: UseExerciseState;
  timezone: string;
  isGuest: boolean;
  inShell?: boolean;
}) {
  const state = s.state!;
  const ex = state.exercise;
  const status = ex.status;
  const isScribe = !isGuest && Boolean(state.me?.roles.includes("scribe"));

  if (status === "draft" || status === "lobby") {
    return (
      <div className="space-y-6">
        <PlayHeader state={state} timezone={timezone} serverOffsetMs={s.serverOffsetMs} inShell={inShell} />
        <WaitingRoom state={state} timezone={timezone} />
      </div>
    );
  }

  if (status === "ended" || status === "abandoned") {
    return (
      <div className="space-y-6">
        <PlayHeader state={state} timezone={timezone} serverOffsetMs={s.serverOffsetMs} inShell={inShell} />
        <Card className="mx-auto max-w-lg items-center gap-3 text-center">
          <h2 className="text-lg font-semibold">{status === "ended" ? "This exercise has ended" : "This exercise was stopped"}</h2>
          {status === "ended" && state.me && <PlayerFeedbackLink exerciseId={exerciseId} />}
        </Card>
        {status === "ended" && <ModeArea view="DebriefView" exerciseId={exerciseId} state={state} isGuest={isGuest} refresh={s.refresh} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PlayHeader state={state} timezone={timezone} serverOffsetMs={s.serverOffsetMs} inShell={inShell} />
      {status === "paused" && (
        <div role="status" className="flex items-center gap-2 rounded-md bg-[color:color-mix(in_srgb,var(--mist-warn),transparent_88%)] px-3 py-2 text-[13px] text-[color:var(--mist-warn)]">
          <Pause className="h-4 w-4" />
          Paused. Wait for the facilitator.
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0">
          <ModeArea view="PlayerView" exerciseId={exerciseId} state={state} isGuest={isGuest} refresh={s.refresh} />
        </main>
        <aside className="min-w-0">
          <Card dense className="lg:sticky lg:top-24">
            <Tabs defaultValue="chat">
              <TabsList className="w-full overflow-x-auto">
                <TabsTrigger value="chat">Chat</TabsTrigger>
                <TabsTrigger value="feed">Updates</TabsTrigger>
                <TabsTrigger value="brief">Brief</TabsTrigger>
                {isScribe && <TabsTrigger value="observations">Observations</TabsTrigger>}
              </TabsList>
              <TabsContent value="chat" className="pt-2">
                <ChatPanel
                  exerciseId={exerciseId}
                  chatTick={s.chatTick}
                  isControl={false}
                  myTeamId={state.me?.teamId ?? null}
                  teams={state.teams}
                  timezone={timezone}
                  canPost={Boolean(state.me)}
                  className="max-h-[60vh]"
                />
              </TabsContent>
              <TabsContent value="feed" className="max-h-[60vh] overflow-y-auto pt-2">
                <FeedList feed={state.feed ?? []} teams={state.teams} timezone={timezone} player />
              </TabsContent>
              <TabsContent value="brief" className="max-h-[60vh] space-y-3 overflow-y-auto pt-2">
                <Brief state={state} />
                <SituationManualLink exerciseId={exerciseId} />
              </TabsContent>
              {isScribe && (
                <TabsContent value="observations" className="max-h-[60vh] overflow-y-auto pt-2">
                  <ObservationsPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} currentInject={state.currentInject} />
                </TabsContent>
              )}
            </Tabs>
          </Card>
        </aside>
      </div>
    </div>
  );
}
