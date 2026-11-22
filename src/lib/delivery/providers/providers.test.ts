// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DeliveryMessage, DeliveryRecipient } from "../types";
import { verifySignature } from "../signing";

// ---- transport mocks -------------------------------------------------------
const { mockSendMail, mockCreateTransport, mockResendSend } = vi.hoisted(() => {
  const mockSendMail = vi.fn();
  return {
    mockSendMail,
    mockCreateTransport: vi.fn(() => ({ sendMail: mockSendMail })),
    mockResendSend: vi.fn(),
  };
});
vi.mock("nodemailer", () => ({ default: { createTransport: mockCreateTransport } }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockResendSend };
  },
}));

import { createResendProvider, createSmtpProvider } from "./email";
import { buildVoiceTwiml, createTwilioSmsProvider, createTwilioVoiceProvider, escapeXml } from "./twilio";
import { createWebhookProvider, webhookBootWarnings, webhookTargetsFromEnv } from "./webhook";
import { createPluginGuardedPost } from "../outbound-http";
import { renderEmail, renderSms, renderVoice, SMS_MAX_CHARS, VOICE_MAX_CHARS } from "../render";
import { activeEmailTransport } from "@/lib/email/transport";
import { getFromEmail } from "@/lib/email/resend";

const ENV_KEYS = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_SECURE", "SMTP_FROM", "FROM_EMAIL",
  "RESEND_API_KEY", "EMAIL_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
  "PUBLIC_URL", "TWILIO_INBOUND_ACK", "SMTP_REQUIRE_TLS", "DELIVERY_WEBHOOK_ALLOW_PRIVATE",
];
const saved: Record<string, string | undefined> = {};

const msg: DeliveryMessage = {
  kind: "page",
  id: "cmpage0000000000000000001:0:smtp",
  attempt: 1,
  incident: { id: "inc1", title: "Ransomware <on> file servers", severity: "critical", url: "https://crucible.test/incidents/inc1" },
  page: { id: "cmpage0000000000000000001", level: 0, priority: "critical" },
  title: "[CRITICAL] Paged: Ransomware <on> file servers",
  text: "Ada paged you to a critical incident. Note: join the bridge & hurry",
  ackUrl: "https://crucible.test/api/public/page-ack/cmpage0000000000000000001.0.1999999999.abcdefghijklmnopqrstuv",
  sentAt: "2026-10-14T12:00:00.000Z",
};
const who: DeliveryRecipient = { name: "Grace", email: "grace@acme.test", phone: "+15550001111", userId: "u1" };
const restrictedMsg: DeliveryMessage = {
  ...msg,
  incident: { id: "", title: "Restricted incident", severity: "critical", url: "" },
  title: "[CRITICAL] Restricted incident page",
  text: "Crucible: you are paged for a restricted incident (severity critical).",
  restricted: true,
};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("SMTP provider (nodemailer)", () => {
  it("is unconfigured without SMTP_HOST and skips honestly", async () => {
    const p = createSmtpProvider();
    expect(p.isConfigured()).toBe(false);
    expect(await p.send(msg, who)).toEqual({ status: "skipped", error: "not configured" });
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });

  it("sends via the configured transport with escaped HTML, ack link and headers", async () => {
    process.env.SMTP_HOST = "mail.acme.test";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_USER = "relay";
    process.env.SMTP_PASS = "pw";
    process.env.SMTP_FROM = "Crucible <pager@acme.test>";
    mockSendMail.mockResolvedValue({ messageId: "<abc@acme.test>", rejected: [] });

    const r = await createSmtpProvider().send(msg, who);
    expect(r).toEqual({ status: "sent", providerRef: "<abc@acme.test>" });
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "mail.acme.test", port: 2525, secure: false, auth: { user: "relay", pass: "pw" } }),
    );
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail).toMatchObject({ from: "Crucible <pager@acme.test>", to: "grace@acme.test", subject: msg.title });
    expect(mail.html).toContain("&lt;on&gt;");
    expect(mail.html).not.toContain("<on>");
    expect(mail.html).toContain(msg.ackUrl);
    expect(mail.text).toContain(`Acknowledge this page: ${msg.ackUrl}`);
    expect(mail.headers).toMatchObject({ "X-Crucible-Kind": "page", "X-Crucible-Incident": "inc1", "Auto-Submitted": "auto-generated" });
  });

  it("SMTP_SECURE=true defaults to 465; no auth without SMTP_USER; failures -> failed", async () => {
    process.env.SMTP_HOST = "mail.acme.test";
    process.env.SMTP_SECURE = "true";
    mockSendMail.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const r = await createSmtpProvider().send(msg, who);
    expect(r).toEqual({ status: "failed", error: "connect ECONNREFUSED" });
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true, auth: undefined }));
  });

  it("SMTP_REQUIRE_TLS: on by default for remote hosts, off for loopback, env overrides", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<m>", rejected: [] });
    const lastOpts = () => (mockCreateTransport.mock.calls as unknown[][]).at(-1)![0] as { requireTLS: boolean; secure: boolean };

    process.env.SMTP_HOST = "smtp.relay.test";
    await createSmtpProvider().send(msg, who);
    expect(lastOpts().requireTLS).toBe(true);

    for (const host of ["localhost", "127.0.0.1", "::1"]) {
      process.env.SMTP_HOST = host;
      await createSmtpProvider().send(msg, who);
      expect(lastOpts().requireTLS).toBe(false);
    }

    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_REQUIRE_TLS = "true";
    await createSmtpProvider().send(msg, who);
    expect(lastOpts().requireTLS).toBe(true);

    process.env.SMTP_HOST = "mailpit";
    process.env.SMTP_REQUIRE_TLS = "false";
    await createSmtpProvider().send(msg, who);
    expect(lastOpts().requireTLS).toBe(false);

    // Implicit TLS: requireTLS (a STARTTLS rule) does not apply.
    process.env.SMTP_HOST = "smtp.relay.test";
    process.env.SMTP_SECURE = "true";
    delete process.env.SMTP_REQUIRE_TLS;
    await createSmtpProvider().send(msg, who);
    expect(lastOpts()).toMatchObject({ secure: true, requireTLS: false });
  });

  it("skips recipients with no email", async () => {
    process.env.SMTP_HOST = "mail.acme.test";
    expect(await createSmtpProvider().send(msg, { name: "x" })).toEqual({ status: "skipped", error: "No email address on file" });
  });
});

