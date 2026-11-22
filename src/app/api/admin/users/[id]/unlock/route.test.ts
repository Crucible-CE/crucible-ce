// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  mockAuth: vi.fn(),
  clear: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: h.findUnique } } }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.audit }));
vi.mock("@/lib/security/login-throttle", () => ({ clearLoginThrottleForEmail: h.clear }));

import { POST } from "./route";

const admin = { user: { id: "admin-1", email: "a@x", name: "A", organizationId: "org-1", role: "administrator" } };
const call = (id = "u2") => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.mockAuth.mockResolvedValue(admin);
  h.findUnique.mockResolvedValue({ id: "u2", email: "b@x", organizationId: "org-1" });
  h.clear.mockResolvedValue(3);
});

describe("POST /api/admin/users/[id]/unlock", () => {
  it("clears the user's email-keyed throttle and audits it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.clear).toHaveBeenCalledWith("b@x");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.signin_unlocked", targetId: "u2", organizationId: "org-1" }));
  });

  it("refuses non-admins and other orgs' users", async () => {
    h.mockAuth.mockResolvedValue({ user: { ...admin.user, role: "contributor" } });
    expect((await call()).status).toBe(403);
    h.mockAuth.mockResolvedValue(admin);
    h.findUnique.mockResolvedValue({ id: "u2", email: "b@x", organizationId: "org-2" });
    expect((await call()).status).toBe(404);
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("503s when Redis is unavailable", async () => {
    h.clear.mockResolvedValue(null);
    expect((await call()).status).toBe(503);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
