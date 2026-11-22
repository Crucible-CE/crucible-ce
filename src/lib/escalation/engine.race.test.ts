import { describe, it, expect, vi, beforeEach } from "vitest";

// the escalation writes are guarded compare-and-swaps — a page acked (or
// escalated by another worker, or whose incident closed) between the batch
// read and the write is neither re-paged, nor notified, nor ledgered, nor
// delivered out-of-band.

const mockDb = {
  incidentPage: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  incidentRoleAssignment: { findFirst: vi.fn() },
  pageDelivery: { updateMany: vi.fn() },
  user: { findFirst: vi.fn() },
  escalationContact: { findFirst: vi.fn() },
  incident: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
};
vi.mock("@/lib/db", () => ({ db: mockDb }));

const mockCanUserSeeIncident = vi.fn();
vi.mock("@/lib/incident/access", () => ({ canUserSeeIncident: mockCanUserSeeIncident }));

const mockCreateNotification = vi.fn();
vi.mock("@/lib/notifications", () => ({ createNotification: mockCreateNotification }));

const mockAppendLedger = vi.fn();
vi.mock("@/lib/ledger/append", () => ({ appendLedger: mockAppendLedger }));

const mockDeliverPage = vi.fn();
const mockSendAckNotice = vi.fn();
vi.mock("@/lib/delivery/engine", () => ({ deliverPage: mockDeliverPage, sendAckNotice: mockSendAckNotice }));

const NOW = new Date("2026-07-03T12:00:00Z");

const overduePage = {
  id: "page-1",
  incidentId: "inc-1",
  organizationId: "org-1",
  status: "sent",
  escalationLevel: 0,
  targetLabel: "Original",
  targetContactId: null,
  ackDeadlineAt: new Date("2026-07-03T11:45:00Z"),
  message: "Sev1 — join the bridge",
};

type Where = { where: Record<string, unknown>; data: Record<string, unknown> };
const isSweep = (a: Where) => (a.where.incident as { status?: unknown } | undefined)?.status === "closed";