describe("Resend provider", () => {
  it("sends with FROM_EMAIL and reports the id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.FROM_EMAIL = "alerts@acme.test";
    mockResendSend.mockResolvedValue({ data: { id: "re_123" }, error: null });
    expect(await createResendProvider().send(msg, who)).toEqual({ status: "sent", providerRef: "re_123" });
    expect(mockResendSend.mock.calls[0][0]).toMatchObject({ from: "alerts@acme.test", to: "grace@acme.test" });
  });

  it("an EMPTY FROM_EMAIL (docker compose default) falls back instead of sending From: ''", () => {
    process.env.FROM_EMAIL = "";
    expect(getFromEmail()).toBe("noreply@localhost.invalid");
  });

  it("provider error -> failed", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mockResendSend.mockResolvedValue({ data: null, error: { message: "domain not verified" } });
    expect(await createResendProvider().send(msg, who)).toEqual({ status: "failed", error: "domain not verified" });
  });
});

describe("active email transport", () => {
  it("prefers SMTP, falls back to Resend, honors EMAIL_PROVIDER", () => {
    expect(activeEmailTransport()).toBeNull();
    process.env.RESEND_API_KEY = "re_x";
    expect(activeEmailTransport()).toBe("resend");
    process.env.SMTP_HOST = "mail";
    expect(activeEmailTransport()).toBe("smtp");
    process.env.EMAIL_PROVIDER = "resend";
    expect(activeEmailTransport()).toBe("resend");
  });
});

