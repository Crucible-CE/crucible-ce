// @vitest-environment node
// Twilio voice <Gather> callback: signature over the PUBLIC URL (incl. the
// ?t= query); unsigned / forged / signed-for-another-host requests get 403
// and never ack.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ findUnique: vi.fn(), acknowledgePage: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { incidentPage: { findUnique: h.findUnique } } }));
vi.mock("@/lib/escalation/engine", () => ({ acknowledgePage: h.acknowledgePage }));

import { POST } from "./route";
import { twilioExpectedSignature } from "@/lib/delivery/twilio-webhook";
import { createAckToken } from "@/lib/delivery/ack-token";

const PAGE = "cmpage0000000000000000001";

function voiceRequest(params: Record<string, string>, opts: { sig?: "none" | "bad" | "ok"; signedBase?: string; token?: string } = {}) {
  const token = opts.token ?? createAckToken(PAGE, 0);
  const path = `/api/public/twilio/voice?t=${encodeURIComponent(token)}`;
  const sig = twilioExpectedSignature(`${opts.signedBase ?? "https://crucible.test"}${path}`, params, "tok");
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if ((opts.sig ?? "ok") === "ok") headers["X-Twilio-Signature"] = sig;
  if (opts.sig === "bad") headers["X-Twilio-Signature"] = "AAAA";
  return new Request(`http://internal:3000${path}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.PUBLIC_URL = "https://crucible.test";
  process.env.AUTH_SECRET = "voice-test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx";
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue({ targetUserId: "u1" });
  h.acknowledgePage.mockResolvedValue(true);
});

describe("Twilio voice press-1 ack", () => {
  it("signed: pressing 1 acks the page at the token's level", async () => {
    const res = await POST(voiceRequest({ Digits: "1", CallSid: "CA1" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Acknowledged");
    expect(h.acknowledgePage).toHaveBeenCalledWith(PAGE, { userId: "u1", via: "voice", level: 0 });
  });

  it("unsigned or forged requests are 403 and never ack", async () => {
    expect((await POST(voiceRequest({ Digits: "1" }, { sig: "none" }))).status).toBe(403);
    expect((await POST(voiceRequest({ Digits: "1" }, { sig: "bad" }))).status).toBe(403);
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("a request signed for a different public URL (PUBLIC_URL mismatch) is 403", async () => {
    expect((await POST(voiceRequest({ Digits: "1" }, { signedBase: "https://attacker.test" }))).status).toBe(403);
    process.env.PUBLIC_URL = "https://other.crucible.test";
    expect((await POST(voiceRequest({ Digits: "1" }))).status).toBe(403);
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("other digits or a bad token do not ack", async () => {
    expect(await (await POST(voiceRequest({ Digits: "2" }))).text()).toContain("Not acknowledged");
    expect(await (await POST(voiceRequest({ Digits: "1" }, { token: "garbage" }))).text()).toContain("can no longer be acknowledged");
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("not configured (no auth token): 200 hang-up, no ack", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const res = await POST(voiceRequest({ Digits: "1" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Hangup/>");
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });
});
