"use client";

// Live exercise state for one viewer.
//
//   const { state, refresh, tick, chatTick } = useExerciseState(exerciseId, { guest });
//
// Fetches projectFor output from /api/play/{id}/state (guests) or
// /api/exercises/{id}/state (signed-in users), joins the exercise's socket
// rooms, refetches on exercise:changed (debounced), drops stale responses by
// stateVersion, and polls every 15 s as a fallback. Losing access (socket
// eviction, 401 or 403) sends a guest to /join and a user to /exercises.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SOCKET_EVENTS, useExerciseSocket } from "@/lib/exercise/socket/client";
import type { ExerciseState } from "./types";

const DEBOUNCE_MS = 150;
const POLL_MS = 15_000;

export interface UseExerciseState {
  state: ExerciseState | null;
  error: string | null;
  loading: boolean;
  connected: boolean;
  /** Server time minus client time, in ms, from the last fetch. */
  serverOffsetMs: number;
  /** Increments on every exercise change notice (panels refetch their own data on it). */
  tick: number;
  /** Increments on every chat notice. */
  chatTick: number;
  refresh: () => void;
}

export function useExerciseState(exerciseId: string, opts: { guest?: boolean } = {}): UseExerciseState {
  const guest = Boolean(opts.guest);
  const router = useRouter();
  const url = guest ? `/api/play/${exerciseId}/state` : `/api/exercises/${exerciseId}/state`;

  const [state, setState] = useState<ExerciseState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);
  const [chatTick, setChatTick] = useState(0);

  const versionRef = useRef(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goneRef = useRef(false);

  const lostAccess = useCallback(() => {
    if (goneRef.current) return;
    goneRef.current = true;
    router.replace(guest ? "/join" : "/exercises");
  }, [guest, router]);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setError("You no longer have access to this exercise.");
        lostAccess();
        return;
      }
      const data = (await res.json().catch(() => null)) as (ExerciseState & { error?: string }) | null;
      if (!res.ok || !data?.exercise) {
        setError(data?.error ?? "The exercise did not load. Reload the page to try again.");
        return;
      }
      // A slower, older response must not overwrite a newer one.
      if (data.exercise.stateVersion < versionRef.current) return;
      versionRef.current = data.exercise.stateVersion;
      setServerOffsetMs(Date.parse(data.now) - Date.now());
      setState(data);
      setError(null);
    } catch {
      setError("Lost the connection. Retrying.");
    } finally {
      setLoading(false);
    }
  }, [url, lostAccess]);

  const refresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void fetchState();
    }, DEBOUNCE_MS);
  }, [fetchState]);

  const onEvent = useCallback(
    (event: string, payload: unknown) => {
      const p = (payload ?? {}) as { exerciseId?: string; stateVersion?: number | null };
      if (p.exerciseId && p.exerciseId !== exerciseId) return;
      if (event === SOCKET_EVENTS.EXERCISE_CHANGED) {
        setTick((t) => t + 1);
        // A notice for a version already on screen needs no refetch.
        if (typeof p.stateVersion === "number" && p.stateVersion <= versionRef.current) return;
        refresh();
      } else if (event === SOCKET_EVENTS.CHAT_MESSAGE) {
        setChatTick((t) => t + 1);
      } else if (event === SOCKET_EVENTS.ACCESS_REVOKED) {
        // Ended exercises evict sockets but stay readable; the fetch decides.
        void fetchState();
      }
    },
    [exerciseId, refresh, fetchState],
  );

  const { connected } = useExerciseSocket(exerciseId, onEvent);

  useEffect(() => {
    void fetchState();
    const poll = setInterval(() => void fetchState(), POLL_MS);
    return () => {
      clearInterval(poll);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchState]);

  // Refetch after a reconnect: events may have been missed.
  useEffect(() => {
    if (connected) refresh();
  }, [connected, refresh]);

  return { state, error, loading, connected, serverOffsetMs, tick, chatTick, refresh };
}
