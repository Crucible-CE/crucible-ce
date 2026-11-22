// =============================================================================
// Crucible CE — Socket.io transports
// =============================================================================
// One list, shared by the server (src/lib/socket/server.ts) and the browser
// client (src/lib/socket/client.ts), so the two can never disagree: websocket
// first, long-polling as the fallback for networks that block websockets.
// CE runs as a single process, so polling needs no session affinity.
// =============================================================================

export type SocketTransport = "websocket" | "polling";

export const SOCKET_TRANSPORTS: SocketTransport[] = ["websocket", "polling"];
