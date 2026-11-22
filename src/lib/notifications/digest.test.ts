import { describe, it, expect, vi, beforeEach } from "vitest";

// digest flush claims the user's cadence slot (no double-flush) and deletes
// ONLY the item ids it summarized (an item written mid-flush is never lost).

const mockDb = {
  userNotificationSetting: { findMany: vi.fn(), updateMany: vi.fn() },
  notificationDigestItem: { findMany: vi.fn(), deleteMany: vi.fn() },
  notification: { create: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: mockDb }));
const mockCanSee = vi.fn();
vi.mock("@/lib/incident/access", () => ({ canUserSeeIncident: (...a: unknown[]) => mockCanSee(...a) }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/socket/server", () => ({
  getIO: () => {
    throw new Error("socket not running in tests");
  },
}));

const NOW = new Date("2026-07-03T12:00:00Z");

const setting = {
  userId: "u-1",
  digestCadence: "hourly",
  digestLastSentAt: new Date("2026-07-03T10:00:00Z"), // over an hour ago → due
};

const items = [
  { id: "i-1", userId: "u-1", title: "Status changed", link: null, createdAt: new Date("2026-07-03T11:00:00Z") },
  { id: "i-2", userId: "u-1", title: "New assignment", link: "/incidents/inc-1", createdAt: new Date("2026-07-03T11:10:00Z") },
  { id: "i-3", userId: "u-1", title: "Materiality updated", link: null, createdAt: new Date("2026-07-03T11:20:00Z") },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.userNotificationSetting.findMany.mockResolvedValue([setting]);
  mockDb.notificationDigestItem.findMany.mockResolvedValue(items);
  mockDb.notificationDigestItem.deleteMany.mockResolvedValue({ count: items.length });
  mockDb.notification.create.mockResolvedValue({ id: "n-1", userId: "u-1" });
});

describe("flushDigests", () => {
  it("claims the cadence slot guarded on the timestamp it read", async () => {
    mockDb.userNotificationSetting.updateMany.mockResolvedValue({ count: 1 });

    const { flushDigests } = await import("./digest");
    const result = await flushDigests(NOW);

    expect(result).toEqual({ usersFlushed: 1, itemsSent: 3 });
    expect(mockDb.userNotificationSetting.updateMany).toHaveBeenCalledWith({
      where: { userId: "u-1", digestLastSentAt: setting.digestLastSentAt },
      data: { digestLastSentAt: NOW },
    });
  });

  it("deletes ONLY the summarized ids — an item written mid-flush survives", async () => {
    mockDb.userNotificationSetting.updateMany.mockResolvedValue({ count: 1 });

    const { flushDigests } = await import("./digest");
    await flushDigests(NOW);

    expect(mockDb.notificationDigestItem.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["i-1", "i-2", "i-3"] } },
    });
    // Specifically NOT the old unscoped { where: { userId } } delete.
    expect(mockDb.notificationDigestItem.deleteMany).not.toHaveBeenCalledWith({
      where: { userId: "u-1" },
    });
  });

  it("skips the user entirely when a concurrent tick already claimed the slot", async () => {
    mockDb.userNotificationSetting.updateMany.mockResolvedValue({ count: 0 });

    const { flushDigests } = await import("./digest");
    const result = await flushDigests(NOW);

    expect(result).toEqual({ usersFlushed: 0, itemsSent: 0 });
    expect(mockDb.notification.create).not.toHaveBeenCalled();
    expect(mockDb.notificationDigestItem.deleteMany).not.toHaveBeenCalled();
  });

  it("skips users still inside their cadence window without touching the slot", async () => {
    mockDb.userNotificationSetting.findMany.mockResolvedValue([
      { ...setting, digestLastSentAt: new Date("2026-07-03T11:30:00Z") }, // 30 min ago < hourly
    ]);

    const { flushDigests } = await import("./digest");
    const result = await flushDigests(NOW);

    expect(result).toEqual({ usersFlushed: 0, itemsSent: 0 });
    expect(mockDb.userNotificationSetting.updateMany).not.toHaveBeenCalled();
  });

  it("drops items for incidents the user can no longer see (locked / soft-deleted) at flush time", async () => {
    mockDb.userNotificationSetting.updateMany.mockResolvedValue({ count: 1 });
    mockDb.notificationDigestItem.findMany.mockResolvedValue([
      { ...items[0], incidentId: "inc-visible" },
      { ...items[1], incidentId: "inc-locked" },
      { ...items[2], incidentId: null },
    ]);
    mockCanSee.mockImplementation(async (_u: string, inc: string) => inc === "inc-visible");

    const { flushDigests } = await import("./digest");
    const result = await flushDigests(NOW);

    expect(result).toEqual({ usersFlushed: 1, itemsSent: 2 });
    expect(mockDb.notificationDigestItem.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["i-2"] } } });
    const body = mockDb.notification.create.mock.calls[0][0].data.body as string;
    expect(body).not.toContain("New assignment");
  });
});
