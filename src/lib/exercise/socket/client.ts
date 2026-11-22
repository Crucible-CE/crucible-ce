"use client";

// Browser hook for the /ex namespace. Production serves Socket.io on the app
// origin. In development the socket sidecar runs on NEXT_PUBLIC_SOCKET_URL.
//
//   const { connected } = useExerciseSocket(exerciseId, (event, payload) => {
//     if (event === SOCKET_EVENTS.EXERCISE_CHANGED) refetch();
//   });
//
// The hook joins the exercise on every (re)connect. Auth rides on the session
// or guest cookie; nothing secret is sent in the handshake.

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SOCKET_TRANSPORTS } from "@/lib/socket/transports";
import { SOCKET_CLIENT_EVENTS, SOCKET_NAMESPACE } from "./events";

function socketBase(): string {
  const configured = process.env.NEXT_PUBLIC_SOCKET_URL?.trim().replace(/\/+$/, "");
  if (configured && process.env.NODE_ENV !== "production") return configured;
  return window.location.origin;
}

export { SOCKET_EVENTS } from "./events";

export type ExerciseSocketHandler = (event: string, payload: unknown) => void;

export interface UseExerciseSocket {
  connected: boolean;
  /** True once the server accepted join_exercise for this exercise. */
  joined: boolean;
}

export function useExerciseSocket(exerciseId: string | null | undefined, onEvent: ExerciseSocketHandler): UseExerciseSocket {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!exerciseId || typeof window === "undefined") return;
    const socket: Socket = io(`${socketBase()}${SOCKET_NAMESPACE}`, {
      transports: SOCKET_TRANSPORTS,
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    const join = () => {
      socket.emit(SOCKET_CLIENT_EVENTS.JOIN_EXERCISE, { exerciseId }, (res: { ok?: boolean } | undefined) => {
        setJoined(!!res?.ok);
      });
    };

    socket.on("connect", () => {
      setConnected(true);
      join();
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setJoined(false);
    });
    socket.onAny((event: string, payload: unknown) => {
      handlerRef.current(event, payload);
    });

    return () => {
      socket.emit(SOCKET_CLIENT_EVENTS.LEAVE_EXERCISE, { exerciseId });
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [exerciseId]);

  return { connected, joined };
}
