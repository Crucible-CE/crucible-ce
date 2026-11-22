"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { elapsedMs, formatInZone, formatTimer } from "@/lib/exercise/time";
import { AfterActionLinks } from "./after-action-links";
import { FeedList } from "./feed-list";
import { ModeArea } from "./mode-area";
import { MselPanel } from "./msel-panel";
import { ObservationsPanel } from "./observations-panel";
import { RosterPanel } from "./roster-panel";
import type { UseExerciseState } from "./use-exercise-state";
import { END_REASON_LABELS, STATUS_LABELS } from "./types";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{label}</dt>
      <dd className="mt-0.5 text-[14px] font-semibold">{value}</dd>
    </div>
  );
}

export function EndedSummary({ exerciseId, s, timezone }: { exerciseId: string; s: UseExerciseState; timezone: string }) {
  const state = s.state!;
  const ex = state.exercise;
  const delivered =
    state.injects?.filter((i) => i.status === "open" || i.status === "closed").length ??
    (state.feed ?? []).filter((f) => f.type === "inject_released").length;
  const isControl = state.viewer.isControl;
  return (
    <div className="space-y-6">
      <Card className="gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">{ex.title}</h1>
          <Badge variant="secondary">{STATUS_LABELS[ex.status] ?? ex.status}</Badge>
          {ex.isPractice && <Badge variant="outline">Practice</Badge>}
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Run time" value={formatTimer(elapsedMs(ex, Date.now()))} />
          <Fact label="Injects" value={String(delivered)} />
          <Fact label="Ended" value={ex.endedAt ? formatInZone(new Date(ex.endedAt), timezone) : "Not recorded"} />
          <Fact label="Reason" value={END_REASON_LABELS[ex.endReason ?? ""] ?? "Not recorded"} />
        </dl>
        {ex.status === "ended" && <AfterActionLinks exerciseId={exerciseId} isPractice={ex.isPractice} isParticipant={Boolean(state.me)} isControl={state.viewer.isControl} />}
      </Card>

      {ex.status === "ended" && <ModeArea view="DebriefView" exerciseId={exerciseId} state={state} isGuest={false} refresh={s.refresh} />}

      {isControl && (
        <Card dense>
          <Tabs defaultValue={state.me?.roles.includes("evaluator") ? "observations" : "feed"}>
            <TabsList className="w-full overflow-x-auto">
              <TabsTrigger value="observations">Observations</TabsTrigger>
              <TabsTrigger value="feed">Feed</TabsTrigger>
              <TabsTrigger value="msel">MSEL</TabsTrigger>
              <TabsTrigger value="roster">Roster</TabsTrigger>
            </TabsList>
            <TabsContent value="observations" className="pt-2">
              <ObservationsPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} currentInject={null} />
            </TabsContent>
            <TabsContent value="feed" className="max-h-[70vh] overflow-y-auto pt-2">
              <FeedList feed={state.feed ?? []} teams={state.teams} timezone={timezone} />
            </TabsContent>
            <TabsContent value="msel" className="pt-2">
              <MselPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} />
            </TabsContent>
            <TabsContent value="roster" className="pt-2">
              <RosterPanel roster={state.roster} teams={state.teams} attendanceFor={exerciseId} />
            </TabsContent>
          </Tabs>
        </Card>
      )}
    </div>
  );
}
