// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  admin: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  activity: vi.fn(),
  removeAll: vi.fn(),
  loadFactors: vi.fn(),
  evict: vi.fn(),
  stepUp: vi.fn(),
  email: vi.fn(),
}));
vi.mock("@/lib/auth/admin-guard", () => ({ getAdminContext: h.admin }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: h.findUnique, update: h.update } } }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.audit }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.activity }));
vi.mock("@/lib/socket/evict", () => ({ disconnectUserSockets: h.evict }));
vi.mock("@/lib/auth/mfa/http", () => ({ requireAdminReauth: h.stepUp }));
vi.mock("@/lib/email/send-mfa-reset", () => ({ sendMfaResetEmail: h.email }));
vi.mock("@/lib/email/transport", () => ({ activeEmailTransport: () => "smtp" }));
vi.mock("@/lib/auth/mfa/service", () => ({
  removeAllMfa: h.removeAll,
  loadFactors: h.loadFactors,
  hasAnyFactor: (f: { totp: boolean; webauthnCount: number }) => f.totp || f.webauthnCount > 0,
}));

import { POST } from "./route";

const call = (id = "u2") => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.admin.mockResolvedValue({ userId: "admin-1", organizationId: "org-1", email: "a@x", name: "A" });
  h.findUnique.mockResolvedValue({ id: "u2", email: "b@x", name: "B", role: "contributor", organizationId: "org-1" });
  h.stepUp.mockResolvedValue(null);
  h.loadFactors.mockResolvedValue({ totp: true, webauthnCount: 1, recoveryRemaining: 8 });
});

describe("POST /api/admin/users/[id]/mfa-reset", () => {
  it("removes every factor, ends the member's sessions, and audits it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.removeAll).toHaveBeenCalledWith("u2");
    expect(h.update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { tokenVersion: { increment: 1 } } });
    expect(h.evict).toHaveBeenCalledWith("u2");
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.mfa_reset",
        targetId: "u2",
        organizationId: "org-1",
        metadata: { hadMfa: true, totp: true, securityKeys: 1, targetRole: "contributor", emailSent: true },
      }),
    );
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa.reset_by_admin", userId: "u2" }));
  });

  it("needs the admin's own step-up grant", async () => {
    h.stepUp.mockResolvedValueOnce(new Response(JSON.stringify({ code: "reauth_required" }), { status: 403 }));
    expect((await call()).status).toBe(403);
    expect(h.removeAll).not.toHaveBeenCalled();
    expect(h.stepUp).toHaveBeenCalledWith(expect.any(Request), "admin-1");
  });

  it("emails the member; another administrator can be reset too (audited with the role)", async () => {
    h.findUnique.mockResolvedValue({ id: "u2", email: "b@x", name: "B", role: "administrator", organizationId: "org-1" });
    expect((await call()).status).toBe(200);
    expect(h.email).toHaveBeenCalledWith("b@x", "B", "A");
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ targetRole: "administrator" }) }));
  });

  it("a failed email doesn't block the reset; the audit says it wasn't sent", async () => {
    h.email.mockRejectedValueOnce(new Error("smtp down"));
    expect((await call()).status).toBe(200);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ emailSent: false }) }));
  });

  it("refuses non-admins, other orgs' users and the admin's own account", async () => {
    h.admin.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(403);
    h.findUnique.mockResolvedValueOnce({ id: "u2", email: "b@x", name: "B", role: "contributor", organizationId: "org-2" });
    expect((await call()).status).toBe(404);
    expect((await call("admin-1")).status).toBe(400);
    expect(h.removeAll).not.toHaveBeenCalled();
  });
});
