// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ findMany: vi.fn(), acknowledgePage: vi.fn(), contactFindFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { pageDelivery: { findMany: h.findMany }, escalationContact: { findFirst: h.contactFindFirst } } }));
vi.mock("@/lib/incident/access", () => ({ canUserSeeIncident: vi.fn(async () => false) }));
vi.mock("@/lib/escalation/engine", () => ({ acknowledgePage: h.acknowledgePage }));

import { POST } from "./route";
import { twilioExpectedSignature } from "@/lib/delivery/twilio-webhook";

const URL_PATH = "/api/public/twilio/inbound";

function signedRequest(params: Record<string, string>, opts: { badSig?: boolean } = {}) {
  const sig = twilioExpectedSignature(`https://crucible.test${URL_PATH}`, params, "tok");
  return new Request(`http://internal:3000${URL_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": opts.badSig ? "AAAA" : sig },
    body: new URLSearchParams(params).toString(),
  });
}

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.PUBLIC_URL = "https://crucible.test";
  vi.clearAllMocks();
});

describe("Twilio inbound SMS ack", () => {
  it("rejects a forged request", async () => {
    const res = await POST(signedRequest({ From: "+15550001111", Body: "ACK" }, { badSig: true }));
    expect(res.status).toBe(403);
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("'ACK' acks the most recent open page delivered to that number at its current level", async () => {
    h.findMany.mockResolvedValue([
      { pageId: "p-stale", level: 0, page: { escalationLevel: 1, targetUserId: "u-new", incident: { title: "Old", restricted: false } } },
      { pageId: "p-live", level: 0, page: { escalationLevel: 0, targetUserId: "u1", incident: { title: "Live & real", restricted: false } } },
    ]);
    h.acknowledgePage.mockResolvedValue(true);
    const res = await POST(signedRequest({ From: "+15550001111", Body: " ack " }));
    const xml = await res.text();
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(xml).toContain("acknowledged \"Live &amp; real\"");
    expect(h.acknowledgePage).toHaveBeenCalledWith("p-live", { userId: "u1", via: "sms", level: 0 });
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ destination: "+15550001111", status: "sent" });
  });

  it("a request signed for a different public URL (PUBLIC_URL mismatch) is 403", async () => {
    process.env.PUBLIC_URL = "https://moved.crucible.test";
    const res = await POST(signedRequest({ From: "+15550001111", Body: "ACK" }));
    expect(res.status).toBe(403);
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });

  it("compares the sender in E.164 (a national-format From still matches)", async () => {
    h.findMany.mockResolvedValue([]);
    await POST(signedRequest({ From: "(555) 000-1111", Body: "ACK" }));
    expect(h.findMany.mock.calls[0][0].where).toMatchObject({ destination: "+15550001111" });
  });

  it("LOCKED incident: the ACK reply to a target the lock excludes never carries the title", async () => {
    h.findMany.mockResolvedValue([
      {
        pageId: "p-locked",
        level: 0,
        page: { organizationId: "org1", incidentId: "inc1", escalationLevel: 0, targetUserId: null, targetContactId: "ec1", incident: { title: "Insider case", restricted: true } },
      },
    ]);
    h.contactFindFirst.mockResolvedValue({ userId: null }); // pure external contact
    h.acknowledgePage.mockResolvedValue(true);
    const xml = await (await POST(signedRequest({ From: "+15550001111", Body: "ACK" }))).text();
    expect(xml).not.toContain("Insider case");
    expect(xml).toContain("restricted incident");
    expect(h.acknowledgePage).toHaveBeenCalledWith("p-locked", { userId: null, via: "sms", level: 0 });
  });

  it("other text gets help; no open page gets a clear reply", async () => {
    expect(await (await POST(signedRequest({ From: "+15550001111", Body: "hello" }))).text()).toContain("reply ACK");
    h.findMany.mockResolvedValue([]);
    expect(await (await POST(signedRequest({ From: "+15550001111", Body: "1" }))).text()).toContain("no open page");
    expect(h.acknowledgePage).not.toHaveBeenCalled();
  });
});