describe("Twilio SMS + voice providers", () => {
  const twilio = () => {
    process.env.TWILIO_ACCOUNT_SID = "AC123";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_FROM_NUMBER = "+15550009999";
  };

  it("SMS posts to Twilio with the ack link; reply-ACK hint only when enabled", async () => {
    twilio();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
    expect(await createTwilioSmsProvider().send(msg, who)).toEqual({ status: "sent", providerRef: "SM1" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("To")).toBe("+15550001111");
    expect(body.get("Body")).toContain(`Ack: ${msg.ackUrl}`);
    expect(body.get("Body")).not.toContain("Reply ACK");

    process.env.TWILIO_INBOUND_ACK = "true";
    await createTwilioSmsProvider().send(msg, who);
    expect(new URLSearchParams((fetchSpy.mock.calls[1][1] as RequestInit).body as string).get("Body")).toContain("Reply ACK");
  });

  it("unconfigured / no phone -> skipped; HTTP 400 -> failed", async () => {
    expect(await createTwilioSmsProvider().send(msg, who)).toEqual({ status: "skipped", error: "not configured" });
    twilio();
    expect(await createTwilioVoiceProvider().send(msg, { name: "x", email: "a@b" })).toEqual({ status: "skipped", error: "No phone number on file" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "Invalid 'To'" }), { status: 400 }));
    expect(await createTwilioSmsProvider().send(msg, who)).toEqual({ status: "failed", error: "Invalid 'To'" });
  });

  it("voice uses Gather (press 1) when PUBLIC_URL is https, plain Say otherwise", async () => {
    twilio();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ sid: "CA1" }), { status: 201 }));
    await createTwilioVoiceProvider().send(msg, who);
    const plain = new URLSearchParams((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(plain.get("Twiml")).not.toContain("<Gather");
    expect(plain.get("StatusCallback")).toBeNull();

    process.env.PUBLIC_URL = "https://crucible.acme.test";
    await createTwilioVoiceProvider().send(msg, who);
    const g = new URLSearchParams((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    const twiml = g.get("Twiml")!;
    expect(twiml).toContain('<Gather numDigits="1"');
    expect(twiml).toContain("https://crucible.acme.test/api/public/twilio/voice?t=cmpage0000000000000000001.0.1999999999.abcdefghijklmnopqrstuv");
    expect(twiml).toContain("Press 1 to acknowledge");
    expect(twiml).toContain("&lt;on&gt;");
    expect(g.get("StatusCallback")).toBe("https://crucible.acme.test/api/public/twilio/status");
  });

  it("buildVoiceTwiml escapes the action URL", () => {
    expect(buildVoiceTwiml("hi", "https://x.test/v?t=a&b")).toContain('action="https://x.test/v?t=a&amp;b"');
  });
});

