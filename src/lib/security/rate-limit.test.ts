import { describe, expect, it, vi, beforeEach } from "vitest";

// These cases exercise the behind-one-proxy path (CE default is 0 hops).
vi.hoisted(() => { process.env.TRUSTED_PROXY_HOPS = "1"; });

// Mock getRedis BEFORE importing the module under test so the import-time
// binding inside rate-limit.ts captures the mock.
vi.mock("@/lib/db/redis", () => ({
  getRedis: vi.fn(),
  rkey: (key: string) => `test:${key}`,
}));

import { getRedis } from "@/lib/db/redis";
import {
  peekRateLimit,
  recordRateLimitHit,
  checkRateLimit,
  ipFromRequest,
} from "./rate-limit";

type MockRedis = {
  zRemRangeByScore: ReturnType<typeof vi.fn>;
  zCard: ReturnType<typeof vi.fn>;
  zAdd: ReturnType<typeof vi.fn>;
  zRangeWithScores: ReturnType<typeof vi.fn>;
  pExpire: ReturnType<typeof vi.fn>;
};

function makeRedis(overrides: Partial<MockRedis> = {}): MockRedis {
  return {
    zRemRangeByScore: vi.fn().mockResolvedValue(0),
    zCard: vi.fn().mockResolvedValue(0),
    zAdd: vi.fn().mockResolvedValue(1),
    zRangeWithScores: vi.fn().mockResolvedValue([]),
    pExpire: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

const opts = {
  namespace: "test:ns",
  identifier: "10.0.0.1",
  windowMs: 60_000,
  max: 3,
};

beforeEach(() => {
  vi.mocked(getRedis).mockReset();
});

// ---------------------------------------------------------------------------
// Fail-open policy — Redis unavailable or throwing
// ---------------------------------------------------------------------------

describe("fail-open policy", () => {
  it("allows the request when Redis is unavailable (getRedis returns null)", async () => {
    vi.mocked(getRedis).mockResolvedValue(null);

    const result = await checkRateLimit(opts);

    expect(result.allowed).toBe(true);
    expect(result.failOpen).toBe(true);
    expect(result.count).toBe(0);
  });

  it("allows the request when Redis throws during peek", async () => {
    const client = makeRedis({
      zRemRangeByScore: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const result = await peekRateLimit(opts);

    expect(result.allowed).toBe(true);
    expect(result.failOpen).toBe(true);
  });

  it("swallows Redis errors during recordRateLimitHit", async () => {
    const client = makeRedis({
      zAdd: vi.fn().mockRejectedValue(new Error("boom")),
    });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    // Must not throw.
    await expect(recordRateLimitHit(opts)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// peekRateLimit — read-only semantics
// ---------------------------------------------------------------------------

describe("peekRateLimit", () => {
  it("does not record a hit (no zAdd)", async () => {
    const client = makeRedis({ zCard: vi.fn().mockResolvedValue(1) });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    await peekRateLimit(opts);

    expect(client.zAdd).not.toHaveBeenCalled();
    expect(client.pExpire).not.toHaveBeenCalled();
  });

  it("returns allowed:true with the current count when under limit", async () => {
    const client = makeRedis({ zCard: vi.fn().mockResolvedValue(2) });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const result = await peekRateLimit(opts);

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(2);
    expect(result.retryAfter).toBe(0);
  });

  it("returns allowed:false with retryAfter when count >= max", async () => {
    const now = Date.now();
    const client = makeRedis({
      zCard: vi.fn().mockResolvedValue(3),
      zRangeWithScores: vi
        .fn()
        .mockResolvedValue([{ value: "member", score: now - 10_000 }]),
    });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const result = await peekRateLimit(opts);

    expect(result.allowed).toBe(false);
    expect(result.count).toBe(3);
    // Window is 60s, oldest entry was 10s ago → ~50s remaining. Allow slop for
    // wall-clock drift between Date.now() in the test and in the limiter.
    expect(result.retryAfter).toBeGreaterThanOrEqual(45);
    expect(result.retryAfter).toBeLessThanOrEqual(55);
  });

  it("drops entries older than the window (zRemRangeByScore cutoff)", async () => {
    const client = makeRedis();
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const before = Date.now();
    await peekRateLimit(opts);

    expect(client.zRemRangeByScore).toHaveBeenCalledTimes(1);
    const [, minArg, maxArg] = client.zRemRangeByScore.mock.calls[0];
    expect(minArg).toBe("-inf");
    // Cutoff should be roughly now - windowMs.
    const expected = before - opts.windowMs;
    expect(maxArg).toBeGreaterThanOrEqual(expected - 1000);
    expect(maxArg).toBeLessThanOrEqual(expected + 1000);
  });
});

// ---------------------------------------------------------------------------
// recordRateLimitHit — write-only semantics
// ---------------------------------------------------------------------------

describe("recordRateLimitHit", () => {
  it("writes to zAdd and sets TTL, no read operations", async () => {
    const client = makeRedis();
    vi.mocked(getRedis).mockResolvedValue(client as never);

    await recordRateLimitHit(opts);

    expect(client.zAdd).toHaveBeenCalledTimes(1);
    expect(client.pExpire).toHaveBeenCalledTimes(1);
    expect(client.zCard).not.toHaveBeenCalled();
    expect(client.zRemRangeByScore).not.toHaveBeenCalled();
  });

  it("sets pExpire to windowMs * 2 (generous so bursty traffic keeps the key alive)", async () => {
    const client = makeRedis();
    vi.mocked(getRedis).mockResolvedValue(client as never);

    await recordRateLimitHit(opts);

    const [, ttl] = client.pExpire.mock.calls[0];
    expect(ttl).toBe(opts.windowMs * 2);
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit — composed peek-then-record
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  it("records a hit when allowed and increments reported count", async () => {
    const client = makeRedis({ zCard: vi.fn().mockResolvedValue(1) });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const result = await checkRateLimit(opts);

    expect(result.allowed).toBe(true);
    expect(result.count).toBe(2); // peek saw 1, +1 for this hit
    expect(client.zAdd).toHaveBeenCalledTimes(1);
  });

  it("does NOT record a hit when already at limit (prevents lockout spiral)", async () => {
    const now = Date.now();
    const client = makeRedis({
      zCard: vi.fn().mockResolvedValue(3),
      zRangeWithScores: vi
        .fn()
        .mockResolvedValue([{ value: "x", score: now - 5_000 }]),
    });
    vi.mocked(getRedis).mockResolvedValue(client as never);

    const result = await checkRateLimit(opts);

    expect(result.allowed).toBe(false);
    expect(client.zAdd).not.toHaveBeenCalled();
  });

  it("uses namespaced + hashed key (raw identifier never appears)", async () => {
    const client = makeRedis();
    vi.mocked(getRedis).mockResolvedValue(client as never);

    await checkRateLimit({
      ...opts,
      namespace: "login:ip",
      identifier: "203.0.113.42",
    });

    const key = client.zRemRangeByScore.mock.calls[0][0] as string;
    expect(key.startsWith("test:rl:login:ip:")).toBe(true);
    expect(key).not.toContain("203.0.113.42");
  });

  it("fails open without writing when Redis is unavailable", async () => {
    vi.mocked(getRedis).mockResolvedValue(null);

    const result = await checkRateLimit(opts);

    expect(result.allowed).toBe(true);
    expect(result.failOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ipFromRequest — header extraction
// ---------------------------------------------------------------------------

describe("ipFromRequest", () => {
  it("returns 'unknown' for undefined/null", () => {
    expect(ipFromRequest(undefined)).toBe("unknown");
    expect(ipFromRequest(null)).toBe("unknown");
  });

  it("returns 'unknown' when no headers object present", () => {
    expect(ipFromRequest({} as never)).toBe("unknown");
  });

  // the trusted client IP is the rightmost XFF entry (TRUSTED_PROXY_HOPS=1),
  // NOT the client-controlled leftmost value.
  it("uses the trusted (rightmost) x-forwarded-for entry, not the spoofable leftmost", () => {
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" },
    });
    expect(ipFromRequest(req)).toBe("10.0.0.2");
  });

  it("ignores a spoofed leftmost x-forwarded-for value", () => {
    // Attacker sets XFF: 1.2.3.4; the edge appends the real peer to the right.
    const req = new Request("https://example.com/", {
      headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.9" },
    });
    expect(ipFromRequest(req)).toBe("198.51.100.9");
  });

  it("collapses malformed IP input to the 'unknown' bucket", () => {
    const xff = new Request("https://example.com/", {
      headers: { "x-forwarded-for": "not-an-ip" },
    });
    expect(ipFromRequest(xff)).toBe("unknown");
    const real = new Request("https://example.com/", {
      headers: { "x-real-ip": "garbage" },
    });
    expect(ipFromRequest(real)).toBe("unknown");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://example.com/", {
      headers: { "x-real-ip": "198.51.100.9" },
    });
    expect(ipFromRequest(req)).toBe("198.51.100.9");
  });

  it("returns 'unknown' when neither header is present", () => {
    const req = new Request("https://example.com/");
    expect(ipFromRequest(req)).toBe("unknown");
  });
});
