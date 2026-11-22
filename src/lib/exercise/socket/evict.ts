// Emits and evictions callable from route handlers.
//
// Route handlers reach the Socket.io server through globalThis (the custom
// server and the Next bundle share the process, not the module registry).
// When no server is registered (unit tests, `next build`) every helper is a
// no-op. None of them throws: a socket failure never fails the HTTP request.
// Emit after the transaction commits.

import type { Server as SocketIOServer } from "socket.io";
import {
  SOCKET_NAMESPACE,
  exerciseRoom,
  participantRoom,
  userRoom,
  type EmitScope,
} from "./events";

const IO_KEY = "__ceExerciseIo";
type IoHolder = { [IO_KEY]?: SocketIOServer };

export function registerIO(io: SocketIOServer | null): void {
  const g = globalThis as IoHolder;
  if (io) g[IO_KEY] = io;
  else delete g[IO_KEY];
}

export function getRegisteredIO(): SocketIOServer | null {
  return (globalThis as IoHolder)[IO_KEY] ?? null;
}

/** Emit to one exercise room: everyone, the control room, or one team. */
export function emitToExercise(exerciseId: string, scope: EmitScope, event: string, payload: unknown): void {
  try {
    const io = getRegisteredIO();
    if (!io) return;
    io.of(SOCKET_NAMESPACE).to(exerciseRoom(exerciseId, scope)).emit(event, payload);
  } catch (err) {
    console.error(`[socket] emit ${event} to exercise ${exerciseId} failed:`, err);
  }
}

/** Disconnect every socket of a participant (removed from the exercise). */
export function disconnectParticipant(participantId: string): void {
  try {
    const io = getRegisteredIO();
    if (!io) return;
    io.of(SOCKET_NAMESPACE).in(participantRoom(participantId)).disconnectSockets(true);
  } catch (err) {
    console.error(`[socket] disconnect participant ${participantId} failed:`, err);
  }
}

/** Disconnect every socket of a user (sign-out, deactivation, role change). */
export function disconnectUserSockets(userId: string): void {
  try {
    const io = getRegisteredIO();
    if (!io) return;
    io.of(SOCKET_NAMESPACE).in(userRoom(userId)).disconnectSockets(true);
  } catch (err) {
    console.error(`[socket] disconnect user ${userId} failed:`, err);
  }
}
