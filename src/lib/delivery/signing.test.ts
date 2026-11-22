// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { computeSignature, signatureHeader, verifySignature } from "./signing";

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ type: "crucible.page", id: "p1:0:webhook:1" });

describe("webhook signing", () => {
  it("signs HMAC-SHA256(secret, `${t}.${body}`) as hex", () => {
    const t = 1_760_000_000;
    const expected = createHmac("sha256", SECRET).update(`${t}.${BODY}`).digest("hex");
    expect(computeSignature(SECRET, t, BODY)).toBe(expected);
    expect(signatureHeader(SECRET, t, BODY)).toBe(`t=${t},v1=${expected}`);
  });

  it("verifies a fresh signature and rejects tampering", () => {
    const t = 1_760_000_000;
    const header = signatureHeader(SECRET, t, BODY);
    expect(verifySignature(SECRET, BODY, header, { now: t + 10 })).toBe(true);
    expect(verifySignature(SECRET, BODY + " ", header, { now: t })).toBe(false); // body changed
    expect(verifySignature("other-secret", BODY, header, { now: t })).toBe(false); // wrong secret
    expect(verifySignature(SECRET, BODY, header.replace(`t=${t}`, `t=${t + 1}`), { now: t })).toBe(false); // ts changed
  });

  it("rejects stale timestamps (replay window) and malformed headers", () => {
    const t = 1_760_000_000;
    const header = signatureHeader(SECRET, t, BODY);
    expect(verifySignature(SECRET, BODY, header, { now: t + 301 })).toBe(false);
    expect(verifySignature(SECRET, BODY, header, { now: t + 301, toleranceSeconds: 600 })).toBe(true);
    expect(verifySignature(SECRET, BODY, null)).toBe(false);
    expect(verifySignature(SECRET, BODY, "garbage")).toBe(false);
    expect(verifySignature(SECRET, BODY, `t=${t}`, { now: t })).toBe(false);
  });

  it("accepts any matching v1 (secret rotation)", () => {
    const t = 1_760_000_000;
    const good = computeSignature(SECRET, t, BODY);
    expect(verifySignature(SECRET, BODY, `t=${t},v1=deadbeef,v1=${good}`, { now: t })).toBe(true);
  });
});
