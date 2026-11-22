// @vitest-environment node
// POST /api/onboarding/test-page — send yourself a test page. The real sender
// runs against a mocked database and delivery engine: email through the active
// transport with a signed ack link to the normal page-ack landing page.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  rate: vi.fn(),
  sendTestDelivery: vi.fn(),
  resolvePageRecipient: vi.fn(),
  sendMeteredSms: vi.fn(),
  transport: vi.fn(),
  db: {
    onboardingState: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: h.rate }));
vi.mock("@/lib/delivery/engine", async () => {
  const { createAckToken } = await import("@/lib/delivery/ack-token");
  return {
    sendTestDelivery: h.sendTestDelivery,
    resolvePageRecipient: h.resolvePageRecipient,
    ackUrlFor: (id: string, level: number) => `https://crucible.test/api/public/page-ack/${createAckToken(id, level)}`,
  };
});
vi.mock("@/lib/delivery/metered", () => ({ sendMeteredSms: h.sendMeteredSms }));
vi.mock("@/lib/email/transport", () => ({ activeEmailTransport: h.transport }));

import { POST } from "./route";
import { verifyAckToken } from "@/lib/delivery/ack-token";

const ROW = "cmonb00000000000000000001";

beforeEach(() => {
  process.env.AUTH_SECRET = "route-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx";
  vi.clearAllMocks();
  h.rate.mockResolvedValue({ allowed: true });
  h.transport.mockReturnValue("smtp");
  h.resolvePageRecipient.mockResolvedValue({ name: "Rhea", email: "rhea@acme.test", phone: null, userId: "u-1", contactId: null });
  h.sendTestDelivery.mockResolvedValue({ status: "sent", providerRef: "m-1" });
  h.db.onboardingState.findUnique.mockResolvedValue(null);
  h.db.onboardingState.upsert.mockResolvedValue({ id: ROW });
  h.db.onboardingState.update.mockResolvedValue({});
});

describe("onboarding test page", () => {
  it("401 without a session; 429 when rate limited", async () => {
    h.auth.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    h.auth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
    h.rate.mockResolvedValue({ allowed: false, retryAfter: 30 });
    expect((await POST()).status).toBe(429);
    expect(h.sendTestDelivery).not.toHaveBeenCalled();
  });

  it("any member (a reader included) sends one through the active email transport with a signed ack link", async () => {
    h.auth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { testPage: { seq: number; deliveredAt: string | null; channels: { channel: string; status: string }[] } };
    expect(body.testPage.seq).toBe(0);
    expect(body.testPage.deliveredAt).toBeTruthy();
    expect(body.testPage.channels).toEqual([expect.objectContaining({ channel: "email", status: "sent" })]);

    const [provider, recipient, opts] = h.sendTestDelivery.mock.calls[0];
    expect(provider).toBe("smtp");
    expect(recipient.email).toBe("rhea@acme.test");
    const token = String(opts.ackUrl).split("/api/public/page-ack/")[1];
    expect(verifyAckToken(token)).toMatchObject({ ok: true, pageId: ROW, level: 0 });
    // No phone on file: no SMS attempt.
    expect(h.sendMeteredSms).not.toHaveBeenCalled();
  });

  it("a re-send bumps the sequence (old links die) and keeps the earlier acknowledgement", async () => {
    h.auth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "contributor" } });
    const prev = { seq: 4, sentAt: "2026-10-01T00:00:00Z", ackedAt: "2026-10-01T00:01:00Z", everAckedAt: "2026-10-01T00:01:00Z", channels: [] };
    h.db.onboardingState.findUnique.mockResolvedValue({ id: ROW, value: prev });
    h.resolvePageRecipient.mockResolvedValue({ name: "Cole", email: "c@acme.test", phone: "+15550001111", userId: "u-1", contactId: null });
    h.sendMeteredSms.mockResolvedValue({ ok: true, detail: "SM1" });
    const body = (await (await POST()).json()) as { testPage: { seq: number; ackedAt: string | null; everAckedAt: string | null; channels: unknown[] } };
    expect(body.testPage).toMatchObject({ seq: 5, ackedAt: null, everAckedAt: prev.everAckedAt });
    expect(h.sendMeteredSms).toHaveBeenCalledWith(expect.objectContaining({ to: "+15550001111", purpose: "test_page", organizationId: "org-1" }));
    expect(body.testPage.channels).toHaveLength(2);
  });

  it("without an email transport it still records the page (it waits in the Ops Room)", async () => {
    h.auth.mockResolvedValue({ user: { id: "u-1", organizationId: "org-1", role: "reader" } });
    h.transport.mockReturnValue(null);
    const body = (await (await POST()).json()) as { testPage: { deliveredAt: string | null; channels: { status: string }[] } };
    expect(h.sendTestDelivery).not.toHaveBeenCalled();
    expect(body.testPage.deliveredAt).toBeNull();
    expect(body.testPage.channels[0].status).toBe("skipped");
  });
});
