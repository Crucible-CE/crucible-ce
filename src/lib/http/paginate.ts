// ---------------------------------------------------------------------------
// Cursor pagination helpers.
//
// Codifies the cursor pattern from src/app/api/admin/audit/org/route.ts so
// list routes stop hand-rolling it: fetch `take + 1` rows, slice to `take`,
// and derive `nextCursor` from the last kept row (null when no more).
//
// Backward-compatible envelope convention: a list route returns its legacy
// bare array when the request carries no pagination params, and the
// `{ items, nextCursor }` envelope only when `?take=` or `?cursor=` is
// present (`PageParams.paginated`). Paginated responses must set
// `Cache-Control: no-store` (see PAGINATED_HEADERS).
//
// Two cursor mechanisms, chosen per route by its ordering:
//
// 1. `idCursorWhere(cursor)` — a `{ id: { lt: cursor } }` boundary for lists
//    ordered `[{ createdAt: "desc" }, { id: "desc" }]`. cuids are
//    timestamp-prefixed so id order tracks creation order; the explicit
//    `id: "desc"` tiebreak makes the page boundary stable. Tolerates the
//    cursor row being deleted between pages.
//
// 2. `pageCursorArgs(cursor)` — Prisma native `{ cursor: { id }, skip: 1 }`
//    for lists ordered by a mutable or non-id-correlated key (updatedAt,
//    name, relation fields). The orderBy MUST include an `id` tiebreak to be
//    deterministic. If the cursor row is deleted between pages the stream
//    ends early (Prisma returns an empty page); acceptable for UI paging.
// ---------------------------------------------------------------------------

export interface PageParams {
  /** Clamped page size (min 1, max `maxTake`, default `defaultTake`). */
  take: number;
  /** Opaque cursor (row id) from a prior page, or null for the first page. */
  cursor: string | null;
  /** True when the request opted into pagination (`?take=` or `?cursor=`). */
  paginated: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Headers every paginated (envelope) response must carry. */
export const PAGINATED_HEADERS = { "Cache-Control": "no-store" } as const;

export function parsePageParams(
  url: URL,
  opts: { defaultTake?: number; maxTake?: number } = {},
): PageParams {
  const defaultTake = opts.defaultTake ?? 50;
  const maxTake = opts.maxTake ?? 100;

  const rawTake = url.searchParams.get("take");
  const rawCursor = url.searchParams.get("cursor");

  const parsed = rawTake === null ? NaN : parseInt(rawTake, 10);
  const take = Math.min(Math.max(Number.isFinite(parsed) ? parsed : defaultTake, 1), maxTake);
  const cursor = rawCursor?.trim() ? rawCursor.trim() : null;

  return { take, cursor, paginated: rawTake !== null || rawCursor !== null };
}

/**
 * Split rows fetched with `take + 1` into a page. The extra row (if present)
 * only signals that more data exists; it is dropped from the page.
 */
export function toPage<T>(rows: T[], take: number, getCursor: (row: T) => string): Page<T> {
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return {
    items,
    nextCursor: hasMore && items.length > 0 ? getCursor(items[items.length - 1]) : null,
  };
}

/** Cursor boundary for `[{ createdAt: "desc" }, { id: "desc" }]` ordered lists. */
export function idCursorWhere(cursor: string | null): { id?: { lt: string } } {
  return cursor ? { id: { lt: cursor } } : {};
}

/**
 * Prisma-native cursor args for arbitrary stable orderings (orderBy must
 * include an `id` tiebreak). Spread into findMany alongside `orderBy`/`take`.
 */
export function pageCursorArgs(
  cursor: string | null,
): { cursor: { id: string }; skip: number } | Record<string, never> {
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}
