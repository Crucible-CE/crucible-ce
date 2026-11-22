// @vitest-environment node
// Twilio status callback: only a correctly signed request (over the PUBLIC
// URL) may downgrade a delivery row to failed + retry.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pageDelivery: { findMany: h.findMany, updateMany: h.updateMany } } }));

import { POST } from "./route";
import { twilioExpectedSignature } from "@/lib/delivery/twilio-webhook";

const PATH = "/api/public/twilio/status";

function statusRequest(params: Record<string, string>, opts: { sig?: "none" | "bad" | "ok"; signedBase?: string } = {}) {
  const sig = twilioExpectedSignature(`${opts.signedBase ?? "https://crucible.test"}${PATH}`, params, "tok");
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if ((opts.sig ?? "ok") === "ok") headers["X-Twilio-Signature"] = sig;
  if (opts.sig === "bad") headers["X-Twilio-Signature"] = "AAAA";
  return new Request(`http://internal:3000${PATH}`, { method: "POST", headers, body: new URLSearchParams(params).toString() });
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.PUBLIC_URL = "https://crucible.test";
  vi.clearAllMocks();
  h.findMany.mockResolvedValue([{ id: "d1", attempt: 1 }]);
  h.updateMany.mockResolvedValue({ count: 1 });
});

describe("Twilio status callback", () => {
  it("signed final failure downgrades the row to failed with a retry", async () => {
    const res = await POST(statusRequest({ MessageSid: "SM1", MessageStatus: "undelivered" }));
    expect(res.status).toBe(200);
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ providerRef: "SM1", status: "sent" });
    const upd = h.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: "d1", status: "sent" });
    expect(upd.data).toMatchObject({ status: "failed", error: "Twilio reported undelivered" });
    expect(upd.data.nextRetryAt).toBeInstanceOf(Date);
  });

  it("success / interim statuses are no-ops", async () => {
    await POST(statusRequest({ MessageSid: "SM1", MessageStatus: "delivered" }));
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("unsigned, forged, or signed-for-another-URL requests are 403 and change nothing", async () => {
    expect((await POST(statusRequest({ CallSid: "CA1", CallStatus: "failed" }, { sig: "none" }))).status).toBe(403);
    expect((await POST(statusRequest({ CallSid: "CA1", CallStatus: "failed" }, { sig: "bad" }))).status).toBe(403);
    expect((await POST(statusRequest({ CallSid: "CA1", CallStatus: "failed" }, { signedBase: "https://elsewhere.test" }))).status).toBe(403);
    process.env.PUBLIC_URL = "https://moved.crucible.test";
    expect((await POST(statusRequest({ CallSid: "CA1", CallStatus: "failed" }))).status).toBe(403);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});
