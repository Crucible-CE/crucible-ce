// @vitest-environment node
// Closing as a false positive cancels the incident's open pages inside the
// same transaction as the close (no escalation / delivery retry after close).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    incident: { findFirst: vi.fn(), update: vi.fn() },
    incidentActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { mockDb, mockCancel: vi.fn(), mockLedger: vi.fn(), mockNotify: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/ledger/append", () => ({ appendLedger: h.mockLedger }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: h.mockNotify }));
vi.mock("@/lib/escalation/engine", () => ({ cancelOpenPagesForIncident: h.mockCancel }));

import { markIncidentFalsePositive } from "./false-positive";

const tx = { tag: "tx", incident: h.mockDb.incident, incidentActivity: h.mockDb.incidentActivity };

beforeEach(() => {
  vi.clearAllMocks();
  h.mockDb.incident.findFirst.mockResolvedValue({ id: "inc-1", title: "T", status: "active", closureDisposition: null, resolvedAt: null });
  h.mockDb.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));
  h.mockCancel.mockResolvedValue(1);
  h.mockNotify.mockResolvedValue(undefined);
});

describe("markIncidentFalsePositive", () => {
  it("cancels open pages with the close transaction client", async () => {
    const r = await markIncidentFalsePositive({
      incidentId: "inc-1", organizationId: "org-1", userId: "u-1", actorLabel: "U", reason: "benign_activity",
    });
    expect(r.ok).toBe(true);
    expect(h.mockDb.incident.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "closed" }) }));
    expect(h.mockCancel).toHaveBeenCalledWith("inc-1", tx);
  });

  it("does nothing when already a false positive", async () => {
    h.mockDb.incident.findFirst.mockResolvedValueOnce({ id: "inc-1", title: "T", status: "closed", closureDisposition: "false_positive", resolvedAt: null });
    const r = await markIncidentFalsePositive({
      incidentId: "inc-1", organizationId: "org-1", userId: "u-1", actorLabel: "U", reason: "benign_activity",
    });
    expect(r.ok).toBe(false);
    expect(h.mockCancel).not.toHaveBeenCalled();
  });
});
