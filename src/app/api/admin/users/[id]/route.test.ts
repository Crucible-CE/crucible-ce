// @vitest-environment node
// PATCH /api/admin/users/[id]: no self role change, and the last active
// administrator can be neither demoted nor deactivated (checked under a
// per-org advisory lock inside the update transaction).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), delete: vi.fn() },
    incident: { updateMany: vi.fn() },
    orgInvite: { deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { mockDb, mockAuth: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/security/activity-log", () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/socket/evict", () => ({ disconnectUserSockets: vi.fn() }));
vi.mock("@/lib/ics/token", () => ({ revokeIcsTokens: vi.fn().mockResolvedValue(0) }));

import { PATCH, DELETE } from "./route";
import { disconnectUserSockets } from "@/lib/socket/evict";

const { mockDb, mockAuth } = h;
const admin = { user: { id: "admin-1", email: "a@x", name: "A", organizationId: "org-1", role: "administrator" } };
const now = new Date();

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://x/api/admin/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(admin);
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockDb.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id, name: "T", email: "t@x", role: data.role ?? "administrator", isActive: data.isActive ?? true,
    lastLoginAt: null, createdAt: now, organizationId: "org-1",
  }));
});

describe("admin user PATCH guards", () => {
  it("rejects changing your own role", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "admin-1", organizationId: "org-1", role: "administrator", isActive: true });
    const res = await patch("admin-1", { role: "reader" });
    expect(res.status).toBe(400);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses to demote the last active administrator", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "admin-2", organizationId: "org-1", role: "administrator", isActive: true });
    mockDb.user.count.mockResolvedValue(0);
    const res = await patch("admin-2", { role: "contributor" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("refuses to deactivate the last active administrator", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "admin-2", organizationId: "org-1", role: "administrator", isActive: true });
    mockDb.user.count.mockResolvedValue(0);
    const res = await patch("admin-2", { isActive: false });
    expect(res.status).toBe(409);
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it("allows demoting an administrator when another active one remains", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "admin-2", organizationId: "org-1", role: "administrator", isActive: true });
    mockDb.user.count.mockResolvedValue(1);
    const res = await patch("admin-2", { role: "contributor" });
    expect(res.status).toBe(200);
    expect(mockDb.user.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: "administrator", isActive: true, id: { notIn: ["admin-2"] } },
    });
  });

  it("does not take the lock for non-admin targets", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "u-3", organizationId: "org-1", role: "reader", isActive: true });
    const res = await patch("u-3", { role: "contributor" });
    expect(res.status).toBe(200);
    expect(mockDb.user.count).not.toHaveBeenCalled();
  });
});

describe("admin user DELETE (#13 last-admin lock, #4 socket eviction)", () => {
  function del(id: string, confirmEmail: string) {
    return DELETE(
      new Request(`http://x/api/admin/users/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmEmail }) }),
      { params: Promise.resolve({ id }) },
    );
  }
  const target = (role: string) => ({ id: "u-9", email: "t@x", name: "T", role, organizationId: "org-1", _count: { reportedIncidents: 0 } });

  it("refuses to delete the last ACTIVE admin, checked under the advisory lock inside the tx", async () => {
    mockDb.user.findUnique.mockResolvedValue(target("administrator"));
    mockDb.user.count.mockResolvedValue(0);
    const res = await del("u-9", "t@x");
    expect(res.status).toBe(409);
    expect(mockDb.$transaction).toHaveBeenCalled();
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    expect(mockDb.user.count).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: "administrator", isActive: true, id: { notIn: ["u-9"] } },
    });
    expect(mockDb.user.delete).not.toHaveBeenCalled();
    expect(disconnectUserSockets).not.toHaveBeenCalled();
  });

  it("deletes an admin when another active admin remains, and disconnects their sockets", async () => {
    mockDb.user.findUnique.mockResolvedValue(target("administrator"));
    mockDb.user.count.mockResolvedValue(1);
    const res = await del("u-9", "t@x");
    expect(res.status).toBe(200);
    expect(mockDb.user.delete).toHaveBeenCalledWith({ where: { id: "u-9" } });
    expect(disconnectUserSockets).toHaveBeenCalledWith("u-9");
  });

  it("non-admin target: no lock, still disconnects sockets", async () => {
    mockDb.user.findUnique.mockResolvedValue(target("contributor"));
    const res = await del("u-9", "T@X ");
    expect(res.status).toBe(200);
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    expect(disconnectUserSockets).toHaveBeenCalledWith("u-9");
  });
});
