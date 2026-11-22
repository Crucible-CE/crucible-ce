import { describe, it, expect, afterEach } from "vitest";
import {
  getClientIp,
  selectFromXff,
  normalizeIp,
  ipToBigInt,
  resolveTrustedProxyHops,
  TRUSTED_PROXY_HOPS,
} from "./client-ip";

// The CE default is TRUSTED_PROXY_HOPS=0 (no proxy trusted). Behaviour behind a
// proxy is exercised by passing hops explicitly (third getClientIp argument).
const reqWith = (headers: Record<string, string>) => new Request("https://x/", { headers });

describe("resolveTrustedProxyHops", () => {
  it("defaults to 0 when unset, blank, or garbage", () => {
    expect(resolveTrustedProxyHops(undefined)).toBe(0);
    expect(resolveTrustedProxyHops("")).toBe(0);
    expect(resolveTrustedProxyHops("nope")).toBe(0);
  });
  it("parses and clamps to 0..10", () => {
    expect(resolveTrustedProxyHops("1")).toBe(1);
    expect(resolveTrustedProxyHops("2")).toBe(2);
    expect(resolveTrustedProxyHops("-3")).toBe(0);
    expect(resolveTrustedProxyHops("99")).toBe(10);
  });
  it("the module constant is the parsed TRUSTED_PROXY_HOPS env (0 when unset)", () => {
    expect(TRUSTED_PROXY_HOPS).toBe(resolveTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS));
  });
});

describe("selectFromXff", () => {
  it("takes the rightmost entry at hops=1", () => {
    expect(selectFromXff("1.1.1.1, 2.2.2.2", 1)).toBe("2.2.2.2");
    expect(selectFromXff("203.0.113.7, 10.0.0.1, 10.0.0.2", 1)).toBe("10.0.0.2");
  });
  it("takes the second-from-right at hops=2", () => {
    expect(selectFromXff("a, 10.0.0.1, 10.0.0.2", 2)).toBe("10.0.0.1");
  });
  it("returns null when the chain is shorter than hops, or hops=0", () => {
    expect(selectFromXff("9.9.9.9", 2)).toBeNull();
    expect(selectFromXff("", 1)).toBeNull();
    expect(selectFromXff("9.9.9.9", 0)).toBeNull();
  });
});

describe("normalizeIp", () => {
  it("strips IPv4 :port and validates", () => {
    expect(normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4");
  });
  it("strips IPv6 brackets/port", () => {
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
  });
  it("rejects non-IPs and non-canonical leading zeros", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("10.0.05.1")).toBeNull();
    expect(normalizeIp("999.1.1.1")).toBeNull();
  });
});

describe("getClientIp — 0 hops (CE default: no trusted proxy)", () => {
  it("ignores X-Forwarded-For entirely (client-settable without a proxy)", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4" }), "lenient", 0)).toBeNull();
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "strict", 0)).toBeNull();
  });
  it("does not trust x-real-ip either, even in lenient mode", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "8.8.8.8" }), "lenient", 0)).toBeNull();
  });
  it("uses the configured default when hops is omitted", () => {
    const req = reqWith({ "x-forwarded-for": "1.2.3.4" });
    expect(getClientIp(req)).toBe(getClientIp(req, "lenient", TRUSTED_PROXY_HOPS));
  });
});

describe("getClientIp — strict (allowlist path), behind one proxy", () => {
  it("returns the trusted rightmost token and ignores a spoofed leftmost", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "strict", 1)).toBe("5.6.7.8");
  });
  it("fails closed (null) on an empty chain, with NO x-real-ip fallback", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "", "x-real-ip": "8.8.8.8" }), "strict", 1)).toBeNull();
  });
  it("fails closed on a garbage trusted token (no fallback to x-real-ip)", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "garbage", "x-real-ip": "8.8.8.8" }), "strict", 1)).toBeNull();
  });
  it("fails closed when the chain is shorter than the configured hops", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "9.9.9.9" }), "strict", 2)).toBeNull();
  });
});

describe("getClientIp — lenient (rate-limit path), behind one proxy", () => {
  it("falls back to x-real-ip when XFF is unusable", () => {
    expect(getClientIp(reqWith({ "x-real-ip": "8.8.8.8" }), "lenient", 1)).toBe("8.8.8.8");
  });
  it("returns null (=> 'unknown' bucket) on all-garbage", () => {
    expect(getClientIp(reqWith({ "x-forwarded-for": "nope", "x-real-ip": "bad" }), "lenient", 1)).toBeNull();
  });
  it("returns null for missing/invalid request", () => {
    expect(getClientIp(undefined)).toBeNull();
    expect(getClientIp({} as never, "lenient", 1)).toBeNull();
  });
});

describe("ipToBigInt", () => {
  it("parses v4 and v6 with matching families", () => {
    expect(ipToBigInt("0.0.0.0")?.bits).toBe(32);
    expect(ipToBigInt("::1")?.bits).toBe(128);
    expect(ipToBigInt("::ffff:1.2.3.4")?.bits).toBe(128);
    expect(ipToBigInt("bad")).toBeNull();
  });
});

describe("zero hops: TCP peer address stamped by server.ts", () => {
  const NAME = "x-crucible-peer-0123456789abcdef01234567";
  afterEach(() => { delete process.env.CRUCIBLE_PEER_IP_HEADER; });

  it("uses the stamped peer address and ignores forwarding headers", () => {
    process.env.CRUCIBLE_PEER_IP_HEADER = NAME;
    const req = reqWith({ [NAME]: "::ffff:198.51.100.7", "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
    expect(getClientIp(req, "lenient", 0)).toBe("198.51.100.7");
    expect(getClientIp(req, "strict", 0)).toBe("198.51.100.7");
  });

  it("returns null when server.ts didn't stamp (plain next dev) or the name is malformed", () => {
    expect(getClientIp(reqWith({ [NAME]: "198.51.100.7" }), "lenient", 0)).toBeNull();
    process.env.CRUCIBLE_PEER_IP_HEADER = "x-real-ip";
    expect(getClientIp(reqWith({ "x-real-ip": "198.51.100.7" }), "lenient", 0)).toBeNull();
  });
});
