// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  admin: vi.fn(),
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  audit: vi.fn(),
  hasMfa: vi.fn(),
  without: vi.fn(),
  signOut: vi.fn(),
  activity: vi.fn(),
  stepUp: vi.fn(),
}));
vi.mock("@/lib/auth/admin-guard", () => ({ getAdminContext: h.admin }));
vi.mock("@/lib/db", () => ({ db: { organization: { findUnique: h.orgFind, update: h.orgUpdate } } }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.audit }));
vi.mock("@/lib/auth/mfa/service", () => ({ userHasMfa: h.hasMfa }));
vi.mock("@/lib/auth/mfa/org-status", () => ({ countMembersWithoutMfa: h.without, signOutMembersWithoutMfa: h.signOut }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: h.activity }));
vi.mock("@/lib/auth/mfa/http", () => ({ requireAdminReauth: h.stepUp }));

import { GET, PUT } from "./route";

const put = (requireMfa: unknown) =>
  PUT(new Request("http://x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requireMfa }) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.admin.mockResolvedValue({ userId: "admin-1", organizationId: "org-1", email: "a@x", name: "A" });
  h.orgFind.mockResolvedValue({ requireMfa: false });
  h.without.mockResolvedValue(3);
  h.signOut.mockResolvedValue(["u2", "u3", "u4"]);
  h.stepUp.mockResolvedValue(null);
});

describe("/api/admin/security-policy", () => {
  it("GET reports the policy and members without MFA", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ requireMfa: false, membersWithoutMfa: 3 });
  });

  it("an admin without MFA can't turn it on (no self lock-out)", async () => {
    h.hasMfa.mockResolvedValue(false);
    const res = await put(true);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("actor_needs_mfa");
    expect(h.orgUpdate).not.toHaveBeenCalled();
  });

  it("turning it on signs out members without MFA (not the admin) and audits the count; a no-op does neither", async () => {
    h.hasMfa.mockResolvedValue(true);
    const res = await put(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ requireMfa: true, membersSignedOut: 3 });
    expect(h.orgUpdate).toHaveBeenCalledWith({ where: { id: "org-1" }, data: { requireMfa: true } });
    expect(h.signOut).toHaveBeenCalledWith("org-1", "admin-1");
    expect(h.activity).toHaveBeenCalledTimes(3);
    expect(h.activity).toHaveBeenCalledWith(expect.objectContaining({ action: "session.revoked", userId: "u2", metadata: expect.objectContaining({ reason: "require_mfa_enabled" }) }));
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "org.require_mfa_enabled", organizationId: "org-1", metadata: { requireMfa: true, membersWithoutMfa: 3, membersSignedOut: 3 } }),
    );
    h.audit.mockClear();
    h.signOut.mockClear();
    h.orgFind.mockResolvedValue({ requireMfa: true });
    await put(true);
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("turning it off needs no MFA check and is audited", async () => {
    h.orgFind.mockResolvedValue({ requireMfa: true });
    expect((await put(false)).status).toBe(200);
    expect(h.hasMfa).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "org.require_mfa_disabled" }));
  });

  it("changing the policy needs the admin's own step-up grant", async () => {
    h.stepUp.mockResolvedValueOnce(new Response(JSON.stringify({ code: "reauth_required" }), { status: 403 }));
    expect((await put(true)).status).toBe(403);
    expect(h.orgUpdate).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("refuses non-admins and bad bodies", async () => {
    h.admin.mockResolvedValueOnce(null);
    expect((await put(true)).status).toBe(403);
    expect((await put("yes")).status).toBe(400);
  });
});
