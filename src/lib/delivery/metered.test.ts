// @vitest-environment node
// The one metered gate: page deliveries AND every other SMS (notify, OTP,
// contact verification) count toward the same per-number / per-org limits.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  pageCount: 0,
  otherCount: 0,
  configured: true,
  db: {
    pageDelivery: { count: vi.fn(), findFirst: vi.fn() },
    meteredSend: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  },
  send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("./providers/twilio", () => ({ twilioConfigured: () => h.configured, twilioSendSms: h.send }));

import { checkMeteredRateLimit, sendMeteredSms } from "./metered";

const NOW = new Date("2026-10-14T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  h.pageCount = 0;
  h.otherCount = 0;
  h.configured = true;
  h.db.pageDelivery.count.mockImplementation(async () => h.pageCount);
  h.db.meteredSend.count.mockImplementation(async () => h.otherCount);
  h.db.pageDelivery.findFirst.mockResolvedValue(null);
  h.db.meteredSend.findFirst.mockResolvedValue({ createdAt: new Date(NOW.getTime() - 20 * 60_000) });
  h.send.mockResolvedValue({ ok: true, sid: "SM1" });
  delete process.env.DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR;
});

describe("checkMeteredRateLimit", () => {
  it("adds non-page SMS to the page-delivery count", async () => {
    h.pageCount = 6;
    h.otherCount = 4; // 10 = the default per-number limit
    const hit = await checkMeteredRateLimit("org1", "+15550001111", "sms", NOW);
    expect(hit?.reason).toMatch(/10 SMS to this number/);
    // Frees when the oldest counted send (20 min ago) leaves the hour.
    expect(hit!.retryAt.getTime()).toBe(NOW.getTime() + 40 * 60_000 + 5_000);
  });

  it("passes under the limit", async () => {
    h.pageCount = 5;
    h.otherCount = 4;
    expect(await checkMeteredRateLimit("org1", "+15550001111", "sms", NOW)).toBeNull();
  });
});

describe("sendMeteredSms", () => {
  it("records the send before calling Twilio, in E.164", async () => {
    const r = await sendMeteredSms({ organizationId: "org1", to: "(555) 000-1111", body: "hi", purpose: "notify", now: NOW });
    expect(r.ok).toBe(true);
    expect(h.db.meteredSend.create).toHaveBeenCalledWith({
      data: { organizationId: "org1", channel: "sms", destination: "+15550001111", purpose: "notify", createdAt: NOW },
    });
    expect(h.send).toHaveBeenCalledWith("+15550001111", "hi");
  });

  it("refuses (no send, no row) when rate limited, unconfigured, or without a number", async () => {
    h.otherCount = 10;
    expect(await sendMeteredSms({ organizationId: "org1", to: "+15550001111", body: "x", purpose: "phone_otp" })).toMatchObject({ ok: false, skipped: true });
    h.otherCount = 0;
    h.configured = false;
    expect(await sendMeteredSms({ organizationId: "org1", to: "+15550001111", body: "x", purpose: "notify" })).toMatchObject({ skipped: true });
    h.configured = true;
    expect(await sendMeteredSms({ organizationId: "org1", to: null, body: "x", purpose: "notify" })).toMatchObject({ skipped: true });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.db.meteredSend.create).not.toHaveBeenCalled();
  });
});
