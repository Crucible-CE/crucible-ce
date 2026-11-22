// @vitest-environment node
// Closure flow on PATCH /api/incidents/[id]: a disposition is required for
// every close, false positives go through their dedicated route, the closure
// gate 409s with blockers, and an override needs a reason and is ledgered
// (closure_gate_overridden) with the blocker codes. Plus the lock guard.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    incident: { findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    incidentRoleAssignment: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    incidentActivity: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    mockDb,
    mockAuth: vi.fn(),
    mockAppendLedger: vi.fn(),
    mockGate: vi.fn(),
    mockNotify: vi.fn(),
    mockCancelPages: vi.fn(),
  };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: h.mockAppendLedger }));
vi.mock("@/lib/incident/closure-gate", () => ({ evaluateClosureGate: h.mockGate }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: h.mockNotify }));
vi.mock("@/lib/escalation/engine", () => ({ cancelOpenPagesForIncident: h.mockCancelPages }));

import { PATCH } from "./route";

const { mockDb, mockAuth, mockAppendLedger, mockGate } = h;
const params = Promise.resolve({ id: "inc-1" });
const contributor = { user: { id: "u-1", name: "Una", organizationId: "org-1", role: "contributor" } };
const existing = {
  id: "inc-1",
  title: "Phish",
  status: "recovered",
  restricted: false,
  containedAt: null,
  resolvedAt: new Date(),
  closedAt: null,
};

function patch(body: unknown) {
  return PATCH(
    new Request("http://x/api/incidents/inc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(contributor);
  mockDb.incident.findFirst.mockResolvedValue(existing);
  mockDb.incident.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
  mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null);
  mockDb.user.findUnique.mockResolvedValue({ name: "Una" });
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
  mockGate.mockResolvedValue({ blockers: [], requiresOverride: false });
  h.mockNotify.mockResolvedValue(undefined);
  h.mockCancelPages.mockResolvedValue(0);
});

describe("PATCH closure flow", () => {
  it("requires a disposition to close", async () => {
    const res = await patch({ status: "closed" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("disposition_required");
    expect(mockDb.incident.update).not.toHaveBeenCalled();
  });

  it("sends false positives to the dedicated route", async () => {
    const res = await patch({ status: "closed", closureDisposition: "false_positive" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("use_false_positive_route");
    expect(mockDb.incident.update).not.toHaveBeenCalled();
  });

  it("409s with the gate's blockers when closing without an override", async () => {
    mockGate.mockResolvedValueOnce({
      blockers: [{ code: "missing_postmortem", message: "No postmortem yet." }],
      requiresOverride: true,
    });
    const res = await patch({ status: "closed", closureDisposition: "true_positive" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("closure_blocked");
    expect(body.blockers[0].code).toBe("missing_postmortem");
  });

  it("an override without a reason is rejected", async () => {
    const res = await patch({ status: "closed", closureDisposition: "benign", overrideClosureGate: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("override_reason_required");
  });

  it("an override with a reason closes and ledgers closure_gate_overridden with the blocker codes", async () => {
    mockGate.mockResolvedValueOnce({
      blockers: [{ code: "missing_postmortem", message: "No postmortem yet." }],
      requiresOverride: true,
    });
    const res = await patch({
      status: "closed",
      closureDisposition: "true_positive",
      overrideClosureGate: true,
      overrideReason: "Postmortem scheduled with the vendor next week",
    });
    expect(res.status).toBe(200);
    expect(mockDb.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "closed", closureDisposition: "true_positive", closedById: "u-1" }),
      }),
    );
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "closure_gate_overridden",
        payload: { reason: "Postmortem scheduled with the vendor next week", blockers: ["missing_postmortem"] },
      }),
    );
    expect(mockAppendLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: "incident_closed",
        payload: expect.objectContaining({ disposition: "true_positive", closureGateOverridden: true }),
      }),
    );
  });

  it("a clean close records the disposition without an override event", async () => {
    const res = await patch({ status: "closed", closureDisposition: "benign", closureNote: "Authorized pentest" });
    expect(res.status).toBe(200);
    expect(mockAppendLedger).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: "closure_gate_overridden" }),
    );
    expect(mockDb.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ closureDisposition: "benign", closureNote: "Authorized pentest" }) }),
    );
  });
});

describe("PATCH close cancels open pages", () => {
  it("cancels the incident's open pages inside the close transaction", async () => {
    let inTx = false;
    mockDb.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
      inTx = true;
      try { return await fn(mockDb); } finally { inTx = false; }
    });
    h.mockCancelPages.mockImplementationOnce(async () => { expect(inTx).toBe(true); return 2; });
    const res = await patch({ status: "closed", closureDisposition: "benign" });
    expect(res.status).toBe(200);
    expect(h.mockCancelPages).toHaveBeenCalledWith("inc-1", mockDb);
  });

  it("does not cancel pages on a non-closing edit", async () => {
    const res = await patch({ title: "Renamed" });
    expect(res.status).toBe(200);
    expect(h.mockCancelPages).not.toHaveBeenCalled();
  });
});

describe("PATCH lock guard", () => {
  it("403s a non-IC contributor on a locked incident with the incident_locked code", async () => {
    mockDb.incident.findFirst.mockResolvedValueOnce({ ...existing, restricted: true });
    const res = await patch({ title: "New title" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("incident_locked");
    expect(mockDb.incident.update).not.toHaveBeenCalled();
  });

  it("lets the incident commander edit a locked incident", async () => {
    mockDb.incident.findFirst.mockResolvedValueOnce({ ...existing, restricted: true });
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValueOnce({ id: "ra-1" });
    const res = await patch({ title: "New title" });
    expect(res.status).toBe(200);
  });

  it("lets an administrator edit a locked incident", async () => {
    mockAuth.mockResolvedValueOnce({ user: { ...contributor.user, role: "administrator" } });
    mockDb.incident.findFirst.mockResolvedValueOnce({ ...existing, restricted: true });
    const res = await patch({ title: "New title" });
    expect(res.status).toBe(200);
  });
});
