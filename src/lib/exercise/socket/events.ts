// Socket event names and payloads. Importable by server and client code.
// Events are thin: `exercise:changed` tells the client to refetch through the
// REST route that calls mode.project(). Chat may carry the message body.

export const SOCKET_NAMESPACE = "/ex";

export const SOCKET_EVENTS = {
  /** Exercise state changed. Payload: { exerciseId, stateVersion, scope }. Refetch. */
  EXERCISE_CHANGED: "exercise:changed",
  /** A chat message was posted. */
  CHAT_MESSAGE: "chat:message",
  /** Someone connected or disconnected. */
  PRESENCE: "presence",
  /** Sent to one socket that just lost access to an exercise; the server already removed it from the rooms. */
  ACCESS_REVOKED: "exercise:access_revoked",
  /** Server acknowledgement of join_exercise. */
  JOINED: "exercise:joined",
} as const;

/** Client to server events. */
export const SOCKET_CLIENT_EVENTS = {
  JOIN_EXERCISE: "join_exercise",
  LEAVE_EXERCISE: "leave_exercise",
} as const;

/** @public */
export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

export type EmitScope = "all" | "control" | { teamId: string };

/** @public */
export interface ExerciseChangedPayload {
  exerciseId: string;
  stateVersion: number;
  scope?: string;
}

/** @public */
export interface AccessRevokedPayload {
  exerciseId: string;
}

export interface JoinedPayload {
  exerciseId: string;
  rooms: string[];
}

/** @public */
export interface PresencePayload {
  exerciseId: string;
  participantId: string | null;
  online: boolean;
}

// ---------------------------------------------------------------------------
// Room names
// ---------------------------------------------------------------------------

export function exerciseRoom(exerciseId: string, scope: EmitScope): string {
  if (scope === "all") return `ex:${exerciseId}:all`;
  if (scope === "control") return `ex:${exerciseId}:control`;
  return `ex:${exerciseId}:team:${scope.teamId}`;
}

/** Every socket of one participant (for eviction). */
export function participantRoom(participantId: string): string {
  return `participant:${participantId}`;
}

/** Every socket of one signed-in user (for revocation). */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function isExerciseRoom(room: string, exerciseId: string): boolean {
  return room.startsWith(`ex:${exerciseId}:`);
}
