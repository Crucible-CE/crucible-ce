// =============================================================================
// Crucible CE - Socket.io Server Singleton
// =============================================================================
// Initialises and exports a Socket.io Server instance designed to run inside
// Next.js custom-server or API-route contexts. Uses the `/war-room`
// namespace for all incident war-room communication.
//
// Architecture notes:
//   - The singleton pattern (`io` variable) ensures we never create duplicate
//     Socket.io servers during Next.js hot-reloads in development.
//   - All state lives in PostgreSQL (server-authoritative). Socket.io is a
//     notification bus only -- clients always reconcile against DB state.
// =============================================================================

import { WALL_SELECT, wallsFromRow } from "@/lib/auth/mfa/state";
import { Server as HTTPServer } from "http";
import { Server as SocketIOServer, Namespace, Socket } from "socket.io";
import { getToken } from "next-auth/jwt";
import { db } from "@/lib/db";
import { canAccessIncident } from "./access";
import { userSessionRoom } from "./evict";
import { SOCKET_TRANSPORTS } from "./transports";
import { registerIO as registerExerciseIO, setupExerciseNamespace } from "@/lib/exercise/socket/server";
import {
  appOrigins,
  configuredAppOrigins,
  originOf,
  parseOriginList,
  sameHostOrigin,
} from "@/lib/security/origins";
export { SOCKET_EVENTS } from "./events";
export { canAccessIncident } from "./access";

interface SocketAuthContext {
  userId: string;
  organizationId?: string;
  role?: string;
  // Display identity comes from the JWT, never the client payload — so a
  // relayed typing/presence event can't be spoofed with someone else's name.
  name?: string;
}

type SocketWithAuth = Socket & {
  data: {
    auth?: SocketAuthContext;
  };
};

const SECURE_SESSION_COOKIE = "__Secure-authjs.session-token";
const PLAIN_SESSION_COOKIE = "authjs.session-token";

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  // A proxy chain may send "https, http" — the left-most value is the client hop.
  const first = v?.split(",")[0]?.trim().toLowerCase();
  return first ? first : undefined;
}

/**
 * Decide which Auth.js session cookie name to read on a Socket.io handshake.
 *
 * NextAuth v5's `getToken` auto-detects `secureCookie` from `req.url`, but in
 * a handshake `socket.request.url` is only the path (`/socket.io/?…`), so the
 * auto-detect always says "insecure". We derive it from the actual scheme —
 * never NODE_ENV: a production build served over plain HTTP (a LAN install,
 * `docker compose up` on localhost) uses the unprefixed cookie, and pinning
 * `secure` there leaves realtime permanently offline.
 *
 *   1. `x-forwarded-proto` from a TLS-terminating proxy, when present;
 *   2. otherwise the connection itself being TLS;
 *   3. otherwise the scheme of AUTH_URL / NEXTAUTH_URL.
 *
 * If the browser sent only the *other* cookie name (Auth.js keys the cookie
 * off AUTH_URL when it is set, which can disagree with the proxy header), we
 * follow the cookie that actually exists. The name is only a lookup key —
 * the JWT is still decrypted and verified with the secret.
 */
export function resolveSecureCookie(input: {
  headers: Record<string, string | string[] | undefined>;
  encrypted?: boolean;
  authUrl?: string;
}): boolean {
  const proto = firstHeaderValue(input.headers["x-forwarded-proto"]);
  let secure: boolean;
  if (proto) secure = proto === "https";
  else if (input.encrypted) secure = true;
  else secure = (input.authUrl ?? "").trim().toLowerCase().startsWith("https://");

  const rawCookie = input.headers.cookie;
  const cookieHeader = Array.isArray(rawCookie) ? rawCookie.join("; ") : (rawCookie ?? "");
  const names = cookieHeader
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
  // Large JWTs are chunked: `<name>.0`, `<name>.1`, …
  const has = (base: string) => names.some((n) => n === base || n.startsWith(`${base}.`));
  const hasSecure = has(SECURE_SESSION_COOKIE);
  const hasPlain = has(PLAIN_SESSION_COOKIE);
  if (secure && !hasSecure && hasPlain) return false;
  if (!secure && hasSecure && !hasPlain) return true;
  return secure;
}

