// @vitest-environment node
// First-run setup: the one-time setup code gate (missing / wrong / none active
// -> 403, right code -> 201 and burned), the users-exist refusal, and the
// advisory-lock race guard inside the transaction.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(),
    user: { count: vi.fn(), create: vi.fn() },
    organization: { create: vi.fn() },
  };
  const mockDb = {
    user: { count: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    tx,
    mockDb,
    checkRateLimit: vi.fn(),
    peekRateLimit: vi.fn(),
    recordRateLimitHit: vi.fn(),
    recordActivity: vi.fn(),
    recordAdminAuditLog: vi.fn(async () => {}),
    order: [] as string[],
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: h.checkRateLimit,
  peekRateLimit: h.peekRateLimit,
  recordRateLimitHit: h.recordRateLimitHit,
  ipFromRequest: () => "unknown",
}));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed-pw") } }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.recordActivity }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.recordAdminAuditLog }));
vi.mock("@/lib/exercise/library", () => ({ ensureExerciseLibrary: vi.fn(async () => true) }));

import { GET, POST } from "./route";
import {
  SETUP_ADVISORY_LOCK_KEY,
  hasActiveSetupCode,
  invalidateSetupCode,
  issueSetupCode,
  verifySetupCode,
} from "@/lib/setup/setup-code";

const { tx, mockDb } = h;

const body = {
  orgName: "Acme Security",
  name: "Jane Doe",
  email: "Jane@Example.com",
  password: "correct horse battery",
};

function post(payload: unknown) {
  return POST(
    new Request("http://x/api/public/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  invalidateSetupCode();
  h.checkRateLimit.mockResolvedValue({ allowed: true, count: 0, retryAfter: 0, failOpen: false });
  h.peekRateLimit.mockResolvedValue({ allowed: true, count: 0, retryAfter: 0, failOpen: false });
  h.recordRateLimitHit.mockResolvedValue(undefined);
  mockDb.user.count.mockResolvedValue(0);
  mockDb.$transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => {
    h.order.push("tx:begin");
    const out = await fn(tx);
    h.order.push("tx:commit");
    return out;
  });
  tx.$executeRaw.mockImplementation(async () => {
    h.order.push("lock");
    return 1;
  });
  tx.user.count.mockImplementation(async () => {
    h.order.push("count");
    return 0;
  });
  tx.organization.create.mockImplementation(async () => {
    h.order.push("org");
    return { id: "org-1", name: "Acme Security" };
  });
  tx.user.create.mockImplementation(async () => {
    h.order.push("user");
    return { id: "u-1", email: "jane@example.com", name: "Jane Doe" };
  });
});

describe("POST /api/public/setup — setup code gate", () => {
  it("403s when no setup code is active", async () => {
    const res = await post({ ...body, setupCode: "ABCD-EFGH-JKMN-PQRS" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/No setup code is active/);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(h.recordRateLimitHit).toHaveBeenCalledWith(expect.objectContaining({ namespace: expect.stringMatching(/^setup:code:ip:[0-9a-f]{16}$/) }));
  });

  it("403s when the code is missing", async () => {
    issueSetupCode();
    const res = await post(body);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Setup code required/);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("403s on a wrong code and counts the failure", async () => {
    const code = issueSetupCode();
    const wrong = code === "AAAA-AAAA-AAAA-AAAA" ? "BBBB-BBBB-BBBB-BBBB" : "AAAA-AAAA-AAAA-AAAA";
    const res = await post({ ...body, setupCode: wrong });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Invalid setup code/);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(h.recordRateLimitHit).toHaveBeenCalledTimes(1);
    expect(hasActiveSetupCode()).toBe(true); // a wrong guess does not burn the real code
  });

  it("429s once the dedicated code limiter trips (10 failures / 15 min)", async () => {
    issueSetupCode();
    h.peekRateLimit.mockResolvedValue({ allowed: false, count: 10, retryAfter: 600, failOpen: false });
    const res = await post({ ...body, setupCode: "whatever" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(h.peekRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: expect.stringMatching(/^setup:code:ip:[0-9a-f]{16}$/), windowMs: 15 * 60 * 1000, max: 10 }),
    );
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("creates the org + admin with the right code (normalized) and burns the code", async () => {
    const code = issueSetupCode();
    const res = await post({ ...body, setupCode: code.toLowerCase().replace(/-/g, " ") });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, email: "jane@example.com" });
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "jane@example.com", role: "administrator", organizationId: "org-1" }),
    });
    expect(h.recordRateLimitHit).not.toHaveBeenCalled();
    expect(hasActiveSetupCode()).toBe(false);
    expect(verifySetupCode(code)).toBe(false);
    expect(h.recordAdminAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "setup.completed", actorUserId: "u-1", organizationId: "org-1" }),
    );
    expect(h.recordActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "setup.completed", userId: "u-1" }));

    // The same code cannot be replayed.
    const replay = await post({ ...body, setupCode: code });
    expect(replay.status).toBe(403);
  });
});

describe("POST /api/public/setup — already set up / race guard", () => {
  it("410s when users already exist, before touching the code", async () => {
    const code = issueSetupCode();
    mockDb.user.count.mockResolvedValue(1);
    const res = await post({ ...body, setupCode: code });
    expect(res.status).toBe(410);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("takes the advisory xact lock inside the transaction BEFORE re-counting users", async () => {
    const code = issueSetupCode();
    const res = await post({ ...body, setupCode: code });
    expect(res.status).toBe(201);
    expect(h.order).toEqual(["tx:begin", "lock", "count", "org", "user", "tx:commit"]);
    const [strings, key] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, bigint];
    expect(strings.join("?")).toMatch(/SELECT pg_advisory_xact_lock\(\?\)/);
    expect(key).toBe(SETUP_ADVISORY_LOCK_KEY);
    expect(typeof key).toBe("bigint");
  });

  it("410s when a concurrent setup won the lock (users exist inside the tx)", async () => {
    const code = issueSetupCode();
    tx.user.count.mockResolvedValue(1);
    const res = await post({ ...body, setupCode: code });
    expect(res.status).toBe(410);
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(hasActiveSetupCode()).toBe(false);
  });

  it("keeps the code valid when the transaction fails, so the operator can retry", async () => {
    const code = issueSetupCode();
    tx.organization.create.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ ...body, setupCode: code });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(verifySetupCode(code)).toBe(true);
  });
});

describe("GET /api/public/setup", () => {
  it("lazily issues a setup code on a fresh install (no server.ts boot hook)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await GET();
    expect(await res.json()).toEqual({ needsSetup: true });
    expect(hasActiveSetupCode()).toBe(true);
    expect(spy.mock.calls.some(([m]) => String(m).includes("first-run setup code"))).toBe(true);
    spy.mockRestore();
  });

  it("issues nothing once users exist", async () => {
    mockDb.user.count.mockResolvedValue(2);
    const res = await GET();
    expect(await res.json()).toEqual({ needsSetup: false });
    expect(hasActiveSetupCode()).toBe(false);
  });
});
