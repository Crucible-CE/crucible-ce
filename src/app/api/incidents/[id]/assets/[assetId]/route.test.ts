// soft-delete + restore semantics for incident assets. The same
// claim/restore convention is shared by actions + indicators; this pins the
// reference implementation.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));

const mockHasPermission = vi.fn();
vi.mock("@/lib/auth/rbac", () => ({ hasPermission: mockHasPermission }));

vi.mock("@/lib/incident/access", () => ({ accessibleIncidentsWhere: () => ({}) }));

const mockAppendLedger = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ledger/append", () => ({ appendLedger: mockAppendLedger }));

const mockDb = {
  incident: { findFirst: vi.fn() },
  incidentRoleAssignment: { findFirst: vi.fn() },
  incidentAsset: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
};
vi.mock("@/lib/db", () => ({ db: mockDb }));

const params = Promise.resolve({ id: "inc-1", assetId: "asset-1" });
const session = { user: { id: "u-1", email: "u@example.com", name: "U", organizationId: "org-1" } };

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue(session);
  mockHasPermission.mockReset().mockReturnValue(true);
  mockAppendLedger.mockClear();
  mockDb.incident.findFirst.mockReset().mockResolvedValue({ id: "inc-1", restricted: false });
  mockDb.incidentRoleAssignment.findFirst.mockReset().mockResolvedValue(null);
  mockDb.incidentAsset.findFirst.mockReset();
  mockDb.incidentAsset.update.mockReset();
  mockDb.incidentAsset.updateMany.mockReset();
});

describe("DELETE /api/incidents/[id]/assets/[assetId] — soft delete (C3)", () => {
  it("tombstones the row (deletedAt) inside a transaction with an asset_deleted ledger event", async () => {
    mockDb.incidentAsset.findFirst.mockResolvedValueOnce({ id: "asset-1", name: "web-01" });
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, undoToken: "asset-1" });
    expect(mockDb.incidentAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      data: { deletedAt: expect.any(Date) },
    });
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "asset_deleted" }),
    );
  });

  it("404s an already-deleted asset (lookup filters deletedAt: null)", async () => {
    mockDb.incidentAsset.findFirst.mockResolvedValueOnce(null);
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params });
    expect(res.status).toBe(404);
    expect(mockDb.incidentAsset.update).not.toHaveBeenCalled();
    // The where clause must exclude tombstoned rows.
    expect(mockDb.incidentAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it("403s with the incident_locked code when the incident is locked", async () => {
    mockDb.incident.findFirst.mockResolvedValueOnce({ id: "inc-1", restricted: true });
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("incident_locked");
    expect(mockDb.incidentAsset.update).not.toHaveBeenCalled();
  });

  it("lets the incident commander write to a locked incident", async () => {
    mockDb.incident.findFirst.mockResolvedValueOnce({ id: "inc-1", restricted: true });
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValueOnce({ id: "ra-1" });
    mockDb.incidentAsset.findFirst.mockResolvedValueOnce({ id: "asset-1", name: "web-01" });
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params });
    expect(res.status).toBe(200);
  });

  it("lets an administrator write to a locked incident", async () => {
    mockAuth.mockResolvedValueOnce({ user: { ...session.user, role: "administrator" } });
    mockDb.incident.findFirst.mockResolvedValueOnce({ id: "inc-1", restricted: true });
    mockDb.incidentAsset.findFirst.mockResolvedValueOnce({ id: "asset-1", name: "web-01" });
    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params });
    expect(res.status).toBe(200);
    expect(mockDb.incidentRoleAssignment.findFirst).not.toHaveBeenCalled();
  });
});

describe("POST /api/incidents/[id]/assets/[assetId]/restore — undo (C3)", () => {
  it("restores via guarded updateMany and ledgers asset_restored", async () => {
    mockDb.incidentAsset.updateMany.mockResolvedValueOnce({ count: 1 });
    const { POST } = await import("./restore/route");
    const res = await POST(new Request("http://x", { method: "POST" }), { params });

    expect(res.status).toBe(200);
    expect(mockDb.incidentAsset.updateMany).toHaveBeenCalledWith({
      where: { id: "asset-1", incidentId: "inc-1", organizationId: "org-1", deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "asset_restored" }),
    );
  });

  it("double restore is a clean 404 no-op (guarded count 0, no ledger event)", async () => {
    mockDb.incidentAsset.updateMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import("./restore/route");
    const res = await POST(new Request("http://x", { method: "POST" }), { params });
    expect(res.status).toBe(404);
    expect(mockAppendLedger).not.toHaveBeenCalled();
  });
});

describe("GET /api/incidents/[id]/assets — read-site audit (C3)", () => {
  it("never returns tombstoned rows", async () => {
    mockDb.incidentAsset.findMany = vi.fn().mockResolvedValueOnce([]);
    const { GET } = await import("../route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "inc-1" }) });
    expect(res.status).toBe(200);
    expect(mockDb.incidentAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentId: "inc-1", deletedAt: null } }),
    );
  });
});
