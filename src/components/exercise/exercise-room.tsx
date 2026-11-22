"use client";

// /exercises/[id]: one page that switches by status and viewer.
//   draft, lobby   driver: lobby editor; other control: read-only MSEL,
//                  objectives and roster; others: waiting room
//   live, paused   control: control room; players and observers: play view
//   ended          summary, debrief, observations

import { Loader2 } from "lucide-react";
import { ConfirmDialogProvider } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { ControlRoom } from "./control-room";
import { EndedSummary } from "./ended-summary";
import { LobbyEditor } from "./lobby-editor";
import { PlayView } from "./play-view";
import { PreStartView } from "./prestart-view";
import { useExerciseState } from "./use-exercise-state";
import { STATUS_LABELS } from "./types";

function Room({ exerciseId, timezone }: { exerciseId: string; timezone: string }) {
  const s = useExerciseState(exerciseId, { guest: false });
  if (!s.state) {
    if (s.error) return <p role="alert" className="py-10 text-center text-[13px] text-[color:var(--mist-danger)]">{s.error}</p>;
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  const { exercise: ex, viewer } = s.state;

  if (ex.status === "draft" || ex.status === "lobby") {
    if (viewer.isDriver) {
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 flex-1 truncate headline">{ex.title}</h1>
            <Badge variant={ex.status === "lobby" ? "accent" : "outline"}>{STATUS_LABELS[ex.status]}</Badge>
          </div>
          <LobbyEditor exerciseId={exerciseId} tick={s.tick} onChanged={s.refresh} />
        </div>
      );
    }
    if (viewer.isControl) return <PreStartView exerciseId={exerciseId} s={s} timezone={timezone} />;
    return <PlayView exerciseId={exerciseId} s={s} timezone={timezone} isGuest={false} inShell />;
  }

  if (ex.status === "live" || ex.status === "paused") {
    if (viewer.isControl) return <ControlRoom exerciseId={exerciseId} s={s} timezone={timezone} />;
    return <PlayView exerciseId={exerciseId} s={s} timezone={timezone} isGuest={false} inShell />;
  }

  if (!viewer.isControl) return <PlayView exerciseId={exerciseId} s={s} timezone={timezone} isGuest={false} inShell />;
  return <EndedSummary exerciseId={exerciseId} s={s} timezone={timezone} />;
}

export function ExerciseRoom({ exerciseId, timezone }: { exerciseId: string; timezone: string }) {
  return (
    <ConfirmDialogProvider>
      <Room exerciseId={exerciseId} timezone={timezone} />
    </ConfirmDialogProvider>
  );
}

export function PlayRoom({ exerciseId, timezone, isGuest }: { exerciseId: string; timezone: string; isGuest: boolean }) {
  return (
    <ConfirmDialogProvider>
      <PlayRoomInner exerciseId={exerciseId} timezone={timezone} isGuest={isGuest} />
    </ConfirmDialogProvider>
  );
}

function PlayRoomInner({ exerciseId, timezone, isGuest }: { exerciseId: string; timezone: string; isGuest: boolean }) {
  const s = useExerciseState(exerciseId, { guest: true });
  if (!s.state) {
    if (s.error) return <p role="alert" className="py-10 text-center text-[13px] text-[color:var(--mist-danger)]">{s.error}</p>;
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[color:var(--color-muted-foreground)]" />
      </div>
    );
  }
  return <PlayView exerciseId={exerciseId} s={s} timezone={timezone} isGuest={isGuest} />;
}
