// @vitest-environment node
// PUT /api/incidents/[id]/roles — IC takeover guard and org validation of
// both assignee kinds.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    incident: { findFirst: vi.fn(), findUnique: vi.fn() },
    incidentRoleAssignment: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    user: { findFirst: vi.fn() },
    escalationContact: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { mockDb, mockAuth: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/socket/evict", () => ({ evictFromIncidentRoom: vi.fn().mockResolvedValue(undefined) }));

import { GET, PUT } from "./route";

const { mockDb, mockAuth } = h;
const params = Promise.resolve({ id: "inc-1" });
const contributor = (id = "u-2") => ({ user: { id, name: "C", organizationId: "org-1", role: "contributor" } });

function put(body: unknown) {
  return PUT(new Request("http://x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(contributor());
  mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "T", reportedById: "u-reporter", restricted: false });
  mockDb.user.findFirst.mockResolvedValue({ id: "u-9" });
  mockDb.escalationContact.findFirst.mockResolvedValue({ id: "c-1" });
  mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: "u-ic", escalationContactId: null });
  mockDb.incidentRoleAssignment.upsert.mockResolvedValue({ id: "ra-1" });
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
});

describe("IC takeover guard", () => {
  it("403s a contributor who is not the IC or the reporter", async () => {
    const res = await put({ role: "incident_commander", userId: "u-2" });
    expect(res.status).toBe(403);
    expect(mockDb.incidentRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it("lets the current IC hand over", async () => {
    mockAuth.mockResolvedValue(contributor("u-ic"));
    const res = await put({ role: "incident_commander", userId: "u-9" });
    expect(res.status).toBe(200);
  });

  it("lets the reporter and an administrator change the IC", async () => {
    mockAuth.mockResolvedValue(contributor("u-reporter"));
    expect((await put({ role: "incident_commander", userId: "u-9" })).status).toBe(200);
    mockAuth.mockResolvedValue({ user: { id: "a-1", organizationId: "org-1", role: "administrator" } });
    expect((await put({ role: "incident_commander", userId: "u-9" })).status).toBe(200);
  });

  it("M7: a plain editor can NOT fill an empty IC seat (not even with themselves)", async () => {
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
    expect((await put({ role: "incident_commander", userId: "u-2" })).status).toBe(403);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: null, escalationContactId: null });
    expect((await put({ role: "incident_commander", userId: "u-2" })).status).toBe(403);
    expect(mockDb.incidentRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it("M7: the reporter or an administrator can fill an empty IC seat", async () => {
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
    mockAuth.mockResolvedValue(contributor("u-reporter"));
    expect((await put({ role: "incident_commander", userId: "u-9" })).status).toBe(200);
    mockAuth.mockResolvedValue({ user: { id: "a-1", organizationId: "org-1", role: "administrator" } });
    expect((await put({ role: "incident_commander", userId: "u-9" })).status).toBe(200);
  });

  it("#13: the seat is read inside the transaction under a row lock (no TOCTOU)", async () => {
    const order: string[] = [];
    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push("tx:begin");
      const r = await fn(mockDb);
      order.push("tx:end");
      return r;
    });
    mockDb.$queryRaw.mockImplementation(async () => { order.push("lock"); return []; });
    mockDb.incidentRoleAssignment.findFirst.mockImplementation(async () => { order.push("seat"); return { userId: "u-ic", escalationContactId: null }; });
    mockAuth.mockResolvedValue(contributor("u-ic"));
    expect((await put({ role: "incident_commander", userId: "u-9" })).status).toBe(200);
    expect(order.slice(0, 3)).toEqual(["tx:begin", "lock", "seat"]);
  });

  it("does not gate other roles", async () => {
    expect((await put({ role: "scribe", userId: "u-9" })).status).toBe(200);
  });
});

describe("assignee validation", () => {
  it("rejects a user outside the org", async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    const res = await put({ role: "scribe", userId: "u-other-org" });
    expect(res.status).toBe(400);
    expect(mockDb.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-other-org", organizationId: "org-1", isActive: true } }));
  });

  it("rejects an escalation contact outside the org", async () => {
    mockDb.escalationContact.findFirst.mockResolvedValue(null);
    const res = await put({ role: "scribe", escalationContactId: "c-x" });
    expect(res.status).toBe(400);
  });
});

describe("GET canAssignIc (UI hint)", () => {
  const get = () => GET(new Request("http://x"), { params });
  it("false for a plain editor on an empty seat, true for the reporter", async () => {
    mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", reportedById: "u-reporter" });
    mockDb.incidentRoleAssignment.findMany.mockResolvedValue([]);
    expect((await (await get()).json()).canAssignIc).toBe(false);
    mockAuth.mockResolvedValue(contributor("u-reporter"));
    expect((await (await get()).json()).canAssignIc).toBe(true);
  });
  it("true for the seated IC", async () => {
    mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", reportedById: "u-reporter" });
    mockDb.incidentRoleAssignment.findMany.mockResolvedValue([{ role: "incident_commander", userId: "u-2", escalationContactId: null }]);
    expect((await (await get()).json()).canAssignIc).toBe(true);
  });
});
