import { describe, it, expect } from "vitest";
import { z } from "zod";
import { MAX_JSON_BODY_BYTES, containsNulByte, isJsonContentType, parseJsonBody } from "./parse-body";

const schema = z.object({ name: z.string() });
const req = (body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
  new Request("https://x/", { method: "POST", body, headers });

describe("parseJsonBody", () => {
  it("returns typed data on a valid body", async () => {
    const p = await parseJsonBody(req(JSON.stringify({ name: "a" })), schema);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.data.name).toBe("a");
  });
  it("400s on malformed/empty JSON instead of throwing", async () => {
    const p = await parseJsonBody(req("not json"), schema);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.response.status).toBe(400);
    const empty = await parseJsonBody(new Request("https://x/", { method: "POST" }), schema);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.response.status).toBe(400);
  });
  it("400s on a schema mismatch", async () => {
    const p = await parseJsonBody(req(JSON.stringify({ name: 5 })), schema);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.response.status).toBe(400);
  });

  it("415s when a body is sent without a JSON Content-Type", async () => {
    // A string body defaults to text/plain;charset=UTF-8 — the CSRF "simple request" type.
    const variants: Record<string, string>[] = [{}, { "Content-Type": "text/plain" }, { "Content-Type": "application/x-www-form-urlencoded" }];
    for (const headers of variants) {
      const p = await parseJsonBody(req(JSON.stringify({ name: "a" }), headers), schema);
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.response.status).toBe(415);
    }
  });
  it("accepts application/json with parameters and +json types", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("application/merge-patch+json")).toBe(true);
    expect(isJsonContentType("text/json")).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });

  it("413s on a body over 1 MB (actual bytes, no Content-Length)", async () => {
    const big = JSON.stringify({ name: "x".repeat(MAX_JSON_BODY_BYTES) });
    const p = await parseJsonBody(req(big), schema);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.response.status).toBe(413);
  });
  it("413s on a declared Content-Length over the cap", async () => {
    const p = await parseJsonBody(
      req(JSON.stringify({ name: "a" }), { "Content-Type": "application/json", "Content-Length": String(MAX_JSON_BODY_BYTES + 1) }),
      schema,
    );
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.response.status).toBe(413);
  });

  it("400s on a NUL character anywhere in the parsed body", async () => {
    const deep = z.object({ a: z.array(z.object({ b: z.string() })) });
    const p = await parseJsonBody(req(JSON.stringify({ a: [{ b: "ok\u0000bad" }] })), deep);
    expect(p.ok).toBe(false);
    if (!p.ok) {
      expect(p.response.status).toBe(400);
      expect((await p.response.json()).details).toMatch(/NUL/);
    }
    const key = await parseJsonBody(req('{"name":"a","x\\u0000":1}'), schema);
    expect(key.ok).toBe(false);
  });
  it("containsNulByte ignores clean values", () => {
    expect(containsNulByte({ a: ["x", 1, null, { b: true }] })).toBe(false);
    expect(containsNulByte("a\u0000")).toBe(true);
  });
});