/** updateMany: the closed-incident sweep returns `swept`, every guarded write returns `guarded`. */
function updateManyReturns(guarded: number, swept = 0) {
  mockDb.incidentPage.updateMany.mockImplementation(async (a: Where) => ({ count: isSweep(a) ? swept : guarded }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  mockDb.user.findFirst.mockResolvedValue({ name: "Lead", email: "lead@acme.test" });
  mockDb.escalationContact.findFirst.mockResolvedValue({ name: "Vendor IR" });
  mockDb.pageDelivery.updateMany.mockResolvedValue({ count: 0 });
  mockDb.incident.findUnique.mockResolvedValue({ restricted: false, severity: "high" });
  mockCanUserSeeIncident.mockResolvedValue(true);
  mockDeliverPage.mockResolvedValue({ outcomes: [] });
  mockSendAckNotice.mockResolvedValue(undefined);
});

describe("escalateOverduePages guarded writes", () => {
  it("escalates, notifies, ledgers and delivers out-of-band when this worker wins", async () => {
    mockDb.incidentPage.findMany.mockResolvedValue([overduePage]);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: "u-lead", escalationContactId: null });
    updateManyReturns(1);

    const { escalateOverduePages } = await import("./engine");
    const result = await escalateOverduePages(NOW);

    expect(result).toEqual({ escalated: 1, expired: 0, cancelled: 0 });
    // The guard pins the exact row state we read AND the incident being open.
    const guarded = mockDb.incidentPage.updateMany.mock.calls.map((c) => c[0] as Where).find((a) => !isSweep(a))!;
    expect(guarded.where).toMatchObject({
      id: "page-1",
      status: "sent",
      escalationLevel: 0,
      ackDeadlineAt: overduePage.ackDeadlineAt,
      incident: { status: { not: "closed" }, isTraining: false, deletedAt: null },
    });
    expect(guarded.data).toMatchObject({ targetUserId: "u-lead", targetContactId: null, targetLabel: "Lead", escalationLevel: 1 });
    expect(mockCreateNotification).toHaveBeenCalledOnce();
    expect(mockAppendLedger).toHaveBeenCalledOnce();
    expect(mockDeliverPage).toHaveBeenCalledWith("page-1", { kind: "escalation", now: NOW });
  });

  it("does NOT re-page, notify, ledger or deliver a page acked since the read (count 0)", async () => {
    mockDb.incidentPage.findMany.mockResolvedValue([overduePage]);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: "u-lead", escalationContactId: null });
    updateManyReturns(0); // acked (or incident closed) mid-batch

    const { escalateOverduePages } = await import("./engine");
    const result = await escalateOverduePages(NOW);

    expect(result).toEqual({ escalated: 0, expired: 0, cancelled: 0 });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockAppendLedger).not.toHaveBeenCalled();
    expect(mockDeliverPage).not.toHaveBeenCalled();
  });

  it("guards the expire branch the same way", async () => {
    mockDb.incidentPage.findMany.mockResolvedValue([overduePage]);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue(null); // chain exhausted
    updateManyReturns(0); // acked mid-batch

    const { escalateOverduePages } = await import("./engine");
    const result = await escalateOverduePages(NOW);

    expect(result).toEqual({ escalated: 0, expired: 0, cancelled: 0 });
    expect(mockDb.incidentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "page-1", status: "sent" }),
        data: { status: "expired" },
      }),
    );
  });

  it("escalates to an external escalation contact holding the role (no in-app notification)", async () => {
    mockDb.incidentPage.findMany.mockResolvedValue([overduePage]);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: null, escalationContactId: "ec-1" });
    updateManyReturns(1);

    const { escalateOverduePages } = await import("./engine");
    expect((await escalateOverduePages(NOW)).escalated).toBe(1);
    const guarded = mockDb.incidentPage.updateMany.mock.calls.map((c) => c[0] as Where).find((a) => !isSweep(a))!;
    expect(guarded.data).toMatchObject({ targetUserId: null, targetContactId: "ec-1", targetLabel: "Vendor IR" });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockDeliverPage).toHaveBeenCalledOnce();
  });

  it("LOCKED incident: still escalates to a role holder who can't see it, with a REDACTED in-app page", async () => {
    process.env.AUTH_SECRET = "race-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    mockDb.incidentPage.findMany.mockResolvedValue([overduePage]);
    mockDb.incidentRoleAssignment.findFirst.mockResolvedValue({ userId: "u-outsider", escalationContactId: null });
    mockDb.incident.findUnique.mockResolvedValue({ restricted: true, severity: "critical" });
    mockCanUserSeeIncident.mockResolvedValue(false);
    updateManyReturns(1);

    const { escalateOverduePages } = await import("./engine");
    expect((await escalateOverduePages(NOW)).escalated).toBe(1);
    expect(mockCanUserSeeIncident).toHaveBeenCalledWith("u-outsider", "inc-1");
    const [userId, type, title, body, metadata, link] = mockCreateNotification.mock.calls[0];
    expect(userId).toBe("u-outsider");
    expect(type).toBe("incident_page");
    expect(`${title} ${body}`).not.toContain("Sev1"); // the pager note never leaks
    expect(body).toContain("restricted incident (severity critical)");
    expect(metadata).toEqual({ pageId: "page-1", restricted: true }); // no incident id
    expect(link).toMatch(/^\/api\/public\/page-ack\/page-1\.1\./);
    expect(mockDeliverPage).toHaveBeenCalledWith("page-1", { kind: "escalation", now: NOW });
  });
});

