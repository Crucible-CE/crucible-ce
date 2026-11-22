// status-update reversibility: edit is ledgered with prior text;
// unpublish is soft + additive (the original publish event is retained).
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
  incidentRoleAssignment: { findFirst: vi.fn().mockResolvedValue(null) },
  incidentStatusUpdate: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
};
vi.mock("@/lib/db", () => ({ db: mockDb }));

const params = Promise.resolve({ id: "inc-1", updateId: "su-1" });
const session = { user: { id: "u-1", email: "u@example.com", name: "U", organizationId: "org-1" } };

function patchReq(body: Record<string, unknown>) {
  return new Request("http://x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue(session);
  mockHasPermission.mockReset().mockReturnValue(true);
  mockAppendLedger.mockClear();
  mockDb.incident.findFirst.mockReset().mockResolvedValue({ id: "inc-1", restricted: false });
  mockDb.incidentStatusUpdate.findFirst.mockReset();
  mockDb.incidentStatusUpdate.update.mockReset();
  mockDb.incidentStatusUpdate.updateMany.mockReset();
});

describe("PATCH /api/incidents/[id]/status-updates/[updateId] — edit", () => {
  it("edits body/headline, stamps editedAt, and ledgers the prior text", async () => {
    mockDb.incidentStatusUpdate.findFirst.mockResolvedValueOnce({
      id: "su-1", headline: "Old headline", body: "Old body", audience: "public", unpublishedAt: null,
    });
    mockDb.incidentStatusUpdate.update.mockResolvedValueOnce({ id: "su-1" });
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ body: "New body" }), { params });

    expect(res.status).toBe(200);
    expect(mockDb.incidentStatusUpdate.update).toHaveBeenCalledWith({
      where: { id: "su-1" },
      data: { body: "New body", editedAt: expect.any(Date) },
    });
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "status_update_edited",
        payload: expect.objectContaining({ previousHeadline: "Old headline", previousBody: "Old body" }),
      }),
    );
  });

  it("409s an edit of an unpublished update", async () => {
    mockDb.incidentStatusUpdate.findFirst.mockResolvedValueOnce({
      id: "su-1", headline: "h", body: "b", audience: "public", unpublishedAt: new Date(),
    });
    const { PATCH } = await import("./route");
    const res = await PATCH(patchReq({ body: "New body" }), { params });
    expect(res.status).toBe(409);
    expect(mockDb.incidentStatusUpdate.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/incidents/[id]/status-updates/[updateId]/unpublish — retract", () => {
  it("sets unpublishedAt via guarded updateMany and ledgers status_update_unpublished (publish event untouched)", async () => {
    mockDb.incidentStatusUpdate.findFirst.mockResolvedValueOnce({ id: "su-1", headline: "h", audience: "public" });
    mockDb.incidentStatusUpdate.updateMany.mockResolvedValueOnce({ count: 1 });
    const { POST } = await import("./unpublish/route");
    const res = await POST(new Request("http://x", { method: "POST" }), { params });

    expect(res.status).toBe(200);
    // Additive retraction: a NEW ledger event; nothing deletes or rewrites
    // the original status_update_published row.
    expect(mockAppendLedger).toHaveBeenCalledTimes(1);
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "status_update_unpublished" }),
    );
    expect(mockDb.incidentStatusUpdate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ unpublishedAt: null }) }),
    );
  });

  it("double unpublish is a 409 no-op (guarded count 0)", async () => {
    mockDb.incidentStatusUpdate.findFirst.mockResolvedValueOnce({ id: "su-1", headline: "h", audience: "public" });
    mockDb.incidentStatusUpdate.updateMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import("./unpublish/route");
    const res = await POST(new Request("http://x", { method: "POST" }), { params });
    expect(res.status).toBe(409);
    expect(mockAppendLedger).not.toHaveBeenCalled();
  });
});
