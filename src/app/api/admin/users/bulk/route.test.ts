// @vitest-environment node
// POST /api/admin/users/bulk — bulk deactivate must not remove the last active
// administrator, decided under the same per-org advisory lock as PATCH/DELETE.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    user: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { mockDb, mockAuth: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/socket/evict", () => ({ disconnectUserSockets: vi.fn() }));
vi.mock("@/lib/ics/token", () => ({ revokeIcsTokens: vi.fn().mockResolvedValue(0) }));

import { POST } from "./route";
import { disconnectUserSockets } from "@/lib/socket/evict";

const { mockDb, mockAuth } = h;

function post(body: unknown) {
  return POST(new Request("http://x/api/admin/users/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "admin-1", email: "a@x", organizationId: "org-1", role: "administrator" } });
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockDb.user.findMany.mockResolvedValue([
    { id: "admin-2", email: "b@x", organizationId: "org-1" },
    { id: "u-3", email: "c@x", organizationId: "org-1" },
  ]);
  mockDb.user.updateMany.mockResolvedValue({ count: 2 });
});

describe("bulk deactivate last-admin guard", () => {
  it("409s when no active administrator would remain (under the advisory lock)", async () => {
    mockDb.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const res = await post({ userIds: ["admin-2", "u-3"], action: "deactivate" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("last_admin");
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    expect(mockDb.user.count).toHaveBeenLastCalledWith({
      where: { organizationId: "org-1", role: "administrator", isActive: true, id: { notIn: ["admin-2", "u-3"] } },
    });
    expect(mockDb.user.updateMany).not.toHaveBeenCalled();
    expect(disconnectUserSockets).not.toHaveBeenCalled();
  });

  it("deactivates when another admin remains", async () => {
    mockDb.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const res = await post({ userIds: ["admin-2", "u-3"], action: "deactivate" });
    expect(res.status).toBe(200);
    expect(mockDb.user.updateMany).toHaveBeenCalled();
    expect(disconnectUserSockets).toHaveBeenCalledTimes(2);
  });

  it("does not take the lock when the batch has no active admins", async () => {
    mockDb.user.count.mockResolvedValueOnce(0);
    const res = await post({ userIds: ["admin-2", "u-3"], action: "deactivate" });
    expect(res.status).toBe(200);
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
  });
});
