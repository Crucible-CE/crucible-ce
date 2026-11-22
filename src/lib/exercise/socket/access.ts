// Room access for the /ex namespace. No socket.io runtime import, so route
// handlers and tests can use it.
//
// The runtime registers the real authorizer (participant lookup) with
// setRoomAuthorizer(). Until then every join is denied.
//
// The authorizer says which rooms a principal may join for one exercise.
// decideRooms() turns that grant into room names and applies the rules that
// hold no matter what the authorizer says:
//   - a guest only ever joins rooms of the exercise its cookie belongs to;
//   - a guest never joins the control room.

import { exerciseRoom, participantRoom } from "./events";

export type SocketPrincipal =
  | { kind: "user"; userId: string; role: string; name?: string }
  | { kind: "guest"; exerciseId: string; participantId: string };

export interface RoomGrant {
  /** ex:{id}:all */
  all: boolean;
  /** ex:{id}:control (facilitator, controller, evaluator). Ignored for guests. */
  control?: boolean;
  /** ex:{id}:team:{teamId} for each id. */
  teamIds?: string[];
  /** The principal's participant in this exercise, for eviction. */
  participantId?: string | null;
}

/** Returns the grant, or null to deny. May throw; a throw denies. */
export type RoomAuthorizer = (principal: SocketPrincipal, exerciseId: string) => Promise<RoomGrant | null>;

const denyAll: RoomAuthorizer = async () => null;

const KEY = Symbol.for("crucible.ce.exercise.roomAuthorizer");
type Holder = { [KEY]?: RoomAuthorizer };

/** Register the room authorizer. Replaces any previous one. */
export function setRoomAuthorizer(fn: RoomAuthorizer | null): void {
  const g = globalThis as Holder;
  if (fn) g[KEY] = fn;
  else delete g[KEY];
}

export function getRoomAuthorizer(): RoomAuthorizer {
  return (globalThis as Holder)[KEY] ?? denyAll;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Shape check for an exercise id coming from a client payload. */
export function isValidExerciseId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

/** Room names for a grant, with the guest rules applied. Empty = deny. */
export function decideRooms(principal: SocketPrincipal, exerciseId: string, grant: RoomGrant | null): string[] {
  if (!grant) return [];
  if (principal.kind === "guest" && principal.exerciseId !== exerciseId) return [];
  const rooms: string[] = [];
  if (grant.all) rooms.push(exerciseRoom(exerciseId, "all"));
  if (grant.control && principal.kind === "user") rooms.push(exerciseRoom(exerciseId, "control"));
  for (const teamId of grant.teamIds ?? []) {
    if (ID_RE.test(teamId)) rooms.push(exerciseRoom(exerciseId, { teamId }));
  }
  const participantId = principal.kind === "guest" ? principal.participantId : grant.participantId;
  if (rooms.length > 0 && participantId) rooms.push(participantRoom(participantId));
  return rooms;
}

/** Run the registered authorizer and decide. Never throws; errors deny. */
export async function authorizeRooms(principal: SocketPrincipal, exerciseId: string): Promise<string[]> {
  if (!isValidExerciseId(exerciseId)) return [];
  try {
    const grant = await getRoomAuthorizer()(principal, exerciseId);
    return decideRooms(principal, exerciseId, grant);
  } catch (err) {
    console.error(`[socket] room authorizer failed for exercise ${exerciseId}:`, err instanceof Error ? err.message : err);
    return [];
  }
}
