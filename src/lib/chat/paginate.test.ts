import { describe, it, expect } from "vitest";
import { parseChatQuery, chatPageArgs, afterCursorWhere, CHAT_LIMITS } from "./paginate";

const url = (q: string) => `http://localhost/api/x${q}`;

describe("parseChatQuery", () => {
  const bounds = CHAT_LIMITS.incident; // default 200, max 500

  it("defaults when limit absent / NaN; clamps to [1,max]", () => {
    expect(parseChatQuery(url(""), bounds)).toEqual({ limit: 200, after: null });
    expect(parseChatQuery(url("?limit=abc"), bounds).limit).toBe(200);
    expect(parseChatQuery(url("?limit=-5"), bounds).limit).toBe(1);
    expect(parseChatQuery(url("?limit=0"), bounds).limit).toBe(1);
    expect(parseChatQuery(url("?limit=9999"), bounds).limit).toBe(500);
    expect(parseChatQuery(url("?limit=50"), bounds).limit).toBe(50);
  });

  it("reads after; empty string is null", () => {
    expect(parseChatQuery(url("?after=abc"), bounds).after).toBe("abc");
    expect(parseChatQuery(url("?after="), bounds).after).toBeNull();
  });
});

describe("chatPageArgs", () => {
  const row = { id: "m-5", createdAt: new Date("2026-07-04T00:00:00Z") };

  it("cold load: newest-N desc with id tiebreak", () => {
    const a = chatPageArgs({ limit: 50, after: null, afterRow: null });
    expect(a.incremental).toBe(false);
    expect(a.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(a.take).toBe(50);
  });

  it("unresolved cursor (deleted/foreign id) degrades to cold load", () => {
    const a = chatPageArgs({ limit: 50, after: "gone", afterRow: null });
    expect(a.incremental).toBe(false);
  });

  it("incremental: ascending with the limit as a safety ceiling", () => {
    const a = chatPageArgs({ limit: 50, after: row.id, afterRow: row });
    expect(a.incremental).toBe(true);
    expect(a.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(a.take).toBe(50);
  });
});

describe("afterCursorWhere", () => {
  it("is the (createdAt gt) OR (createdAt eq AND id gt) keyset", () => {
    const at = new Date("2026-07-04T00:00:00Z");
    expect(afterCursorWhere({ id: "m-5", createdAt: at })).toEqual({
      OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: "m-5" } }],
    });
  });
});
