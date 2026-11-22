"use client";

// Before STARTEX, for control who do not drive (controllers without a driver
// seat, evaluators): the planned MSEL with expected actions, the objectives,
// the roster and the brief. Read only.

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { scenarioLabel } from "@/lib/exercise/time";
import { Brief } from "./brief";
import { MselPanel } from "./msel-panel";
import { RosterPanel } from "./roster-panel";
import type { UseExerciseState } from "./use-exercise-state";
import { STATUS_LABELS } from "./types";

export function PreStartView({ exerciseId, s, timezone }: { exerciseId: string; s: UseExerciseState; timezone: string }) {
  const state = s.state!;
  const ex = state.exercise;
  const objectives = state.objectives ?? [];
  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-semibold tracking-tight">{ex.title}</h1>
          <Badge variant={ex.status === "lobby" ? "accent" : "outline"}>{STATUS_LABELS[ex.status] ?? ex.status}</Badge>
        </div>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
          {ex.scenarioStartAt
            ? `Not started. Scenario starts ${scenarioLabel(ex.scenarioStartAt, null, timezone)}.`
            : "Not started. The facilitator sets up the exercise here."}
        </p>
      </Card>
      <Card dense>
        <Tabs defaultValue="msel">
          <TabsList className="w-full overflow-x-auto">
            <TabsTrigger value="msel">MSEL</TabsTrigger>
            <TabsTrigger value="objectives">Objectives</TabsTrigger>
            <TabsTrigger value="roster">Roster</TabsTrigger>
            <TabsTrigger value="brief">Brief</TabsTrigger>
          </TabsList>
          <TabsContent value="msel" className="pt-2">
            <MselPanel exerciseId={exerciseId} tick={s.tick} timezone={timezone} readOnly />
          </TabsContent>
          <TabsContent value="objectives" className="pt-2">
            {objectives.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[color:var(--color-muted-foreground)]">No objectives yet.</p>
            ) : (
              <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px]">
                {objectives.map((o) => (
                  <li key={o.id}>{o.text}</li>
                ))}
              </ol>
            )}
          </TabsContent>
          <TabsContent value="roster" className="pt-2">
            <RosterPanel roster={state.roster} teams={state.teams} />
          </TabsContent>
          <TabsContent value="brief" className="pt-2">
            <Brief state={state} />
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
