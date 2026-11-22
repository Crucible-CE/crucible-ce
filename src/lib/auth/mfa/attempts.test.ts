// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ redis: vi.fn(), reserveSlot: vi.fn(), refundSlot: vi.fn() }));
// Real rate-limit.ts; Redis is what we control.
vi.mock("@/lib/db/redis", () => ({ getRedis: h.redis, rkey: (k: string) => `test:${k}` }));
vi.mock("./service", () => ({ reserveMfaFailureSlot: h.reserveSlot, refundMfaFailureSlot: h.refundSlot }));

import { reserveFactorAttempt } from "./attempts";

/** Minimal sorted-set Redis for the reserve-first limiter. */
function fakeRedis() {
  const sets = new Map<string, Map<string, number>>();
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Map()).get(k)!;
  return {
    zRemRangeByScore: async (k: string, _min: string, max: number) => {
      for (const [m, s] of set(k)) if (s <= max) set(k).delete(m);
    },
    zAdd: async (k: string, { score, value }: { score: number; value: string }) => void set(k).set(value, score),
    pExpire: async () => {},
    zCard: async (k: string) => set(k).size,
    zRem: async (k: string, m: string) => void set(k).delete(m),
    zRangeWithScores: async (k: string) => [...set(k).values()].sort().slice(0, 1).map((score) => ({ score })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reserveSlot.mockResolvedValue(true);
});

describe("reserveFactorAttempt", () => {
  it("without Redis the database cap still holds (the Redis limiter fails open)", async () => {
    h.redis.mockResolvedValue(null);
    h.reserveSlot.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await reserveFactorAttempt({ scope: "login", userId: "u1", ip: "1.2.3.4", deviceKey: null })).allowed).toBe(true);
    expect((await reserveFactorAttempt({ scope: "login", userId: "u1", ip: "1.2.3.4", deviceKey: null })).allowed).toBe(false);
  });

  it("a known device skips the per-user database cap (the owner can't be locked out of their own browser)", async () => {
    h.redis.mockResolvedValue(null);
    h.reserveSlot.mockResolvedValue(false);
    expect((await reserveFactorAttempt({ scope: "login", userId: "u1", ip: "1.2.3.4", deviceKey: "dev" })).allowed).toBe(true);
    expect(h.reserveSlot).not.toHaveBeenCalled();
  });

  it("success refunds the database slot; failure keeps it", async () => {
    h.redis.mockResolvedValue(null);
    const ok = await reserveFactorAttempt({ scope: "reauth", userId: "u1", ip: "1.2.3.4", deviceKey: null });
    if (!ok.allowed) throw new Error("expected allowed");
    await ok.finish(false);
    expect(h.refundSlot).not.toHaveBeenCalled();
    await ok.finish(true);
    expect(h.refundSlot).toHaveBeenCalledWith("u1");
  });

  it("Redis is reserve-first: concurrent attempts never exceed the per user+IP cap", async () => {
    h.redis.mockResolvedValue(fakeRedis());
    const results = await Promise.all(
      Array.from({ length: 25 }, () => reserveFactorAttempt({ scope: "login", userId: "u1", ip: "1.2.3.4", deviceKey: null })),
    );
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(10);
    // Refused attempts gave their database slot back.
    expect(h.refundSlot).toHaveBeenCalledTimes(results.filter((r) => !r.allowed).length);
    // Another user from the same IP is counted separately (user+IP key)...
    expect((await reserveFactorAttempt({ scope: "login", userId: "u2", ip: "1.2.3.4", deviceKey: null })).allowed).toBe(true);
    // ...and the same user from their known device has its own bucket.
    expect((await reserveFactorAttempt({ scope: "login", userId: "u1", ip: "1.2.3.4", deviceKey: "dev" })).allowed).toBe(true);
  });
});
