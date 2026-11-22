import { describe, it, expect } from "vitest";
import { parsePageParams, toPage, idCursorWhere, pageCursorArgs } from "./paginate";

function urlWith(query: string) {
  return new URL(`http://localhost/api/things${query}`);
}

describe("parsePageParams", () => {
  it("defaults: no params → defaultTake, no cursor, not paginated", () => {
    const p = parsePageParams(urlWith(""));
    expect(p).toEqual({ take: 50, cursor: null, paginated: false });
  });

  it("respects per-route defaultTake/maxTake", () => {
    const p = parsePageParams(urlWith(""), { defaultTake: 100, maxTake: 100 });
    expect(p.take).toBe(100);
    expect(p.paginated).toBe(false);
  });

  it("?take= opts into pagination and clamps to [1, maxTake]", () => {
    expect(parsePageParams(urlWith("?take=25")).paginated).toBe(true);
    expect(parsePageParams(urlWith("?take=25")).take).toBe(25);
    expect(parsePageParams(urlWith("?take=0")).take).toBe(1);
    expect(parsePageParams(urlWith("?take=-5")).take).toBe(1);
    expect(parsePageParams(urlWith("?take=9999")).take).toBe(100);
    expect(parsePageParams(urlWith("?take=9999"), { maxTake: 20 }).take).toBe(20);
  });

  it("non-numeric take falls back to defaultTake but still opts in", () => {
    const p = parsePageParams(urlWith("?take=abc"), { defaultTake: 30 });
    expect(p.take).toBe(30);
    expect(p.paginated).toBe(true);
  });

  it("?cursor= opts into pagination and is read verbatim", () => {
    const p = parsePageParams(urlWith("?cursor=abc123"));
    expect(p.cursor).toBe("abc123");
    expect(p.paginated).toBe(true);
    expect(p.take).toBe(50);
  });

  it("blank cursor is treated as null but still opts in", () => {
    const p = parsePageParams(urlWith("?cursor="));
    expect(p.cursor).toBeNull();
    expect(p.paginated).toBe(true);
  });
});

describe("toPage", () => {
  const row = (id: string) => ({ id });

  it("take+1 rows → drops the extra, nextCursor = last kept row", () => {
    const page = toPage([row("c"), row("b"), row("a")], 2, (r) => r.id);
    expect(page.items.map((r) => r.id)).toEqual(["c", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("exactly take rows → all kept, nextCursor null", () => {
    const page = toPage([row("c"), row("b")], 2, (r) => r.id);
    expect(page.items.map((r) => r.id)).toEqual(["c", "b"]);
    expect(page.nextCursor).toBeNull();
  });

  it("fewer than take rows → all kept, nextCursor null", () => {
    const page = toPage([row("c")], 2, (r) => r.id);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("empty → empty page, nextCursor null", () => {
    const page = toPage([], 2, (r: { id: string }) => r.id);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});

describe("cursor clause builders", () => {
  it("idCursorWhere: null → empty object; id → lt boundary", () => {
    expect(idCursorWhere(null)).toEqual({});
    expect(idCursorWhere("x1")).toEqual({ id: { lt: "x1" } });
  });

  it("pageCursorArgs: null → empty object; id → native cursor + skip", () => {
    expect(pageCursorArgs(null)).toEqual({});
    expect(pageCursorArgs("x1")).toEqual({ cursor: { id: "x1" }, skip: 1 });
  });
});