describe("signed webhook provider", () => {
  it("parses URL lists and numbered URLs", () => {
    const t = webhookTargetsFromEnv({
      DELIVERY_WEBHOOK_URL: "https://a.test/h, https://b.test/h",
      DELIVERY_WEBHOOK_SECRET: "s1",
      DELIVERY_WEBHOOK_URL_3: "https://c.test/h",
      DELIVERY_WEBHOOK_SECRET_3: "s3",
    } as unknown as NodeJS.ProcessEnv);
    expect(t).toEqual([
      { id: "webhook", url: "https://a.test/h", secret: "s1" },
      { id: "webhook-2", url: "https://b.test/h", secret: "s1" },
      { id: "webhook-3", url: "https://c.test/h", secret: "s3" },
    ]);
  });

  it("POSTs a signed JSON payload the receiver can verify", async () => {
    const post = vi.fn().mockResolvedValue({ status: 204, body: "" });
    const p = createWebhookProvider({ id: "webhook", url: "https://hooks.acme.test/crucible", secret: "whsec" }, { post, now: () => 1_760_000_000 });
    expect(p.isConfigured()).toBe(true);
    expect(await p.send(msg, who)).toEqual({ status: "sent", providerRef: "HTTP 204" });

    const [url, body, headers, opts] = post.mock.calls[0];
    expect(url).toBe("https://hooks.acme.test/crucible");
    expect(opts).toEqual({ timeoutMs: 10_000, allowPrivate: false });
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Crucible-Timestamp"]).toBe("1760000000");
    expect(verifySignature("whsec", body, headers["X-Crucible-Signature"], { now: 1_760_000_005 })).toBe(true);
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      version: 1,
      type: "crucible.page",
      id: msg.id,
      ackUrl: msg.ackUrl,
      incident: { id: "inc1", severity: "critical" },
      recipient: { name: "Grace", email: "grace@acme.test", phone: "+15550001111", userId: "u1", contactId: null },
    });
  });

  it("no secret -> not configured; 3xx/5xx/transport errors -> failed", async () => {
    expect(createWebhookProvider({ id: "webhook", url: "https://x.test", secret: null }).isConfigured()).toBe(false);
    const redirect = createWebhookProvider({ id: "w", url: "https://x.test", secret: "s" }, { post: vi.fn().mockResolvedValue({ status: 302, body: "" }) });
    expect((await redirect.send(msg, who)).error).toContain("redirects are not followed");
    const err = createWebhookProvider({ id: "w", url: "https://x.test", secret: "s" }, { post: vi.fn().mockResolvedValue({ status: 503, body: "busy" }) });
    expect(await err.send(msg, who)).toEqual({ status: "failed", error: "HTTP 503: busy" });
    const boom = createWebhookProvider({ id: "w", url: "https://x.test", secret: "s" }, { post: vi.fn().mockRejectedValue(new Error("timed out")) });
    expect(await boom.send(msg, who)).toEqual({ status: "failed", error: "timed out" });
  });

  it("the real transport refuses private targets before connecting", async () => {
    const p = createWebhookProvider({ id: "w", url: "https://169.254.169.254/latest", secret: "s" }, { allowPrivate: false });
    const r = await p.send(msg, who);
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/private|loopback|link-local/);
  });

  it("idempotency key has no attempt; attempt is its own field + header, covered by the signature", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, body: "" });
    const p = createWebhookProvider({ id: "webhook", url: "https://hooks.acme.test/c", secret: "whsec" }, { post, now: () => 1_760_000_000 });
    await p.send({ ...msg, attempt: 3 }, who);
    const [, body, headers] = post.mock.calls[0];
    const payload = JSON.parse(body);
    expect(payload.id).toBe("cmpage0000000000000000001:0:smtp");
    expect(payload.attempt).toBe(3);
    expect(payload.restricted).toBe(false);
    expect(headers["X-Crucible-Delivery"]).toBe(payload.id);
    expect(headers["X-Crucible-Delivery-Attempt"]).toBe("3");
    // Tampering with the attempt breaks the signature.
    expect(verifySignature("whsec", body.replace('"attempt":3', '"attempt":1'), headers["X-Crucible-Signature"], { now: 1_760_000_001 })).toBe(false);
  });

  it("restricted pages carry restricted: true and no title / deep link", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, body: "" });
    const p = createWebhookProvider({ id: "webhook", url: "https://hooks.acme.test/c", secret: "whsec" }, { post });
    await p.send(restrictedMsg, who);
    const payload = JSON.parse(post.mock.calls[0][1]);
    expect(payload.restricted).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("Ransomware");
    expect(payload.incident).toEqual({ id: "", title: "Restricted incident", severity: "critical", url: "" });
  });

  it("plain http:// is refused unless DELIVERY_WEBHOOK_ALLOW_PRIVATE; Settings gets the reason", async () => {
    const post = vi.fn().mockResolvedValue({ status: 200, body: "" });
    const plain = createWebhookProvider({ id: "w", url: "http://hooks.acme.test/c", secret: "s" }, { post, allowPrivate: false });
    expect(plain.isConfigured()).toBe(false);
    expect(plain.notConfiguredReason?.()).toMatch(/http:\/\/ not allowed/);
    expect((await plain.send(msg, who)).status).toBe("skipped");
    expect(post).not.toHaveBeenCalled();
    expect(createWebhookProvider({ id: "w", url: "http://hooks.acme.test/c", secret: "s" }, { post, allowPrivate: true }).isConfigured()).toBe(true);
    expect(createWebhookProvider({ id: "w", url: "https://x.test", secret: null }).notConfiguredReason?.()).toMatch(/DELIVERY_WEBHOOK_SECRET not set/);
  });

  it("boot warnings name secret-less and http:// webhooks", () => {
    const w = webhookBootWarnings({
      DELIVERY_WEBHOOK_URL: "http://a.test/h",
      DELIVERY_WEBHOOK_URL_2: "https://b.test/h",
    } as unknown as NodeJS.ProcessEnv);
    expect(w.some((s) => s.includes('"webhook"') && s.includes("no DELIVERY_WEBHOOK_SECRET"))).toBe(true);
    expect(w.some((s) => s.includes('"webhook-2"') && s.includes("no DELIVERY_WEBHOOK_SECRET"))).toBe(true);
    expect(w.some((s) => s.includes("plain http://: refused"))).toBe(true);
  });
});