export async function resolveSocketAuthContext(socket: Socket): Promise<SocketAuthContext | null> {
  const conn = (socket.request as { socket?: { encrypted?: boolean } }).socket;
  const secureCookie = resolveSecureCookie({
    headers: socket.request.headers,
    encrypted: Boolean(conn?.encrypted),
    authUrl: process.env.AUTH_URL || process.env.NEXTAUTH_URL,
  });

  const token = await getToken({
    req: socket.request as Parameters<typeof getToken>[0]["req"],
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie,
  });

  if (!token?.id) {
    return null;
  }

  // The JWT alone is not enough: a socket can outlive the HTTP session that
  // minted it. Re-validate against the DB exactly like the Auth.js `jwt`
  // callback does on every request (src/lib/auth/auth.config.ts) — the user
  // must still exist, be active, carry the current tokenVersion (bumped by
  // force-logout / deactivation / password change) and sit in the same org.
  // Role and org come from the DB, never the (possibly stale) token claims.
  const userId = String(token.id);
  const dbUser = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, organizationId: true, role: true, tokenVersion: true, name: true, ...WALL_SELECT },
  });
  if (!dbUser || !dbUser.isActive) return null;
  // Same sign-in wall as the HTTP middleware, computed fresh: a member
  // funnelled into two-factor enrollment by the org policy gets no realtime
  // channel either.
  const walls = wallsFromRow(dbUser);
  if (walls.mfaEnrollRequired) return null;
  if (token.tokenVersion !== undefined && dbUser.tokenVersion !== token.tokenVersion) {
    return null;
  }
  if (token.organizationId && String(token.organizationId) !== dbUser.organizationId) {
    return null;
  }

  return {
    userId,
    organizationId: dbUser.organizationId,
    role: dbUser.role,
    name: dbUser.name ?? (token.name ? String(token.name) : undefined),
  };
}

// canAccessIncident lives in ./access (re-exported above) so route handlers can
// run the same check via ./evict without bundling socket.io.

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
// In Next.js dev mode, HMR re-evaluates modules in isolated module scopes.
// API route handlers therefore get a fresh copy of this file where `io` is
// null, making every `emitToIncident` call a silent no-op.  Storing the
// instance on `global` survives module re-evaluation (same pattern as the
// Prisma client singleton in Next.js docs).
// ---------------------------------------------------------------------------

const globalForSocket = global as typeof global & {
  __crucibleCe_io: SocketIOServer | undefined;
};

function getLocalIO(): SocketIOServer | null {
  return globalForSocket.__crucibleCe_io ?? null;
}

/**
 * Return the current Socket.io Server instance.
 * Throws if `initSocketServer` has not been called yet.
 */
export function getIO(): SocketIOServer {
  const server = getLocalIO();
  if (!server) {
    throw new Error(
      "[socket/server] Socket.io has not been initialised. " +
        "Call initSocketServer(httpServer) first."
    );
  }
  return server;
}

/**
 * Origins allowed to open a Socket.io connection: the app's own origins
 * (PUBLIC_URL / AUTH_URL / NEXTAUTH_URL, the build-time NEXT_PUBLIC_* URLs,
 * and outside production http://localhost:3000/3001) plus the optional
 * comma-separated SOCKET_EXTRA_ALLOWED_ORIGINS. Read at call time.
 */
export function allowedSocketOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set([...appOrigins(env), ...parseOriginList(env.SOCKET_EXTRA_ALLOWED_ORIGINS)])];
}

/**
 * Cross-site WebSocket hijacking guard, enforced in `allowRequest` for EVERY
 * transport (the polling requests and the WebSocket upgrade; the CORS option
 * alone does not stop a cross-origin upgrade). A browser always sends Origin
 * on both, so a disallowed Origin is refused. A request WITHOUT Origin is not
 * a browser page (CSWSH needs one) and is let through; it still needs a valid
 * session (resolveSocketAuthContext in the namespace middleware).
 * With no public URL configured at all, falls back to a same-Host check.
 */
export function isAllowedSocketOrigin(
  origin: string | undefined,
  host?: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (origin === undefined || origin === "") return true;
  const o = originOf(origin);
  if (!o) return false; // "null" / garbage
  if (allowedSocketOrigins(env).includes(o)) return true;
  return configuredAppOrigins(env).length === 0 && sameHostOrigin(o, host);
}

/**
 * Initialise the Socket.io server and bind it to the provided HTTP server.
 *
 * Safe to call multiple times (e.g. during Next.js HMR) -- subsequent calls
 * return the existing instance.
 */
