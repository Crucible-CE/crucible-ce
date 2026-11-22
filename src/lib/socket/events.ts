// =============================================================================
// Crucible CE - Socket.io Shared Event Definitions
// =============================================================================
// Shared constants and TypeScript payload interfaces for real-time WebSocket
// events. Importable by both server and client code without pulling in
// server-only dependencies.
// =============================================================================

/**
 * Canonical event name strings used across all Socket.io communication.
 * Always reference these constants instead of raw strings to avoid typos
 * and enable easy refactoring.
 */
export const SOCKET_EVENTS = {
  /** A new notification has been delivered to a user */
  NOTIFICATION_NEW: "notification:new",
  /** A war-room chat message has been posted to an incident */
  CHAT_MESSAGE: "chat:message",
  /** Sent to ONE war-room socket that just lost access to an incident (removed
   *  from a locked incident's allowlist, or the incident was locked). The
   *  server has already removed it from the room. */
  INCIDENT_ACCESS_REVOKED: "incident:access_revoked",
} as const;

// ---------------------------------------------------------------------------
// Event Payloads
// ---------------------------------------------------------------------------

/** Payload emitted when a new notification is delivered to a user */
export interface NotificationPayload {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string | Date;
}

/** Payload emitted when a war-room chat message is posted */
export interface ChatMessagePayload {
  incidentId: string;
  id: string;
  userId: string;
  userName: string;
  message: string;
  createdAt: string;
}

/** Payload of {@link SOCKET_EVENTS.INCIDENT_ACCESS_REVOKED} */
export interface IncidentAccessRevokedPayload {
  incidentId: string;
}

// ---------------------------------------------------------------------------
// Aggregate map (useful for generic emit helpers)
// ---------------------------------------------------------------------------

/** Maps every event name to its corresponding payload type */
export interface SocketEventPayloadMap {
  [SOCKET_EVENTS.NOTIFICATION_NEW]: NotificationPayload;
  [SOCKET_EVENTS.CHAT_MESSAGE]: ChatMessagePayload;
  [SOCKET_EVENTS.INCIDENT_ACCESS_REVOKED]: IncidentAccessRevokedPayload;
}
