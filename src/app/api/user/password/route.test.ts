// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  compare: vi.fn(),
  peek: vi.fn(),
  hit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: h.findUnique, update: h.update } } }));
vi.mock("bcryptjs", () => ({ default: { compare: h.compare, hash: vi.fn().mockResolvedValue("new-hash") } }));
vi.mock("@/lib/security/rate-limit", () => ({
  ipFromRequest: () => "1.2.3.4",
  peekRateLimit: h.peek,
  recordRateLimitHit: h.hit,
}));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: vi.fn() }));

import { POST } from "./route";

const body = { currentPassword: "old", newPassword: "new-password-1", confirmPassword: "new-password-1" };
const call = () =>
  POST(new Request("http://x/api/user/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1" } });
  h.findUnique.mockResolvedValue({ id: "u1", passwordHash: "hash", organizationId: "org-1" });
  h.peek.mockResolvedValue({ allowed: true, retryAfter: 0 });
});

describe("POST /api/user/password current-password throttle", () => {
  it("counts a wrong current password against the per-user and per-IP limits", async () => {
    h.compare.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(400);
    expect(h.hit).toHaveBeenCalledTimes(2);
    const namespaces = h.hit.mock.calls.map((c) => c[0].namespace).sort();
    expect(namespaces).toEqual(["password-change:ip", "password-change:user"]);
  });

  it("429s without running bcrypt once a limit is reached", async () => {
    h.peek.mockResolvedValueOnce({ allowed: false, retryAfter: 120 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(h.compare).not.toHaveBeenCalled();
  });

  it("a correct password is not counted", async () => {
    h.compare.mockResolvedValue(true);
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.hit).not.toHaveBeenCalled();
  });
});
