// Socket side effects for lifecycle routes. All no-ops without a socket server
// (tests, build). Call after the transaction commits.

import { getIO, disconnectParticipant, SOCKET_EVENTS, SOCKET_NAMESPACE, emitToExercise } from "@/lib/exercise/socket/emit";
import { participantRoom } from "@/lib/exercise/socket/events";
import type { EmitScope } from "@/lib/exercise/socket/events";

/** Tell a removed participant's sockets they lost access, then disconnect them. */
export function revokeParticipantSockets(exerciseId: string, participantId: string): void {
  try {
    getIO()?.of(SOCKET_NAMESPACE).to(participantRoom(participantId)).emit(SOCKET_EVENTS.ACCESS_REVOKED, { exerciseId });
  } catch (err) {
    console.error(`[exercises] access revoked emit failed for ${participantId}:`, err);
  }
  disconnectParticipant(participantId);
}

/** A thin chat notice: clients refetch the chat list. */
export function notifyChat(exerciseId: string, scope: EmitScope, channel: string): void {
  emitToExercise(exerciseId, scope, SOCKET_EVENTS.CHAT_MESSAGE, { exerciseId, channel });
}
