// Socket helpers for route handlers and the runtime: emits, disconnects and the
// room authorizer. No socket.io runtime import.

export { SOCKET_EVENTS, SOCKET_CLIENT_EVENTS, SOCKET_NAMESPACE } from "./events";
export type { EmitScope } from "./events";
export { emitToExercise, disconnectParticipant, disconnectUserSockets } from "./evict";
export { setRoomAuthorizer, type RoomAuthorizer, type RoomGrant, type SocketPrincipal } from "./access";
export { getRegisteredIO as getIO } from "./evict";
