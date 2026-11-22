"use client";

// =============================================================================
// Crucible CE - Client-side Socket.io Hook
// =============================================================================
// React hook that manages a Socket.io connection to the `/war-room`
// namespace. Designed for use inside Next.js client components.
//
// Usage:
//   const { socket, isConnected } = useSocket(incidentId);
//
//   useEffect(() => {
//     if (!socket) return;
//     socket.on(SOCKET_EVENTS.CHAT_MESSAGE, (payload) => { ... });
//     return () => { socket.off(SOCKET_EVENTS.CHAT_MESSAGE); };
//   }, [socket]);
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { SOCKET_EVENTS, type IncidentAccessRevokedPayload } from "./events";
import { SOCKET_TRANSPORTS } from "./transports";

// Re-export the shared event constants so client components can import
// everything they need from one module without touching server code.
export { SOCKET_EVENTS } from "./events";
export type {
  NotificationPayload,
  ChatMessagePayload,
  IncidentAccessRevokedPayload,
} from "./events";

const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1"]);

// How long we wait per candidate URL when probing for a reachable Socket.io
// server. Shorter than the Next.js dev-server boot lag but long enough to
// tolerate a TCP retransmit on a flaky network.
const SOCKET_PROBE_TIMEOUT_MS = 800;

function normalizeSocketUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function getSocketCandidateUrls(): string[] {
  const candidates: string[] = [];

  const pushCandidate = (value: string | undefined): void => {
    if (!value) return;
    const normalized = normalizeSocketUrl(value.trim());
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(process.env.NEXT_PUBLIC_SOCKET_URL);

  if (typeof window !== "undefined") {
    pushCandidate(window.location.origin);

    if (
      process.env.NODE_ENV === "development" &&
      LOCALHOST_NAMES.has(window.location.hostname)
    ) {
      pushCandidate(`${window.location.protocol}//${window.location.hostname}:3001`);
    }
  }

  pushCandidate(process.env.NEXT_PUBLIC_APP_URL);

  if (process.env.NODE_ENV === "development") {
    pushCandidate("http://localhost:3001");
  }

  return candidates;
}

// Transports come from ./transports, the same list the server uses.
const POLLING_ENABLED = SOCKET_TRANSPORTS.includes("polling");

async function isSocketServerReachable(baseUrl: string): Promise<boolean> {
  if (typeof window === "undefined") return true;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), SOCKET_PROBE_TIMEOUT_MS);

  try {
    const probeUrl = `${baseUrl}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`;
    const response = await fetch(probeUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });

    if (response.ok) return true;

    // Websocket-only deployments answer this polling probe with HTTP 400
    // `{"code":0,"message":"Transport unknown"}` — which still PROVES a
    // Socket.io server is listening at this origin (a wrong origin 404s in
    // Next.js). Without this, websocket-only prod would find no reachable
    // candidate and never connect at all.
    return !POLLING_ENABLED && response.status === 400;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function selectSocketUrlForConnection(): Promise<string | null> {
  const candidates = getSocketCandidateUrls();
  if (candidates.length === 0) return null;

  // Probe all candidates in order so a misconfigured NEXT_PUBLIC_SOCKET_URL
  // (e.g. the prod URL accidentally set in a dev environment) falls
  // back to window.location.origin rather than staying permanently offline.
  for (const candidate of candidates) {
    if (await isSocketServerReachable(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseSocketReturn {
  /** The raw Socket.io client instance, or `null` while connecting. */
  socket: Socket | null;
  /** `true` once the WebSocket handshake is complete. */
  isConnected: boolean;
}

/**
 * Connect to the `/war-room` namespace for an incident war room. Sends
 * `incidentId` as a handshake query param so the server auto-joins the
 * `incident:{id}` room. Mirrors {@link useSocket}.
 */
export function useIncidentSocket(incidentId: string): UseSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!incidentId) return;
    let cancelled = false;

    const connect = async () => {
      const url = await selectSocketUrlForConnection();
      if (!url || cancelled) {
        if (!url) {
          console.info(
            "[useIncidentSocket] No reachable Socket.io server found. " +
              "In local dev, run `npm run dev:ws`."
          );
        }
        return;
      }

      const socket = io(`${url}/war-room`, {
        query: { incidentId },
        transports: SOCKET_TRANSPORTS,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        withCredentials: true,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        // Re-assert room membership on every (re)connect.
        socket.emit("join-incident", { incidentId });
        setIsConnected(true);
      });
      socket.on("disconnect", (reason) => {
        setIsConnected(false);
        // A server-side disconnect (admin role change / revocation, Redis
        // adapter swap) does not auto-reconnect. Retry once: a still-valid
        // session is re-authenticated with its current role; a revoked one is
        // rejected at the handshake and stays offline.
        if (reason === "io server disconnect" && !cancelled) socket.connect();
      });
      socket.on("connect_error", (err) =>
        console.warn("[useIncidentSocket] Connection error:", err.message),
      );
      // The server removed us from the war room (unlocked → locked, or we were
      // taken off the allowlist). Stop listening and leave the incident page.
      socket.on(SOCKET_EVENTS.INCIDENT_ACCESS_REVOKED, (payload: IncidentAccessRevokedPayload) => {
        if (payload?.incidentId && payload.incidentId !== incidentId) return;
        cancelled = true;
        socket.removeAllListeners();
        socket.disconnect();
        setIsConnected(false);
        toast.error("You no longer have access to this incident.");
        routerRef.current.push("/incidents");
      });
    };

    void connect();

    return () => {
      cancelled = true;
      if (!socketRef.current) {
        setIsConnected(false);
        return;
      }
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [incidentId]);

  return { socket: socketRef.current, isConnected };
}

// ---------------------------------------------------------------------------
// Notification Hook (shared singleton)
// ---------------------------------------------------------------------------

import type { NotificationPayload } from "./events";

export type NotificationSocketStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected";

interface UseNotificationSocketReturn {
  /** `true` once the WebSocket handshake is complete. */
  isConnected: boolean;
  /** Detailed connection state, including pre-handshake "connecting". */
  status: NotificationSocketStatus;
}

// Module-level singleton — exactly one client-side Socket.io init per runtime.
let _notifSocket: Socket | null = null;
let _notifUserId: string | null = null;
let _notifStatus: NotificationSocketStatus = "idle";
let _notifRefCount = 0;

const _notificationListeners = new Set<(n: NotificationPayload) => void>();
const _statusListeners = new Set<(s: NotificationSocketStatus) => void>();

function setNotifStatus(next: NotificationSocketStatus) {
  if (_notifStatus === next) return;
  _notifStatus = next;
  _statusListeners.forEach((l) => l(next));
}

async function ensureNotifSocket(userId: string): Promise<void> {
  if (_notifSocket && _notifUserId === userId) return;

  if (_notifSocket) {
    _notifSocket.removeAllListeners();
    _notifSocket.disconnect();
    _notifSocket = null;
  }

  _notifUserId = userId;
  setNotifStatus("connecting");

  const url = await selectSocketUrlForConnection();

  if (!url) {
    console.info(
      "[useNotificationSocket] No reachable Socket.io server found. " +
        "In local dev, use `npm run dev:full` (Turbopack Next.js on :3000 + Socket.io sidecar on :3001). " +
        "When deployed, the custom server boots via `prod:start` and is reachable at the page origin."
    );
    // In development we treat "no Socket.io listening at all" as `idle`
    // (hide the dot) rather than `disconnected` (red alarm). When the dev
    // runs plain `npm run dev` instead of `dev:ws`, Socket.io is genuinely
    // not configured for that process — surfacing a red error is misleading.
    // In production, the absence of a reachable server is a real problem, so
    // we keep the loud `disconnected` signal.
    setNotifStatus(process.env.NODE_ENV === "production" ? "disconnected" : "idle");
    return;
  }

  // Bail if userId changed during URL discovery.
  if (_notifUserId !== userId) return;

  const notificationSocket = io(url, {
    transports: SOCKET_TRANSPORTS,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    withCredentials: true,
  });

  _notifSocket = notificationSocket;

  notificationSocket.on("connect", () => {
    console.log(
      `[useNotificationSocket] Connected (id: ${notificationSocket.id}, user: ${userId})`
    );
    setNotifStatus("connected");
    notificationSocket.emit("join:notifications", { userId });
  });

  notificationSocket.on("disconnect", (reason) => {
    console.log(
      `[useNotificationSocket] Disconnected (reason: ${reason})`
    );
    setNotifStatus("disconnected");
    // Server-side disconnects don't auto-reconnect; retry once so a role
    // change re-authenticates (a revoked session is rejected at handshake).
    if (reason === "io server disconnect" && _notifSocket === notificationSocket) {
      notificationSocket.connect();
    }
  });

  notificationSocket.on("connect_error", (err) => {
    console.warn("[useNotificationSocket] Connection error:", err.message);
    setNotifStatus("disconnected");
  });

  notificationSocket.on(
    SOCKET_EVENTS.NOTIFICATION_NEW,
    (notification: NotificationPayload) => {
      _notificationListeners.forEach((l) => l(notification));
    }
  );
}

function teardownNotifSocket() {
  if (!_notifSocket) {
    setNotifStatus("idle");
    _notifUserId = null;
    return;
  }
  console.log(
    `[useNotificationSocket] Cleaning up socket for user ${_notifUserId}`
  );
  _notifSocket.removeAllListeners();
  _notifSocket.disconnect();
  _notifSocket = null;
  _notifUserId = null;
  setNotifStatus("idle");
}

/**
 * Subscribe to real-time notifications for the given user.
 *
 * Backed by a module-level singleton: multiple components calling this hook
 * share one underlying Socket.io connection. The socket is torn down only
 * when the last consumer unmounts.
 */
export function useNotificationSocket(
  userId: string,
  onNotification: (notification: NotificationPayload) => void
): UseNotificationSocketReturn {
  const [status, setStatus] = useState<NotificationSocketStatus>(_notifStatus);
  const callbackRef = useRef(onNotification);

  useEffect(() => {
    callbackRef.current = onNotification;
  }, [onNotification]);

  useEffect(() => {
    if (!userId) return;

    const notifWrapper = (n: NotificationPayload) => callbackRef.current(n);
    const statusWrapper = (s: NotificationSocketStatus) => setStatus(s);

    _notificationListeners.add(notifWrapper);
    _statusListeners.add(statusWrapper);
    setStatus(_notifStatus);

    _notifRefCount += 1;
    void ensureNotifSocket(userId);

    return () => {
      _notificationListeners.delete(notifWrapper);
      _statusListeners.delete(statusWrapper);
      _notifRefCount -= 1;
      if (_notifRefCount <= 0) {
        _notifRefCount = 0;
        teardownNotifSocket();
      }
    };
  }, [userId]);

  return { isConnected: status === "connected", status };
}

/**
 * Observe-only counterpart to `useNotificationSocket`. Subscribes to status
 * changes on the shared notification socket without opening a new connection.
 * Returns "idle" until another component (e.g. NotificationBell) initializes.
 */
export function useNotificationSocketStatus(): NotificationSocketStatus {
  const [status, setStatus] = useState<NotificationSocketStatus>(_notifStatus);

  useEffect(() => {
    const handler = (s: NotificationSocketStatus) => setStatus(s);
    _statusListeners.add(handler);
    setStatus(_notifStatus);
    return () => {
      _statusListeners.delete(handler);
    };
  }, []);

  return status;
}
