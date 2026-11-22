// @vitest-environment node
// Incident lifecycle under the strict founder lock rule:
//   - POST /api/incidents enrols reporter + assignee as participants;
//   - PATCH assignedToId enrols the new assignee (inside the update tx);
//   - DELETE is an administrator-only SOFT delete (deletedAt/deletedById,
//     ledger + audit entry, open pages cancelled, sockets evicted);
//   - PATCH /restricted captures the IC at lock time and enforces M7 unlock.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    incident: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    incidentRoleAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    incidentActivity: { create: vi.fn() },
    icsFeedToken: { updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    mockDb,
    mockAuth: vi.fn(),
    mockAppendLedger: vi.fn(),
    mockEnsure: vi.fn(),
    mockAudit: vi.fn(),
    mockEvict: vi.fn(),
    mockCancelPages: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: h.mockAppendLedger }));
vi.mock("@/lib/incident/participants", () => ({ ensureIncidentParticipants: h.mockEnsure }));
vi.mock("@/lib/admin-audit", () => ({ recordAdminAuditLog: h.mockAudit }));
vi.mock("@/lib/socket/evict", () => ({ evictFromIncidentRoom: h.mockEvict }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/escalation/engine", () => ({ cancelOpenPagesForIncident: h.mockCancelPages }));
vi.mock("@/lib/incident/closure-gate", () => ({ evaluateClosureGate: vi.fn().mockResolvedValue({ blockers: [], requiresOverride: false }) }));

import { POST as createIncident } from "../route";
import { PATCH, DELETE } from "./route";
import { PATCH as PATCH_LOCK } from "./restricted/route";

const { mockDb, mockAuth, mockAppendLedger, mockEnsure, mockAudit, mockEvict, mockCancelPages } = h;
const params = Promise.resolve({ id: "inc-1" });
const contributor = (id = "u-1") => ({ user: { id, name: "C", email: "c@x", organizationId: "org-1", role: "contributor" } });
const admin = { user: { id: "a-1", name: "Ada", email: "a@x", organizationId: "org-1", role: "administrator" } };

function json(method: string, body?: unknown) {
  return new Request("http://x/api/incidents/inc-1", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockEnsure.mockResolvedValue(1);
  mockAudit.mockResolvedValue(undefined);
  mockEvict.mockResolvedValue(0);
  mockCancelPages.mockResolvedValue(0);
  mockDb.icsFeedToken.updateMany.mockResolvedValue({ count: 0 });
  mockDb.user.findUnique.mockResolvedValue({ id: "u-9", organizationId: "org-1", isActive: true, name: "C" });
});

describe("creation enrols reporter + assignee as participants", () => {
  it("POST /api/incidents", async () => {
    mockAuth.mockResolvedValue(contributor("u-1"));
    mockDb.incident.create.mockResolvedValue({ id: "inc-new" });
    const res = await createIncident(
      new Request("http://x/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "T", description: "D", assignedToId: "u-9" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(mockEnsure).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", incidentId: "inc-new", userIds: ["u-1", "u-9"] }),
    );
  });
});

describe("PATCH assignment enrols the assignee", () => {
  const existing = { id: "inc-1", organizationId: "org-1", title: "T", status: "investigating", restricted: false, assignedToId: null, bridgeUrl: null };

  it("enrols a NEW assignee inside the update transaction", async () => {
    mockAuth.mockResolvedValue(contributor());
    mockDb.incident.findFirst.mockResolvedValue(existing);
    mockDb.incident.update.mockResolvedValue({ ...existing, assignedToId: "u-9" });
    const res = await PATCH(json("PATCH", { assignedToId: "u-9" }), { params });
    expect(res.status).toBe(200);
    expect(mockEnsure).toHaveBeenCalledWith(
      expect.objectContaining({ incidentId: "inc-1", userIds: ["u-9"] }),
      mockDb,
    );
  });

  it("does not re-add an unchanged assignee (they may have been removed on purpose)", async () => {
    mockAuth.mockResolvedValue(contributor());
    mockDb.incident.findFirst.mockResolvedValue({ ...existing, assignedToId: "u-9" });
    mockDb.incident.update.mockResolvedValue({ ...existing, assignedToId: "u-9" });
    await PATCH(json("PATCH", { assignedToId: "u-9" }), { params });
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});

describe("DELETE = administrator-only soft delete", () => {
  it("403s a contributor", async () => {
    mockAuth.mockResolvedValue(contributor());
    const res = await DELETE(json("DELETE"), { params });
    expect(res.status).toBe(403);
    expect(mockDb.incident.updateMany).not.toHaveBeenCalled();
  });

  it("404s an incident the admin can't find (or already deleted)", async () => {
    mockAuth.mockResolvedValue(admin);
    mockDb.incident.findFirst.mockResolvedValue(null);
    expect((await DELETE(json("DELETE"), { params })).status).toBe(404);
    // the lookup excludes soft-deleted rows
    expect(mockDb.incident.findFirst.mock.calls[0][0].where).toMatchObject({ id: "inc-1", deletedAt: null });
  });

  it("soft-deletes: sets deletedAt/deletedById, ledgers, cancels pages, audits, evicts — never hard-deletes", async () => {
    mockAuth.mockResolvedValue(admin);
    mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "Phish", status: "investigating", organizationId: "org-1" });
    mockDb.incident.updateMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(json("DELETE", { reason: "duplicate" }), { params });
    expect(res.status).toBe(200);
    const upd = mockDb.incident.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "inc-1", organizationId: "org-1", deletedAt: null });
    expect(upd.data.deletedById).toBe("a-1");
    expect(upd.data.deletedAt).toBeInstanceOf(Date);
    expect(mockCancelPages).toHaveBeenCalledWith("inc-1", mockDb, "incident_deleted");
    expect(mockAppendLedger).toHaveBeenCalledWith(mockDb, expect.objectContaining({ eventType: "incident_deleted", payload: expect.objectContaining({ reason: "duplicate" }) }));
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "incident.delete", targetId: "inc-1", organizationId: "org-1" }));
    expect(mockEvict).toHaveBeenCalledWith("inc-1", { recheckAll: true });
    expect(mockDb.icsFeedToken.updateMany).toHaveBeenCalled();
  });

  it("a concurrent delete that lost the race 404s without a second ledger entry", async () => {
    mockAuth.mockResolvedValue(admin);
    mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "Phish", status: "investigating", organizationId: "org-1" });
    mockDb.incident.updateMany.mockResolvedValue({ count: 0 });
    expect((await DELETE(json("DELETE"), { params })).status).toBe(404);
    expect(mockAppendLedger).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("PATCH /restricted (lock capture + M7 unlock)", () => {
  // findAccessibleIncident -> db.incident.findUnique (gate select merged);
  // canManageIncidentLock / canUnlockIncidentFor -> db.incident.findUnique + IC lookup.
  function incidentRow(over: Record<string, unknown> = {}) {
    return {
      id: "inc-1",
      organizationId: "org-1",
      restricted: false,
      reportedById: "rep",
      assignedToId: "asg",
      lockedIcUserId: null,
      deletedAt: null,
      participants: [{ id: "p" }],
      roleAssignments: [],
      ...over,
    };
  }

  it("locking captures the seated IC, seeds the team (reporter, assignee, roles, locker) and evicts", async () => {
    mockAuth.mockResolvedValue(contributor("rep"));
    mockDb.incident.findUnique.mockResolvedValue(incidentRow());
    mockDb.incidentRoleAssignment.findFirst.mockImplementation(async (args: { where: { userId?: string } }) =>
      args.where.userId ? null : { userId: "ic-1" },
    );
    mockDb.incidentRoleAssignment.findMany.mockResolvedValue([{ userId: "ic-1" }, { userId: "scribe-1" }]);
    mockDb.incident.updateMany.mockResolvedValue({ count: 1 });
    const res = await PATCH_LOCK(json("PATCH", { restricted: true }), { params });
    expect(res.status).toBe(200);
    const upd = mockDb.incident.updateMany.mock.calls[0][0];
    expect(upd.where).toMatchObject({ id: "inc-1", restricted: false, deletedAt: null });
    expect(upd.data).toMatchObject({ restricted: true, lockedIcUserId: "ic-1" });
    expect(upd.data.lockedAt).toBeInstanceOf(Date);
    const seeded = mockEnsure.mock.calls[0][0].userIds as string[];
    expect(seeded).toEqual(expect.arrayContaining(["rep", "asg", "ic-1", "scribe-1"]));
    expect(mockEvict).toHaveBeenCalledWith("inc-1", { recheckAll: true });
  });

  it("unlock: a later IC (not the lock-time IC) is refused; lock state untouched", async () => {
    mockAuth.mockResolvedValue(contributor("ic-2"));
    mockDb.incident.findUnique.mockResolvedValue(incidentRow({ restricted: true, lockedIcUserId: "ic-1", participants: [], roleAssignments: [{ id: "r" }] }));
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ id: "r" }); // ic-2 holds the seat now
    const res = await PATCH_LOCK(json("PATCH", { restricted: false }), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("unlock_forbidden");
    expect(mockDb.incident.updateMany).not.toHaveBeenCalled();
  });

  it("unlock: the lock-time IC still in the seat may unlock; lockedAt/lockedIcUserId are cleared", async () => {
    mockAuth.mockResolvedValue(contributor("ic-1"));
    mockDb.incident.findUnique.mockResolvedValue(incidentRow({ restricted: true, lockedIcUserId: "ic-1", participants: [], roleAssignments: [{ id: "r" }] }));
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ id: "r" });
    mockDb.incident.updateMany.mockResolvedValue({ count: 1 });
    const res = await PATCH_LOCK(json("PATCH", { restricted: false }), { params });
    expect(res.status).toBe(200);
    expect(mockDb.incident.updateMany.mock.calls[0][0].data).toEqual({ restricted: false, lockedAt: null, lockedIcUserId: null });
  });

  it("unlock: an administrator always may", async () => {
    mockAuth.mockResolvedValue(admin);
    mockDb.incident.findUnique.mockResolvedValue(incidentRow({ restricted: true, lockedIcUserId: "ic-1", participants: [] }));
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
    mockDb.incident.updateMany.mockResolvedValue({ count: 1 });
    expect((await PATCH_LOCK(json("PATCH", { restricted: false }), { params })).status).toBe(200);
  });

  it("unlock: the reporter (participant, not IC) gets the incident_locked 403", async () => {
    mockAuth.mockResolvedValue(contributor("rep"));
    mockDb.incident.findUnique.mockResolvedValue(incidentRow({ restricted: true, lockedIcUserId: "ic-1" }));
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
    const res = await PATCH_LOCK(json("PATCH", { restricted: false }), { params });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("incident_locked");
  });
});
