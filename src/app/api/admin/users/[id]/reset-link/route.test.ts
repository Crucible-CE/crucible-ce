// @vitest-environment node
// Admin "Copy reset link", run against an in-memory token store together with
// the real reset-password route, so issue + consume are tested end to end.
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";

const h = vi.hoisted(() => ({
  admin: vi.fn(),
  stepUp: vi.fn(),
  audit: vi.fn(),
  limit: vi.fn(),
}));
vi.mock("@/lib/db", async () => (await import("@/test/reset-db")).dbModule);
vi.mock("@/lib/auth/admin-guard", () => ({ getAdminContext: h.admin }));
vi.mock("@/lib/auth/mfa/http", () => ({ requireAdminReauth: h.stepUp }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.audit }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: h.limit, ipFromRequest: () => "1.2.3.4" }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/security/login-throttle", () => ({ clearLoginThrottleForEmail: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("new-hash") } }));

import { resetDb } from "@/test/reset-db";
import { POST } from "./route";
import { POST as consume } from "@/app/api/public/reset-password/route";

const create = (id = "u2") => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const use = (token: string) =>
  consume(
    new Request("http://x/api/public/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "a-new-password-1" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetDb.reset();
  process.env.PUBLIC_URL = "https://crucible.example.test";
  h.admin.mockResolvedValue({ userId: "admin-1", organizationId: "org-1", email: "a@x", name: "Ada" });
  h.stepUp.mockResolvedValue(null);
  h.limit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  resetDb.addUser({ id: "admin-1", email: "a@x", name: "Ada", role: "administrator" });
  resetDb.addUser({ id: "u2", email: "bo@x", name: "Bo" });
});

describe("POST /api/admin/users/[id]/reset-link", () => {
  it("needs the admin's own step-up grant, before anything is created", async () => {
    h.stepUp.mockResolvedValueOnce(new Response(JSON.stringify({ code: "reauth_required" }), { status: 403 }));
    const res = await create();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "reauth_required" });
    expect(h.stepUp).toHaveBeenCalledWith(expect.any(Request), "admin-1");
    expect(resetDb.tokens.size).toBe(0);
  });

  it("refuses non-admins, your own account, other orgs and deactivated members", async () => {
    h.admin.mockResolvedValueOnce(null);
    expect((await create()).status).toBe(403);
    const self = await create("admin-1");
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "Change your own password in Settings." });
    resetDb.addUser({ id: "u3", email: "c@x", organizationId: "org-2" });
    expect((await create("u3")).status).toBe(404);
    resetDb.addUser({ id: "u4", email: "d@x", isActive: false });
    expect((await create("u4")).status).toBe(400);
    expect(resetDb.tokens.size).toBe(0);
  });

  it("is rate limited per admin", async () => {
    h.limit.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });
    const res = await create();
    expect(res.status).toBe(429);
    expect(h.limit).toHaveBeenCalledWith(expect.objectContaining({ identifier: "admin-1" }));
    expect(resetDb.tokens.size).toBe(0);
  });

  it("returns a PUBLIC_URL link; only the token's hash is stored, for 1 hour", async () => {
    const res = await create();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; expiresAt: string };
    expect(body.url).toMatch(/^https:\/\/crucible\.example\.test\/reset-password\?token=[0-9a-f]{64}$/);
    const token = tokenOf(body.url);
    const [row] = [...resetDb.tokens.values()];
    expect(resetDb.tokens.size).toBe(1);
    expect(row.identifier).toBe("reset:bo@x");
    expect(row.token).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(row.token).not.toBe(token);
    const ttl = row.expires.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(59 * 60_000);
    expect(ttl).toBeLessThanOrEqual(60 * 60_000);
  });

  it("is audited without the token", async () => {
    const { url } = (await (await create()).json()) as { url: string };
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.reset_link_created", actorUserId: "admin-1", targetId: "u2", targetLabel: "bo@x", organizationId: "org-1" }),
    );
    const logged = JSON.stringify(h.audit.mock.calls);
    expect(logged).not.toContain(tokenOf(url));
    expect(logged).not.toContain(resetDb.tokens.keys().next().value);
  });

  it("works once, and a newer link makes the older one stop working", async () => {
    const first = tokenOf(((await (await create()).json()) as { url: string }).url);
    const second = tokenOf(((await (await create()).json()) as { url: string }).url);
    expect(resetDb.tokens.size).toBe(1);

    expect((await use(first)).status).toBe(400);
    const ok = await use(second);
    expect(ok.status).toBe(200);
    const bo = resetDb.users.get("u2")!;
    expect(bo.passwordHash).toBe("new-hash");
    // Every existing session ends.
    expect(bo.tokenVersion).toBe(2);
    // Single use.
    expect((await use(second)).status).toBe(400);
  });
});