describe("plugin ctx.guardedPost", () => {
  it("refuses http:// and passes the SSRF options through, with a capped timeout", async () => {
    const post = vi.fn().mockResolvedValue({ status: 201, body: '{"id":"x"}' });
    const gp = createPluginGuardedPost({} as NodeJS.ProcessEnv, post);
    await expect(gp("http://ntfy.local/t", { body: "hi" })).rejects.toThrow(/http:\/\/ not allowed/);
    expect(await gp("https://ntfy.sh/t", { body: "hi", headers: { Title: "x" }, timeoutMs: 999_999 })).toEqual({ status: 201, body: '{"id":"x"}' });
    expect(post).toHaveBeenCalledWith("https://ntfy.sh/t", "hi", { Title: "x" }, { timeoutMs: 20_000, allowPrivate: false });
    const dev = createPluginGuardedPost({ DELIVERY_WEBHOOK_ALLOW_PRIVATE: "true" } as unknown as NodeJS.ProcessEnv, post);
    await dev("http://ntfy.local/t", { body: "hi" });
    expect(post.mock.calls[1][3]).toEqual({ timeoutMs: 10_000, allowPrivate: true });
  });

  it("the real guarded transport refuses loopback targets", async () => {
    const gp = createPluginGuardedPost({} as NodeJS.ProcessEnv);
    await expect(gp("https://127.0.0.1/x", { body: "" })).rejects.toThrow(/private|loopback/);
  });
});

describe("example ntfy plugin", () => {
  it("sends through ctx.guardedPost (never raw fetch) and drops the deep link on restricted pages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const guardedPost = vi.fn().mockResolvedValue({ status: 200, body: '{"id":"n1"}' });
    const mod = (await import("../../../../providers/example-ntfy.mjs")) as unknown as {
      default: (ctx: unknown) => import("../types").DeliveryProvider;
    };
    const p = mod.default({ env: { NTFY_TOPIC: "t" }, logger: console, guardedPost });
    expect(await p.send(msg, who)).toEqual({ status: "sent", providerRef: "n1" });
    expect(guardedPost.mock.calls[0][0]).toBe("https://ntfy.sh/t");
    expect(guardedPost.mock.calls[0][1].headers.Click).toBe(msg.incident!.url);
    await p.send(restrictedMsg, who);
    const h = guardedPost.mock.calls[1][1].headers;
    expect(h.Click).toBeUndefined();
    expect(h.Title).not.toContain("Ransomware");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("render bounds", () => {
  const huge = "x".repeat(5000);
  it("SMS never exceeds 1600 chars and never truncates the ack URL", () => {
    for (const replyAck of [false, true]) {
      const body = renderSms({ ...msg, text: huge, title: huge }, replyAck);
      expect(body.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
      expect(body.endsWith(msg.ackUrl!)).toBe(true);
      expect(body).toContain(` Open: ${msg.incident!.url} `);
    }
    expect(renderSms(msg, false)).toBe(
      `Crucible: ${msg.title}. ${msg.text} Open: ${msg.incident!.url} Ack: ${msg.ackUrl}`,
    );
  });

  it("unrestricted SMS links to the incident; redacted SMS never does", () => {
    expect(renderSms(msg, false)).toContain(msg.incident!.url);
    expect(renderSms(restrictedMsg, false)).not.toContain("/incidents/");
  });

  it("redacted SMS is exactly the restricted sentence + the ack link", () => {
    expect(renderSms(restrictedMsg, false)).toBe(
      `Crucible: you are paged for a restricted incident (severity critical). Acknowledge: ${restrictedMsg.ackUrl}`,
    );
  });

  it("voice script is bounded and redacted voice has no title", () => {
    expect(renderVoice({ ...msg, text: huge }).length).toBeLessThanOrEqual(VOICE_MAX_CHARS);
    const v = renderVoice(restrictedMsg);
    expect(v).not.toContain("Ransomware");
    expect(v).toContain("restricted incident");
  });

  it("redacted email has no incident link or title", () => {
    const e = renderEmail(restrictedMsg);
    expect(`${e.subject} ${e.html} ${e.text}`).not.toContain("Ransomware");
    expect(e.html).not.toContain("Open in Crucible");
    expect(e.text).toContain(restrictedMsg.ackUrl);
  });

  it("TwiML strips XML-invalid control characters as well as escaping", () => {
    const twiml = buildVoiceTwiml("bad\u0000\u0007\u001b title <x> & ￾ ok \uD800", null);
    expect(twiml).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾\uD800]/);
    expect(twiml).toContain("bad title &lt;x&gt; &amp;  ok");
    expect(escapeXml("a\u0001b")).toBe("ab");
  });
});
