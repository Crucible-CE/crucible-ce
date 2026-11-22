// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAckToken, verifyAckToken } from "./ack-token";

const PAGE = "cmabc123def456ghi789jkl0";
const saved: Record<string, string | undefined> = {};

describe("ack tokens", () => {
  beforeEach(() => {
    for (const k of ["AUTH_SECRET", "NEXTAUTH_SECRET", "DELIVERY_ACK_LINK_TTL_HOURS"]) saved[k] = process.env[k];
    process.env.AUTH_SECRET = "test-secret-at-least-32-bytes-long-xxxxxxxx";
    delete process.env.DELIVERY_ACK_LINK_TTL_HOURS;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("round-trips page id + level, URL-safe and compact", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const token = createAckToken(PAGE, 2, now);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(token.length).toBeLessThan(80);
    const r = verifyAckToken(token, now);
    expect(r).toMatchObject({ ok: true, pageId: PAGE, level: 2 });
  });

  it("expires after the TTL (default 24h, configurable)", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const token = createAckToken(PAGE, 0, now);
    expect(verifyAckToken(token, new Date(now.getTime() + 23 * 3600_000)).ok).toBe(true);
    expect(verifyAckToken(token, new Date(now.getTime() + 25 * 3600_000))).toEqual({ ok: false, reason: "expired" });

    process.env.DELIVERY_ACK_LINK_TTL_HOURS = "1";
    const short = createAckToken(PAGE, 0, now);
    expect(verifyAckToken(short, new Date(now.getTime() + 2 * 3600_000))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampering: level bump, other page, forged signature, other secret", () => {
    const now = new Date();
    const token = createAckToken(PAGE, 0, now);
    const [id, level, exp, sig] = token.split(".");
    expect(verifyAckToken(`${id}.${Number(level) + 1}.${exp}.${sig}`, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAckToken(`cmzzz999zzz999zzz999zzz99.${level}.${exp}.${sig}`, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAckToken(`${id}.${level}.${Number(exp) + 999}.${sig}`, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyAckToken("nope", now)).toEqual({ ok: false, reason: "malformed" });
    process.env.AUTH_SECRET = "a-completely-different-secret-value-xxxxxxx";
    expect(verifyAckToken(token, now)).toEqual({ ok: false, reason: "bad_signature" });
  });
});
