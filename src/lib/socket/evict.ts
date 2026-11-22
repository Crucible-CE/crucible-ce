// =============================================================================
// Crucible CE — War-room eviction + per-user socket revocation
// =============================================================================
// Called from Next.js route handlers when someone may have LOST access:
//   - a participant is removed from an incident's allowlist;
//   - an incident is locked (`restricted` → true);
//   - an admin deactivates / force-logs-out / re-roles a user.
//
// Route handlers reach sockets the same way `emitToIncident` does: through the
// Socket.io server stored on `globalThis.__crucibleCe_io` by
// `initSocketServer` (the custom server and the Next.js bundle share the
// process, not the module registry). CE is a single process on Socket.io's
// default in-memory adapter (there is no Redis adapter), so `fetchSockets()`,
// `socket.leave/emit` and `disconnectSockets()` see every connected client and
// eviction is complete within this one server.
//
// When no server is registered in this process (unit tests, or the dev split
// where `next dev` runs apart from the :3001 socket sidecar) both helpers are
// no-ops — the same degradation every other route-side emit has.
//
// Neither helper ever throws: an eviction failure is logged and swallowed so
// it can never fail the HTTP request that triggered it.
// =============================================================================

import type { Server as SocketIOServer } from "socket.io";
import { usersWithIncidentAccess } from "./access";
import { SOCKET_EVENTS, type IncidentAccessRevokedPayload } from "./events";

/** Room every authenticated socket joins on connect (both namespaces). */
export function userSessionRoom(userId: string): string {
  return `session:${userId}`;
}

export function incidentRoom(incidentId: string): string {
  return `incident:${incidentId}`;
}

function getRegisteredIO(): SocketIOServer | null {
  const g = globalThis as typeof globalThis & { __crucibleCe_io?: SocketIOServer };
  return g.__crucibleCe_io ?? null;
}

interface EvictOptions {
  /** Only reconsider sockets belonging to these users. */
  userIds?: string[];
  /** Reconsider every socket in the room (use when the incident is locked). */
  recheckAll?: boolean;
}

/**
 * Re-run the access check for sockets in `incident:{id}` and remove the ones
 * that lost access: `socket.leave(room)` + an `incident:access_revoked` event
 * to that socket only. Resolves to the number of sockets evicted.
 */
export async function evictFromIncidentRoom(
  incidentId: string,
  opts: EvictOptions,
): Promise<number> {
  try {
    const io = getRegisteredIO();
    if (!io) return 0;
    if (!opts.recheckAll && (!opts.userIds || opts.userIds.length === 0)) return 0;

    const room = incidentRoom(incidentId);
    const sockets = await io.of("/war-room").in(room).fetchSockets();
    const only = opts.recheckAll ? null : new Set(opts.userIds);

    const candidates = sockets.filter((s) => {
      const uid = (s.data as { auth?: { userId?: string } } | undefined)?.auth?.userId;
      // A socket with no auth context should never be in a room — evict it.
      if (!uid) return true;
      return only === null || only.has(uid);
    });
    if (candidates.length === 0) return 0;

    const userIds = candidates
      .map((s) => (s.data as { auth?: { userId?: string } } | undefined)?.auth?.userId)
      .filter((u): u is string => !!u);
    const allowed = await usersWithIncidentAccess(incidentId, userIds);

    let evicted = 0;
    const payload: IncidentAccessRevokedPayload = { incidentId };
    for (const s of candidates) {
      const uid = (s.data as { auth?: { userId?: string } } | undefined)?.auth?.userId;
      if (uid && allowed.has(uid)) continue;
      try {
        s.leave(room);
        s.emit(SOCKET_EVENTS.INCIDENT_ACCESS_REVOKED, payload);
        evicted += 1;
      } catch (err) {
        console.error(`[socket/evict] Failed to evict socket ${s.id} from ${room}`, err);
      }
    }
    if (evicted > 0) {
      console.log(`[socket/evict] Evicted ${evicted} socket(s) from ${room}`);
    }
    return evicted;
  } catch (err) {
    console.error(`[socket/evict] Eviction check failed for incident:${incidentId}`, err);
    return 0;
  }
}

/**
 * Disconnect every socket (default + /war-room namespaces, every replica) that
 * belongs to `userId`. Use after deactivation, force-logout, or a role change.
 * A still-valid user's client reconnects and is re-authenticated against the
 * DB (fresh role); a revoked one is rejected at the handshake.
 */
export function disconnectUserSockets(userId: string): void {
  try {
    const io = getRegisteredIO();
    if (!io) return;
    const room = userSessionRoom(userId);
    io.in(room).disconnectSockets(true);
    io.of("/war-room").in(room).disconnectSockets(true);
  } catch (err) {
    console.error(`[socket/evict] Failed to disconnect sockets for user ${userId}`, err);
  }
}
