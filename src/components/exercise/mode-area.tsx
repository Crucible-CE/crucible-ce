"use client";

import { useCallback } from "react";
import { MODE_UI, type ModeViewProps } from "@/lib/exercise/modes/ui";
import type { ResponseKind } from "@/lib/exercise/runtime/types";
import { api } from "./api";
import type { ExerciseState } from "./types";

/** respond() and act() for a mode view. act() is for drivers only. */
export function useModeActions(exerciseId: string, refresh: () => void) {
  const respond = useCallback(
    async (injectId: string, kind: ResponseKind, data: unknown) => {
      const r = await api(`/api/play/${exerciseId}/respond`, { body: { injectId, kind, data }, fallback: "Your response was not saved. Try again." });
      refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [exerciseId, refresh],
  );
  const act = useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      const r = await api(`/api/exercises/${exerciseId}/control`, { body: { ...body, action }, fallback: "That did not work. Try again." });
      refresh();
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [exerciseId, refresh],
  );
  return { respond, act };
}

export function ModeArea({
  view,
  exerciseId,
  state,
  isGuest,
  refresh,
}: {
  view: "PlayerView" | "ControlView" | "DebriefView";
  exerciseId: string;
  state: ExerciseState;
  isGuest: boolean;
  refresh: () => void;
}) {
  const { respond, act } = useModeActions(exerciseId, refresh);
  const ui = MODE_UI[state.exercise.mode];
  const View = ui?.[view];
  if (!View) {
    if (view === "DebriefView") return null;
    return <p className="py-10 text-center text-[13px] text-[color:var(--color-muted-foreground)]">This exercise type cannot be shown yet.</p>;
  }
  const props: ModeViewProps = { exerciseId, state, isGuest, respond, act, refresh };
  return <View {...props} />;
}
