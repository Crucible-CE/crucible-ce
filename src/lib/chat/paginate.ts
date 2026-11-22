// ---------------------------------------------------------------------------
// chat pagination (direction fix + incremental cursor fetch).
//
// The war-room chats' defining shape: a COLD load must return the NEWEST N
// messages (fetched desc, then reversed to the ascending wire order clients
// assume), and subsequent polls fetch only the strictly-newer delta via a
// keyset cursor. The old oldest-N `orderBy asc, take N` queries froze the
// backlog once a chat crossed its cap — new messages never entered the
// payload for pollers (guests have no socket and saw nothing new at all).
//
// Keyset, not Prisma `cursor`: createdAt is NOT unique, so the cursor
// tie-breaks on id — (createdAt > c) OR (createdAt = c AND id > c.id) — and
// cuids are not strictly time-sortable, so id alone can't order the chat.
// Deleted/foreign cursor ids fall back to a cold load rather than erroring.
// Generic list pagination lives in @/lib/http/paginate; chat's newest-N +
// delta contract is deliberately its own small module.
// ---------------------------------------------------------------------------

export const CHAT_LIMITS = {
  incident: { default: 200, max: 500 },
} as const;

/** Parse & clamp ?limit and ?after from a request URL. `after` = last-seen message id. */
export function parseChatQuery(
  url: string,
  bounds: { default: number; max: number },
): { limit: number; after: string | null } {
  const sp = new URL(url).searchParams;
  const raw = sp.get("limit");
  const n = raw == null ? bounds.default : parseInt(raw, 10);
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), bounds.max) : bounds.default;
  const after = sp.get("after");
  return { limit, after: after && after.length > 0 ? after : null };
}

/** A message row minimally shaped for cursor math. */
export interface CursorRow {
  id: string;
  createdAt: Date;
}

/**
 * Query fragments for the page. Cold load → newest-N desc (caller reverses);
 * incremental (resolved cursor) → strictly-after ascending, capped at `limit`
 * as a safety ceiling.
 */
export function chatPageArgs(opts: {
  limit: number;
  after: string | null;
  afterRow: CursorRow | null;
}): {
  orderBy: ({ createdAt: "desc" | "asc" } | { id: "desc" | "asc" })[];
  take: number;
  incremental: boolean;
} {
  if (opts.after && opts.afterRow) {
    return {
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: opts.limit,
      incremental: true,
    };
  }
  return {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit,
    incremental: false,
  };
}

/** Keyset where-fragment: everything strictly after the cursor row. */
export function afterCursorWhere(cursor: CursorRow) {
  return {
    OR: [
      { createdAt: { gt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
    ],
  };
}
