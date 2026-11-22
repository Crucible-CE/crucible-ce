// @vitest-environment node
// Scanner-safe, expiring, single-use escalation-contact verification.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = vi.hoisted(() => ({
  escalationContact: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import { GET, POST } from "./route";
import { isVerifyTokenExpired, VERIFY_TOKEN_TTL_DAYS } from "@/lib/contacts/verify-token";

const token = "a".repeat(64);
const ctx = { params: Promise.resolve({ token }) };
const day = 86_400_000;

beforeEach(() => {
  mockDb.escalationContact.findFirst.mockReset();
  mockDb.escalationContact.updateMany.mockReset();
  mockDb.escalationContact.update.mockReset();
});

describe("GET (the emailed link)", () => {
  it("never changes state — it only redirects to the confirm page", async () => {
    const res = await GET(new Request(`http://x/api/public/escalation-verify/${token}`), ctx);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/escalation-verify/${token}`);
    expect(mockDb.escalationContact.findFirst).not.toHaveBeenCalled();
    expect(mockDb.escalationContact.updateMany).not.toHaveBeenCalled();
    expect(mockDb.escalationContact.update).not.toHaveBeenCalled();
  });
});

describe("POST (the confirm button)", () => {
  it("confirms a fresh token and burns it atomically", async () => {
    mockDb.escalationContact.findFirst.mockResolvedValueOnce({ id: "c1", name: "Ana", verificationSentAt: new Date() });
    mockDb.escalationContact.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ confirmed: true, name: "Ana", channel: "email" });
    const call = mockDb.escalationContact.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: "c1", verificationTokenHash: expect.any(String) });
    expect(call.data).toMatchObject({ verificationTokenHash: null, emailVerifiedAt: expect.any(Date) });
    // The emailed link proves the mailbox only, never the phone.
    expect("phoneVerifiedAt" in call.data).toBe(false);
  });

  it("the SMS link (16-byte token) verifies the PHONE only", async () => {
    const sms = "b".repeat(32);
    mockDb.escalationContact.findFirst.mockResolvedValueOnce({ id: "c1", name: "Ana", phoneVerificationSentAt: new Date() });
    mockDb.escalationContact.updateMany.mockResolvedValueOnce({ count: 1 });
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ token: sms }) });
    expect(res.status).toBe(200);
    expect((await res.json()).channel).toBe("phone");
    expect(mockDb.escalationContact.findFirst.mock.calls[0][0].where).toHaveProperty("phoneVerificationTokenHash");
    const call = mockDb.escalationContact.updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({ phoneVerifiedAt: expect.any(Date), phoneVerificationTokenHash: null });
    expect("emailVerifiedAt" in call.data).toBe(false);
  });

  it("rejects an expired token with 410 and does not confirm", async () => {
    mockDb.escalationContact.findFirst.mockResolvedValueOnce({
      id: "c1",
      name: "Ana",
      verificationSentAt: new Date(Date.now() - (VERIFY_TOKEN_TTL_DAYS + 1) * day),
    });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(410);
    expect(mockDb.escalationContact.updateMany).not.toHaveBeenCalled();
  });

  it("is single-use: a second (or racing) confirm 404s", async () => {
    mockDb.escalationContact.findFirst.mockResolvedValueOnce({ id: "c1", name: "Ana", verificationSentAt: new Date() });
    mockDb.escalationContact.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(new Request("http://x", { method: "POST" }), ctx);
    expect(res.status).toBe(404);
  });

  it("400s a malformed token without a DB lookup", async () => {
    const res = await POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ token: "short" }) });
    expect(res.status).toBe(400);
    expect(mockDb.escalationContact.findFirst).not.toHaveBeenCalled();
  });
});

describe("isVerifyTokenExpired", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("is valid inside the TTL and expired after it", () => {
    expect(isVerifyTokenExpired(new Date(now.getTime() - (VERIFY_TOKEN_TTL_DAYS - 1) * day), now)).toBe(false);
    expect(isVerifyTokenExpired(new Date(now.getTime() - (VERIFY_TOKEN_TTL_DAYS + 1) * day), now)).toBe(true);
  });
  it("treats a missing sent timestamp as expired", () => {
    expect(isVerifyTokenExpired(null, now)).toBe(true);
  });
});
