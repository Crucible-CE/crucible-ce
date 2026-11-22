import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the sorted-set subset the throttle uses.
class FakeRedis {
  sets = new Map<string, { score: number; value: string }[]>();
  async zRemRangeByScore(key: string, _min: string, max: number) {
    const s = this.sets.get(key) ?? [];
    this.sets.set(key, s.filter((e) => e.score > max));
    return 0;
  }
  async zCard(key: string) {
    return (this.sets.get(key) ?? []).length;
  }
  async zRangeWithScores(key: string, start: number, stop: number) {
    const s = [...(this.sets.get(key) ?? [])].sort((a, b) => a.score - b.score);
    const i = start < 0 ? s.length + start : start;
    const j = stop < 0 ? s.length + stop : stop;
    return s.slice(i, j + 1);
  }
  async zAdd(key: string, e: { score: number; value: string }) {
    this.sets.set(key, [...(this.sets.get(key) ?? []), e]);
    return 1;
  }
  async pExpire() {
    return 1;
  }
  async del(keys: string | string[]) {
    let n = 0;
    for (const k of Array.isArray(keys) ? keys : [keys]) if (this.sets.delete(k)) n++;
    return n;
  }
  async *scanIterator(opts: { MATCH: string }) {
    const prefix = opts.MATCH.replace(/\*$/, "");
    yield [...this.sets.keys()].filter((k) => k.startsWith(prefix));
  }
}

let fake: FakeRedis | null = new FakeRedis();
vi.mock("@/lib/db/redis", () => ({
  getRedis: vi.fn(async () => fake),
  rkey: (k: string) => `test:${k}`,
}));

import {
  EMAIL_FREE,
  LOGIN_IP_MAX,
  MAX_DELAY_SEC,
  PAIR_FREE,
  backoffSeconds,
  checkLoginThrottle,
  clearLoginPair,
  clearLoginThrottleForEmail,
  recordLoginFailure,
} from "./login-throttle";

const T0 = 1_700_000_000_000;

async function fail(n: number, email: string, ip: string, start = T0, stepMs = 0) {
  for (let i = 0; i < n; i++) await recordLoginFailure({ email, ip, now: start + i * stepMs });
}

beforeEach(() => {
  fake = new FakeRedis();
});

describe("backoffSeconds", () => {
  it("is free below the allowance, then doubles, capped", () => {
    expect(backoffSeconds(4, 5)).toBe(0);
    expect(backoffSeconds(5, 5)).toBe(1);
    expect(backoffSeconds(6, 5)).toBe(2);
    expect(backoffSeconds(10, 5)).toBe(32);
    expect(backoffSeconds(50, 5)).toBe(MAX_DELAY_SEC);
    expect(backoffSeconds(1000, 5)).toBe(MAX_DELAY_SEC);
  });
});

describe("checkLoginThrottle", () => {
  it("lets the first PAIR_FREE-1 failures through with no delay", async () => {
    await fail(PAIR_FREE - 1, "a@x.test", "1.1.1.1");
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: false, now: T0 })).allowed).toBe(true);
  });

  it("applies an exponential delay per email+IP after PAIR_FREE failures", async () => {
    await fail(PAIR_FREE + 3, "a@x.test", "1.1.1.1"); // 8 failures -> 2^3 = 8 s
    const blocked = await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: false, now: T0 + 1000 });
    expect(blocked).toMatchObject({ allowed: false, gate: "pair" });
    expect(blocked.retryAfter).toBe(7);
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: false, now: T0 + 8000 })).allowed).toBe(true);
    // A different IP for the same email is not delayed by this pair.
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "2.2.2.2", trustedDevice: false, now: T0 + 1000 })).allowed).toBe(true);
  });

  it("a trusted device skips the per-email gates but not the per-IP cap", async () => {
    await fail(PAIR_FREE + 5, "a@x.test", "1.1.1.1");
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: true, now: T0 + 1 })).allowed).toBe(true);
    await fail(LOGIN_IP_MAX, "other@x.test", "1.1.1.1");
    const ip = await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: true, now: T0 + 1 });
    expect(ip).toMatchObject({ allowed: false, gate: "ip" });
  });

  it("delays an account attacked from many IPs (per-email gate)", async () => {
    for (let i = 0; i < EMAIL_FREE + 2; i++) await recordLoginFailure({ email: "v@x.test", ip: `10.0.0.${i}`, now: T0 });
    const r = await checkLoginThrottle({ email: "v@x.test", ip: "10.9.9.9", trustedDevice: false, now: T0 + 1 });
    expect(r).toMatchObject({ allowed: false, gate: "email" });
  });

  it("success clears only this pair; admin unlock clears every email gate", async () => {
    await fail(PAIR_FREE + 3, "a@x.test", "1.1.1.1");
    await clearLoginPair({ email: "a@x.test", ip: "1.1.1.1" });
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: false, now: T0 + 1 })).allowed).toBe(true);

    for (let i = 0; i < EMAIL_FREE + 2; i++) await recordLoginFailure({ email: "A@x.test ", ip: `10.0.1.${i % 3}`, now: T0 });
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "10.0.1.0", trustedDevice: false, now: T0 + 1 })).allowed).toBe(false);
    const removed = await clearLoginThrottleForEmail("a@x.test");
    expect(removed).toBeGreaterThanOrEqual(4); // email key + 3 pair keys
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "10.0.1.0", trustedDevice: false, now: T0 + 1 })).allowed).toBe(true);
  });

  it("fails open without Redis", async () => {
    fake = null;
    expect((await checkLoginThrottle({ email: "a@x.test", ip: "1.1.1.1", trustedDevice: false })).allowed).toBe(true);
    expect(await clearLoginThrottleForEmail("a@x.test")).toBeNull();
  });
});