describe("closed incidents never escalate", () => {
  it("reads only pages of open incidents and sweeps pages left open on closed ones", async () => {
    mockDb.incidentPage.findMany.mockResolvedValue([]);
    updateManyReturns(0, 3);

    const { escalateOverduePages } = await import("./engine");
    const result = await escalateOverduePages(NOW);

    expect(result).toEqual({ escalated: 0, expired: 0, cancelled: 3 });
    expect(mockDb.incidentPage.findMany).toHaveBeenCalledWith({
      where: { status: "sent", ackDeadlineAt: { lte: NOW }, incident: { status: { not: "closed" }, isTraining: false, deletedAt: null } },
    });
    expect(mockDb.incidentPage.updateMany).toHaveBeenCalledWith({
      where: { status: "sent", incident: { status: "closed" } },
      data: { status: "cancelled", cancelledAt: NOW, ackDeadlineAt: null },
    });
    expect(mockDeliverPage).not.toHaveBeenCalled();
  });

  it("cancelOpenPagesForIncident cancels open pages and stops their retries, on the given tx", async () => {
    const tx = {
      incidentPage: {
        findMany: vi.fn().mockResolvedValue([{ id: "p-1", organizationId: "org-1" }, { id: "p-2", organizationId: "org-1" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      pageDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const { cancelOpenPagesForIncident } = await import("./engine");
    const n = await cancelOpenPagesForIncident("inc-1", tx as never);

    expect(n).toBe(2);
    expect(tx.incidentPage.updateMany).toHaveBeenCalledWith({
      where: { incidentId: "inc-1", status: "sent" },
      data: expect.objectContaining({ status: "cancelled", ackDeadlineAt: null, cancelledAt: expect.any(Date) }),
    });
    expect(tx.pageDelivery.updateMany).toHaveBeenCalledWith({
      where: { incidentId: "inc-1", nextRetryAt: { not: null } },
      data: { nextRetryAt: null },
    });
    expect(mockDb.incidentPage.updateMany).not.toHaveBeenCalled(); // used the tx, not the global client
    expect(mockAppendLedger).toHaveBeenCalledWith(tx, expect.objectContaining({
      eventType: "page_cancelled",
      organizationId: "org-1",
      payload: { reason: "incident_closed", count: 2, pageIds: ["p-1", "p-2"] },
    }));
  });

  it("cancelOpenPagesForIncident opens its own transaction without one", async () => {
    mockDb.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb));
    mockDb.incidentPage.findMany.mockResolvedValue([]);
    mockDb.incidentPage.updateMany.mockResolvedValue({ count: 0 });
    const { cancelOpenPagesForIncident } = await import("./engine");
    expect(await cancelOpenPagesForIncident("inc-9")).toBe(0);
    expect(mockDb.pageDelivery.updateMany).toHaveBeenCalledOnce();
    expect(mockAppendLedger).not.toHaveBeenCalled();
  });
});

describe("acknowledgePage", () => {
  it("returns false without a ledger entry when another ack already won", async () => {
    mockDb.incidentPage.findUnique.mockResolvedValue({ ...overduePage });
    mockDb.incidentPage.updateMany.mockResolvedValue({ count: 0 }); // lost the race

    const { acknowledgePage } = await import("./engine");
    const acked = await acknowledgePage("page-1", { userId: "u-2", via: "app" });

    expect(acked).toBe(false);
    expect(mockAppendLedger).not.toHaveBeenCalled();
    expect(mockSendAckNotice).not.toHaveBeenCalled();
  });

  it("acks exactly once when it wins, recording the channel, and notifies integrations", async () => {
    mockDb.incidentPage.findUnique.mockResolvedValue({ ...overduePage });
    mockDb.incidentPage.updateMany.mockResolvedValue({ count: 1 });

    const { acknowledgePage } = await import("./engine");
    const acked = await acknowledgePage("page-1", { userId: "u-2", via: "link", level: 0 });

    expect(acked).toBe(true);
    expect(mockDb.incidentPage.updateMany).toHaveBeenCalledWith({
      where: { id: "page-1", status: "sent", escalationLevel: 0, incident: { status: { not: "closed" }, isTraining: false, deletedAt: null } },
      data: expect.objectContaining({ status: "acked", acknowledgedById: "u-2", acknowledgedVia: "link" }),
    });
    expect(mockAppendLedger).toHaveBeenCalledOnce();
    expect(mockAppendLedger.mock.calls[0][1]).toMatchObject({ eventType: "page_acked", payload: { via: "link", level: 0 } });
    expect(mockSendAckNotice).toHaveBeenCalledWith("page-1", "link", expect.any(Date));
  });

  it("refuses pages that are no longer open (cancelled / expired)", async () => {
    mockDb.incidentPage.findUnique.mockResolvedValue({ ...overduePage, status: "cancelled" });
    const { acknowledgePage } = await import("./engine");
    expect(await acknowledgePage("page-1", { via: "sms" })).toBe(false);
    expect(mockDb.incidentPage.updateMany).not.toHaveBeenCalled();
  });
});
