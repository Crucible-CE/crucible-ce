import { describe, expect, it, vi } from "vitest";
import { audienceIsEmpty, audienceSchema, mergeTargets } from "./audience";
import { planBroadcastChannels } from "./send";
import { summarizeBroadcast } from "./summary";
import { renderEmail, renderSms, renderVoice } from "@/lib/delivery/render";
import type { DeliveryMessage, RegisteredProvider } from "@/lib/delivery/types";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/transport", async (orig) => ({ ...(await orig<typeof import("@/lib/email/transport")>()), activeEmailTransport: () => "smtp" }));

describe("broadcast audience", () => {
  it("rejects unknown keys and roles, and knows when nothing is picked", () => {
    expect(audienceSchema.safeParse({ allMembers: true }).success).toBe(true);
    expect(audienceSchema.safeParse({ roles: ["exercise_god"] }).success).toBe(false);
    expect(audienceSchema.safeParse({ everyone: true }).success).toBe(false);
    expect(audienceIsEmpty({})).toBe(true);
    expect(audienceIsEmpty({ roles: [] })).toBe(true);
    expect(audienceIsEmpty({ contactTiers: [1] })).toBe(false);
  });

  it("merges a contact linked to a picked member and dials only verified contact phones", () => {
    const targets = mergeTargets(
      [{ id: "u1", name: "Ada", email: "ada@example.test" }],
      new Map([["u1", { phone: "+15555550101", blocked: null }]]),
      [
        { id: "c1", name: "Ada contact", email: "alt@example.test", phone: "+15555550199", userId: "u1", phoneVerifiedAt: new Date(), allowUnverifiedPhone: false },
        { id: "c2", name: "Counsel", email: "c@law.example", phone: "+15555550100", userId: null, phoneVerifiedAt: null, allowUnverifiedPhone: false },
        { id: "c3", name: "Vendor", email: null, phone: "+15555550102", userId: null, phoneVerifiedAt: null, allowUnverifiedPhone: true },
      ],
    );
    expect(targets).toEqual([
      { userId: "u1", contactId: "c1", name: "Ada", email: "ada@example.test", phone: "+15555550101", phoneBlocked: null },
      { userId: null, contactId: "c2", name: "Counsel", email: "c@law.example", phone: null, phoneBlocked: "phone not verified" },
      { userId: null, contactId: "c3", name: "Vendor", email: null, phone: "+15555550102", phoneBlocked: null },
    ]);
  });
});

function reg(id: string, channels: string[], addressed: boolean, configured = true): RegisteredProvider {
  return { provider: { id, displayName: id, channels: channels as never, isConfigured: () => configured, send: async () => ({ status: "sent" }) }, source: "builtin", addressed };
}

describe("planBroadcastChannels", () => {
  it("maps channels to providers and marks unconfigured ones", () => {
    const providers = [reg("smtp", ["email"], true), reg("twilio-sms", ["sms"], true, false), reg("webhook", ["webhook"], false), reg("ntfy", ["push"], false, false)];
    const plan = planBroadcastChannels(["app", "email", "sms", "webhook"], providers);
    expect(plan.map((p) => [p.channel, p.providerId, !!p.notConfigured])).toEqual([
      ["app", "app", false],
      ["email", "smtp", false],
      ["sms", "twilio-sms", true],
      ["webhook", "webhook", false],
    ]);
  });
});

describe("summarizeBroadcast", () => {
  it("counts acknowledgements and channel outcomes", () => {
    const s = summarizeBroadcast([
      { acknowledgedAt: new Date(), deliveries: [{ channel: "app", status: "sent" }, { channel: "email", status: "failed" }] },
      { acknowledgedAt: null, deliveries: [{ channel: "app", status: "sent" }, { channel: "email", status: "skipped" }, { channel: "sms", status: "pending" }] },
    ]);
    expect(s.recipientCount).toBe(2);
    expect(s.ackedCount).toBe(1);
    expect(s.channelSummary).toEqual({
      app: { sent: 2, failed: 0, skipped: 0, pending: 0 },
      email: { sent: 0, failed: 1, skipped: 1, pending: 0 },
      sms: { sent: 0, failed: 0, skipped: 0, pending: 1 },
    });
  });
});

describe("broadcast rendering", () => {
  const msg: DeliveryMessage = { kind: "broadcast", id: "broadcast:r1:smtp", attempt: 1, incident: null, page: null, title: "Bridge open", text: "Join now.", ackUrl: "https://crucible.example/api/public/page-ack/x", sentAt: "2026-10-26T12:00:00Z" };
  it("says message, not page, and never offers an SMS ACK reply", () => {
    const email = renderEmail(msg);
    expect(email.text).toContain("Acknowledge: https://crucible.example/api/public/page-ack/x");
    expect(email.html).not.toContain("stops escalation");
    expect(renderSms(msg, true)).not.toContain("Reply ACK");
    expect(renderVoice(msg)).toBe("This is an automated message from Crucible. Bridge open. Join now.");
  });
});
