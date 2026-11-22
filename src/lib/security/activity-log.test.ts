import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These cases exercise the behind-one-proxy path (CE default is 0 hops).
vi.hoisted(() => { process.env.TRUSTED_PROXY_HOPS = "1"; });

// The auth/security activity trail. Fire-and-forget (never throws), and IP and
// email hashes fail CLOSED without a salt.

const create = vi.fn();

vi.mock("@/lib/db", () => ({ db: { userActivityLog: { create } } }));

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/login", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ACTIVITY_IP_SALT", "test-salt");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deriveActivityIp", () => {
  it("hashes the client IP and keeps the last octet", async () => {
    const { deriveActivityIp } = await import("./activity-log");
    const ip = deriveActivityIp(reqWith({ "x-forwarded-for": "203.0.113.42" }));
    expect(ip.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ip.ipLastOctet).toBe("42");
  });

  it("returns nulls when there is no request or no derivable IP", async () => {
    const { deriveActivityIp } = await import("./activity-log");
    expect(deriveActivityIp(null)).toEqual({ ipHash: null, ipLastOctet: null });
    expect(deriveActivityIp(reqWith({}))).toEqual({ ipHash: null, ipLastOctet: null });
  });

  it("fails closed to a NULL hash when the salt is unset", async () => {
    vi.stubEnv("ACTIVITY_IP_SALT", "");
    const { deriveActivityIp } = await import("./activity-log");
    const ip = deriveActivityIp(reqWith({ "x-forwarded-for": "203.0.113.42" }));
    expect(ip.ipHash).toBeNull();
    // Last octet is still useful triage signal without being the full IP.
    expect(ip.ipLastOctet).toBe("42");
  });
});

describe("recordActivity", () => {
  it("writes org-scoped rows with the organizationId", async () => {
    const { recordActivity } = await import("./activity-log");
    await recordActivity({ action: "login.success", userId: "u-1", organizationId: "org-1" });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data).toMatchObject({
      action: "login.success",
      userId: "u-1",
      organizationId: "org-1",
    });
  });

  it("writes null-org rows with a hashed email, never the raw address", async () => {
    const { recordActivity } = await import("./activity-log");
    await recordActivity({ action: "login.failure", userId: null, email: "Probe@Example.com" });

    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.organizationId).toBeNull();
    expect(data.emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain("Probe@Example.com");
    expect(JSON.stringify(data)).not.toContain("probe@example.com");
  });

  it("NEVER throws — a DB failure logs and the auth flow proceeds", async () => {
    create.mockRejectedValue(new Error("db down"));
    const { recordActivity } = await import("./activity-log");
    await expect(
      recordActivity({ action: "login.success", userId: "u-1", organizationId: "org-1" }),
    ).resolves.toBeUndefined();
  });

  it("truncates the user agent and prefers pre-derived IP fields", async () => {
    const { recordActivity } = await import("./activity-log");
    await recordActivity({
      action: "login.success",
      userId: "u-1",
      organizationId: "org-1",
      req: reqWith({ "user-agent": "x".repeat(2000) }),
      ip: { ipHash: "stashed-hash", ipLastOctet: "7" },
    });

    const data = create.mock.calls[0][0].data;
    expect(data.userAgent).toHaveLength(512);
    expect(data.ipHash).toBe("stashed-hash");
    expect(data.ipLastOctet).toBe("7");
  });
});
