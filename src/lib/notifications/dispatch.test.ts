import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDb, mockResolveDelivery, mockSendPushToUser, mockSendEmail, mockSendSms } = vi.hoisted(() => ({
  mockDb: {
    incident: { findUnique: vi.fn() },
    notification: { create: vi.fn(), findFirst: vi.fn() },
    notificationDigestItem: { create: vi.fn() },
    incidentSubscription: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    userNotificationSetting: { findMany: vi.fn() },
    escalationContact: { findMany: vi.fn() },
  },
  mockResolveDelivery: vi.fn(),
  mockSendPushToUser: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendSms: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("./resolve", () => ({ resolveDelivery: mockResolveDelivery }));
vi.mock("@/lib/push", () => ({ sendPushToUser: mockSendPushToUser }));
vi.mock("./channels", () => ({ sendEmail: mockSendEmail }));
// SMS goes through the shared metered gate (rate limits + E.164 + Twilio).
vi.mock("@/lib/delivery/metered", () => ({ sendMeteredSms: mockSendSms }));
vi.mock("@/lib/socket/server", () => ({ getIO: () => { throw new Error("no socket in tests"); } }));

import { notify } from "./dispatch";

function resetAll() {
  for (const model of Object.values(mockDb)) for (const fn of Object.values(model)) (fn as ReturnType<typeof vi.fn>).mockReset();
  mockResolveDelivery.mockReset();
  mockSendPushToUser.mockReset();
  mockSendEmail.mockReset();
  mockSendSms.mockReset();

  mockDb.notification.findFirst.mockResolvedValue(null); // no dupes
  mockDb.notification.create.mockResolvedValue({ id: "n1" });
  mockDb.incidentSubscription.findMany.mockResolvedValue([]);
  mockDb.userNotificationSetting.findMany.mockResolvedValue([]);
  mockDb.escalationContact.findMany.mockResolvedValue([]);
  mockSendPushToUser.mockResolvedValue({ sent: 0, devices: 0 });
  mockSendEmail.mockResolvedValue({ ok: false, skipped: true });
  mockSendSms.mockResolvedValue({ ok: false, skipped: true });
}

// role_assigned is a "direct"-audience catalog category whose channels we
// control entirely through resolveDelivery's mock.
const baseInput = {
  event: "role_assigned",
  organizationId: "org-1",
  title: "You were assigned",
  body: "Incident Commander on INC-1",
};

describe("notify() per-recipient contact + honest report", () => {
  beforeEach(resetAll);

  it("each recipient's OWN email/phone is used (no shared contact)", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["email", "sms"], digest: false });
    mockDb.user.findMany.mockResolvedValue([
      { id: "u-1", email: "one@acme.co" },
      { id: "u-2", email: "two@acme.co" },
    ]);
    mockDb.userNotificationSetting.findMany.mockResolvedValue([
      { userId: "u-1", notificationPhone: "+15550000001", notificationPhoneVerifiedAt: new Date(), allowUnverifiedPhone: false },
    ]);
    mockDb.escalationContact.findMany.mockResolvedValue([
      { userId: "u-2", phone: "+15550000002", phoneVerifiedAt: new Date(), allowUnverifiedPhone: false }, // matrix fallback for u-2
    ]);
    mockSendEmail.mockResolvedValue({ ok: true });
    mockSendSms.mockResolvedValue({ ok: true });

    const r = await notify({ ...baseInput, recipientIds: ["u-1", "u-2"] });

    expect(mockSendEmail.mock.calls.map((c) => c[0])).toEqual(["one@acme.co", "two@acme.co"]);
    expect(mockSendSms.mock.calls.map((c) => c[0].to)).toEqual(["+15550000001", "+15550000002"]);
    expect(mockSendSms.mock.calls[0][0]).toMatchObject({ organizationId: "org-1", purpose: "notify" });
    expect(r.delivered).toEqual([
      { userId: "u-1", channels: ["email", "sms"], digested: false },
      { userId: "u-2", channels: ["email", "sms"], digested: false },
    ]);
  });

  it("an UNVERIFIED phone (own or linked contact) is never texted; the admin override opens it", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["sms"], digest: false });
    mockDb.user.findMany.mockResolvedValue([
      { id: "u-1", email: "one@acme.co" },
      { id: "u-2", email: "two@acme.co" },
      { id: "u-3", email: "three@acme.co" },
    ]);
    mockDb.userNotificationSetting.findMany.mockResolvedValue([
      { userId: "u-1", notificationPhone: "+15550000001", notificationPhoneVerifiedAt: null, allowUnverifiedPhone: false },
      { userId: "u-3", notificationPhone: "+15550000003", notificationPhoneVerifiedAt: null, allowUnverifiedPhone: true },
    ]);
    mockDb.escalationContact.findMany.mockResolvedValue([
      { userId: "u-2", phone: "+15550000002", phoneVerifiedAt: null, allowUnverifiedPhone: false },
    ]);
    mockSendSms.mockResolvedValue({ ok: true });

    const r = await notify({ ...baseInput, recipientIds: ["u-1", "u-2", "u-3"] });
    // u-1 / u-2: no dialable phone -> the gate gets null and skips.
    expect(mockSendSms.mock.calls.map((c) => c[0].to)).toEqual([null, null, "+15550000003"]);
    expect(r.recipients).toBe(3);
  });

  it("skipped/failed channels are EXCLUDED from the delivery report", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["in_app", "push", "email", "sms"], digest: false });
    mockDb.user.findMany.mockResolvedValue([{ id: "u-1", email: "one@acme.co" }]);
    mockSendEmail.mockResolvedValue({ ok: false, skipped: true, detail: "Email provider not configured" });
    mockSendSms.mockResolvedValue({ ok: false, detail: "Twilio send failed" });
    mockSendPushToUser.mockResolvedValue({ sent: 0, devices: 0 }); // no devices

    const r = await notify({ ...baseInput, recipientIds: ["u-1"] });

    // Old behavior echoed all four; now only in_app truly delivered.
    expect(r.delivered).toEqual([{ userId: "u-1", channels: ["in_app"], digested: false }]);
  });

  it("push counts only when at least one device accepted", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["push"], digest: false });
    mockDb.user.findMany.mockResolvedValue([{ id: "u-1", email: null }]);
    mockSendPushToUser.mockResolvedValue({ sent: 2, devices: 2 });

    const r = await notify({ ...baseInput, recipientIds: ["u-1"] });
    expect(r.delivered[0].channels).toEqual(["push"]);
  });

  it("explicit input.contact still overrides the resolved contact", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["email"], digest: false });
    mockDb.user.findMany.mockResolvedValue([{ id: "u-1", email: "resolved@acme.co" }]);
    mockSendEmail.mockResolvedValue({ ok: true });

    await notify({ ...baseInput, recipientIds: ["u-1"], contact: { email: "override@acme.co" } });
    expect(mockSendEmail.mock.calls[0][0]).toBe("override@acme.co");
  });

  it("contact resolution is batched (three queries), not per-recipient", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["email"], digest: false });
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `u-${i}`, email: `${i}@a.co` }));
    mockDb.user.findMany.mockResolvedValue(many);
    mockSendEmail.mockResolvedValue({ ok: true });

    await notify({ ...baseInput, recipientIds: many.map((u) => u.id) });
    expect(mockDb.user.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.userNotificationSetting.findMany).toHaveBeenCalledTimes(1);
    expect(mockDb.escalationContact.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("notify() honours the incident lock", () => {
  beforeEach(resetAll);

  it("drops recipients who can't see a locked incident", async () => {
    mockResolveDelivery.mockResolvedValue({ channels: ["in_app"], digest: false });
    mockDb.incident.findUnique.mockResolvedValue({
      organizationId: "org-1",
      restricted: true,
      reportedById: "u-rep",
      assignedToId: null,
      participants: [{ userId: "u-in" }],
      roleAssignments: [],
    });
    mockDb.user.findMany.mockResolvedValue([
      { id: "u-in", organizationId: "org-1", role: "contributor", isActive: true, email: null },
      { id: "u-out", organizationId: "org-1", role: "contributor", isActive: true, email: null },
    ]);

    const r = await notify({ ...baseInput, incidentId: "inc-1", recipientIds: ["u-in", "u-out"] });
    expect(r.delivered.map((d) => d.userId)).toEqual(["u-in"]);
  });
});
