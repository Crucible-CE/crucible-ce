// =============================================================================
// /ex namespace for exercises, on CE's one Socket.io server.
//
//   - CE's initSocketServer (src/lib/socket/server.ts) calls
//     setupExerciseNamespace(io) and registerIO(io). Origin is checked there,
//     in allowRequest, for every engine.io request.
//   - Handshake: a CE session (re-validated against the DB by
//     resolveSocketAuthContext: active user, current tokenVersion, two-factor
//     wall) or a guest cookie (validated against GuestSession).
//   - join_exercise {exerciseId}: the registered room authorizer decides
//     (./access; default denies). Checked on every join.
//   - All state lives in Postgres; sockets only notify. Clients refetch.
// =============================================================================

import type { Server as SocketIOServer, Socket } from "socket.io";
import { resolveGuestCookieValue } from "@/lib/exercise/auth/guest-core";
import { readGuestCookie } from "@/lib/exercise/auth/guest-cookie";
import { exerciseRoleFor } from "@/lib/exercise/auth/rbac";
import { authorizeRooms, isValidExerciseId, type SocketPrincipal } from "./access";
import { SOCKET_CLIENT_EVENTS, SOCKET_EVENTS, SOCKET_NAMESPACE, isExerciseRoom, userRoom, type JoinedPayload } from "./events";

export { SOCKET_EVENTS, SOCKET_CLIENT_EVENTS, SOCKET_NAMESPACE } from "./events";
export type { EmitScope } from "./events";
export { emitToExercise, disconnectParticipant, disconnectUserSockets, registerIO } from "./evict";
export { setRoomAuthorizer, type RoomAuthorizer, type RoomGrant, type SocketPrincipal } from "./access";

type SocketWithPrincipal = Socket & { data: { principal?: SocketPrincipal } };

/** The signed-in user behind a handshake (CE resolveSocketAuthContext), or null. */
export type SocketUserResolver = (socket: Socket) => Promise<{ userId: string; role?: string; name?: string } | null>;

/** Authenticate a handshake: a signed-in user first, else a guest. Null = refuse. */
export async function resolveSocketPrincipal(socket: Socket, resolveUser: SocketUserResolver): Promise<SocketPrincipal | null> {
  const user = await resolveUser(socket);
  if (user) {
    const role = exerciseRoleFor(user.role);
    if (!role) return null;
    return { kind: "user", userId: user.userId, role, name: user.name };
  }
  const rawCookie = socket.request.headers.cookie;
  const cookieHeader = Array.isArray(rawCookie) ? rawCookie.join("; ") : rawCookie;
  const guest = await resolveGuestCookieValue(readGuestCookie(cookieHeader));
  if (guest) return { kind: "guest", exerciseId: guest.exerciseId, participantId: guest.participantId };
  return null;
}

/** Add the /ex namespace to CE's Socket.io server. */
export function setupExerciseNamespace(io: SocketIOServer, resolveUser: SocketUserResolver): void {
  const ns = io.of(SOCKET_NAMESPACE);

  ns.use(async (socket, next) => {
    try {
      const principal = await resolveSocketPrincipal(socket, resolveUser);
      if (!principal) return next(new Error("Unauthorized"));
      (socket as SocketWithPrincipal).data.principal = principal;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  ns.on("connection", (socket: SocketWithPrincipal) => {
    const principal = socket.data.principal;
    if (!principal) {
      socket.disconnect(true);
      return;
    }
    if (principal.kind === "user") socket.join(userRoom(principal.userId));

    socket.on(SOCKET_CLIENT_EVENTS.JOIN_EXERCISE, async (payload: unknown, ack?: unknown) => {
      const exerciseId = (payload as { exerciseId?: unknown } | null)?.exerciseId;
      const reply = typeof ack === "function" ? (ack as (r: unknown) => void) : null;
      if (!isValidExerciseId(exerciseId)) {
        reply?.({ ok: false });
        return;
      }
      const rooms = await authorizeRooms(principal, exerciseId);
      if (rooms.length === 0) {
        reply?.({ ok: false });
        return;
      }
      // Drop rooms from an earlier join of the same exercise so a narrowed
      // grant (team change, demotion) takes effect.
      for (const room of socket.rooms) if (isExerciseRoom(room, exerciseId)) socket.leave(room);
      await socket.join(rooms);
      const joined: JoinedPayload = { exerciseId, rooms: rooms.filter((r) => isExerciseRoom(r, exerciseId)) };
      reply?.({ ok: true, ...joined });
      socket.emit(SOCKET_EVENTS.JOINED, joined);
    });

    socket.on(SOCKET_CLIENT_EVENTS.LEAVE_EXERCISE, (payload: unknown) => {
      const exerciseId = (payload as { exerciseId?: unknown } | null)?.exerciseId;
      if (!isValidExerciseId(exerciseId)) return;
      for (const room of socket.rooms) if (isExerciseRoom(room, exerciseId)) socket.leave(room);
    });
  });
}