export async function initSocketServer(
  httpServer: HTTPServer
): Promise<SocketIOServer> {
  if (globalForSocket.__crucibleCe_io) {
    console.log("[socket/server] Returning existing Socket.io instance");
    return globalForSocket.__crucibleCe_io;
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedSocketOrigins(),
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Same list the browser client uses (./transports).
    transports: SOCKET_TRANSPORTS,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const ok = isAllowedSocketOrigin(typeof origin === "string" ? origin : undefined, host);
      if (!ok) {
        console.warn(`[socket/server] Rejected socket from disallowed Origin ${String(origin).slice(0, 200)}`);
      }
      callback(null, ok);
    },
  });
  console.log("[socket/server] Allowed origins:", allowedSocketOrigins());

  // Polling responses are written by engine.io, not Next, so they miss the
  // next.config.mjs security headers: add nosniff so a browser never sniffs a
  // polling payload as HTML/script.
  const addNosniff = (headers: Record<string, string>) => {
    headers["X-Content-Type-Options"] = "nosniff";
  };
  io.engine.on("initial_headers", addNosniff);
  io.engine.on("headers", addNosniff);

  // Single process: Socket.io's default in-memory adapter. Every connected
  // client is on this one server, so no cross-instance (Redis) adapter is
  // needed and a Redis outage cannot affect real-time delivery.

  setupWarRoomNamespace(io);
  setupNotificationHandlers(io);
  // Exercises: the /ex namespace (signed-in users and invite-code guests).
  setupExerciseNamespace(io, resolveSocketAuthContext);
  registerExerciseIO(io);

  globalForSocket.__crucibleCe_io = io;
  console.log("[socket/server] Socket.io server initialised");
  return io;
}

// ---------------------------------------------------------------------------
// /war-room namespace
// ---------------------------------------------------------------------------

function setupWarRoomNamespace(server: SocketIOServer): void {
  const warRoom: Namespace = server.of("/war-room");

  warRoom.use(async (socket, next) => {
    try {
      const auth = await resolveSocketAuthContext(socket);
      if (!auth) {
        return next(new Error("Unauthorized"));
      }
      (socket as SocketWithAuth).data.auth = auth;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  warRoom.on("connection", async (socket: SocketWithAuth) => {
    const auth = socket.data.auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }

    // Per-user room so admin revocation (deactivate / force-logout / role
    // change) can disconnect every socket of this user cluster-wide.
    socket.join(userSessionRoom(auth.userId));

    // Incident war-room auto-join (client passes incidentId in the handshake).
    const incidentId = socket.handshake.query.incidentId as string | undefined;
    if (incidentId && (await canAccessIncident(incidentId, auth))) {
      socket.join(`incident:${incidentId}`);
      console.log(
        `[incident] Socket ${socket.id} auto-joined room incident:${incidentId}`
      );
    }

    // --------------------------------------------------
    // join-incident / leave-incident (war-room rooms)
    // --------------------------------------------------
    socket.on("join-incident", async (payload: { incidentId: string }) => {
      if (!payload?.incidentId) return;
      if (!(await canAccessIncident(payload.incidentId, auth))) return;
      socket.join(`incident:${payload.incidentId}`);
    });
    socket.on("leave-incident", (payload: { incidentId: string }) => {
      if (!payload?.incidentId) return;
      socket.leave(`incident:${payload.incidentId}`);
    });

    // --------------------------------------------------
    // disconnect
    // --------------------------------------------------
    socket.on("disconnect", (reason: string) => {
      console.log(
        `[war-room] Socket ${socket.id} disconnected (reason: ${reason})`
      );
      // Socket.io automatically removes the socket from all rooms on
      // disconnect, so no manual cleanup is needed.
    });
  });
}

// ---------------------------------------------------------------------------
// Notification room handlers (default namespace)
// ---------------------------------------------------------------------------
// Notifications are emitted on the default namespace (not /war-room)
// to user-specific rooms (`user:{userId}`). Clients join their room by
// emitting the `join:notifications` event with their userId.
// ---------------------------------------------------------------------------

function setupNotificationHandlers(server: SocketIOServer): void {
  server.of("/").use(async (socket, next) => {
    try {
      const auth = await resolveSocketAuthContext(socket);
      if (!auth) {
        return next(new Error("Unauthorized"));
      }
      (socket as SocketWithAuth).data.auth = auth;
      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  server.on("connection", (socket: SocketWithAuth) => {
    const auth = socket.data.auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }

    socket.join(userSessionRoom(auth.userId));

    socket.on("join:notifications", (payload?: { userId?: string }) => {
      if (payload?.userId && payload.userId !== auth.userId) {
        return;
      }

      const room = `user:${auth.userId}`;
      socket.join(room);
      console.log(
        `[notifications] Socket ${socket.id} joined room ${room}`
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Typed emit helpers
// ---------------------------------------------------------------------------
// These helpers let server-side code broadcast to a war-room with full
// type safety. Import them from route handlers / server actions.

import type { SocketEventPayloadMap } from "./events";

/** Emit an event to everyone in an incident war-room (`incident:{id}`). */
export function emitToIncident<E extends keyof SocketEventPayloadMap>(
  incidentId: string,
  event: E,
  payload: SocketEventPayloadMap[E]
): void {
  const server = getLocalIO();
  if (!server) return;
  server
    .of("/war-room")
    .to(`incident:${incidentId}`)
    .emit(event, payload);
}
