// @vitest-environment node
// PUT /api/notifications/preferences — personal SMS/voice number: normalized
// to E.164 at write, rejected when unreadable, and a CHANGED number clears its
// verification stamp.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mockDb = {
    orgNotificationPolicy: { findMany: vi.fn() },
    userNotificationPref: { upsert: vi.fn() },
    userNotificationSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  return { mockDb, mockAuth: vi.fn() };
});
vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/auth", () => ({ auth: h.mockAuth }));
vi.mock("@/lib/notifications/preferences", () => ({ getPreferenceMatrix: vi.fn().mockResolvedValue({ categories: [], settings: {} }) }));

import { PUT } from "./route";

const { mockDb, mockAuth } = h;
const put = (body: unknown) =>
  PUT(new Request("http://x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
  mockDb.userNotificationSetting.findUnique.mockResolvedValue({ notificationPhone: "+14155550123" });
  mockDb.userNotificationSetting.upsert.mockResolvedValue({});
});

describe("notificationPhone", () => {
  it("normalizes to E.164 and clears verification when the number changes", async () => {
    expect((await put({ settings: { notificationPhone: "(415) 555-0199" } })).status).toBe(200);
    const { update, create } = mockDb.userNotificationSetting.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ notificationPhone: "+14155550199", notificationPhoneVerifiedAt: null, allowUnverifiedPhone: false, phoneOtpHash: null });
    expect(create).toMatchObject({ notificationPhone: "+14155550199", notificationPhoneVerifiedAt: null });
  });

  it("re-saving the same number keeps verification", async () => {
    await put({ settings: { notificationPhone: "+1 415 555 0123" } });
    const { update } = mockDb.userNotificationSetting.upsert.mock.calls[0][0];
    expect("notificationPhoneVerifiedAt" in update).toBe(false);
  });

  it("empty clears the number", async () => {
    await put({ settings: { notificationPhone: "" } });
    expect(mockDb.userNotificationSetting.upsert.mock.calls[0][0].update).toMatchObject({ notificationPhone: null, notificationPhoneVerifiedAt: null });
  });

  it("rejects an unreadable number", async () => {
    expect((await put({ settings: { notificationPhone: "call me maybe" } })).status).toBe(400);
    expect(mockDb.userNotificationSetting.upsert).not.toHaveBeenCalled();
  });
});
