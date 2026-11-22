// Twilio SMS + voice. Bare-fetch REST calls, no SDK dependency.
//
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
//
// Voice uses inline TwiML on the Calls API, so the outbound call needs no
// public TwiML webhook. When PUBLIC_URL is https the call also <Gather>s one
// digit ("press 1 to acknowledge") posting to /api/public/twilio/voice, and
// delivery-status callbacks go to /api/public/twilio/status. SMS reply "ACK"
// needs the number's Messaging webhook pointed at /api/public/twilio/inbound
// (docs/paging.md) and TWILIO_INBOUND_ACK=true so the SMS tells people they can.

import { renderSms, renderVoice, truncateText, VOICE_MAX_CHARS } from "../render";
import type { DeliveryMessage, DeliveryProvider, DeliveryRecipient, DeliveryResult } from "../types";

const API_BASE = "https://api.twilio.com/2010-04-01";

function creds(): { sid: string; token: string; from: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

export function twilioConfigured(): boolean {
  return creds() !== null;
}

/** https PUBLIC_URL base, or null (Twilio callbacks need a public https URL). */
export function twilioCallbackBase(): string | null {
  const base = process.env.PUBLIC_URL?.trim();
  if (!base || !base.startsWith("https://")) return null;
  return base.replace(/\/+$/, "");
}

export function inboundSmsAckEnabled(): boolean {
  return (process.env.TWILIO_INBOUND_ACK ?? "").trim().toLowerCase() === "true";
}

async function twilioPost(path: string, form: Record<string, string>): Promise<{ ok: boolean; sid?: string; detail?: string }> {
  const c = creds();
  if (!c) return { ok: false, detail: "Twilio not configured" };
  try {
    const res = await fetch(`${API_BASE}/Accounts/${c.sid}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (res.status === 200 || res.status === 201) return { ok: true, sid: body.sid };
    return { ok: false, detail: body.message ?? `Twilio HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function twilioSendSms(to: string, body: string): Promise<{ ok: boolean; sid?: string; detail?: string }> {
  const c = creds();
  if (!c) return { ok: false, detail: "Twilio not configured" };
  const cb = twilioCallbackBase();
  return twilioPost("/Messages.json", {
    From: c.from,
    To: to,
    Body: body.slice(0, 1600), // Twilio hard cap
    ...(cb ? { StatusCallback: `${cb}/api/public/twilio/status` } : {}),
  });
}

/**
 * Characters XML 1.0 cannot carry at all (C0 controls other than tab/LF/CR,
 * lone surrogates, U+FFFE/U+FFFF). Escaping can't make them legal, and one of
 * them in an incident title would make Twilio reject the whole TwiML.
 */
const XML_INVALID = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function stripXmlInvalid(s: string): string {
  return s.replace(XML_INVALID, "");
}

/** Escape for TwiML text/attributes, after stripping XML-invalid characters. */
export function escapeXml(s: string): string {
  return stripXmlInvalid(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * TwiML for a voice page. With a Gather URL the message is read inside
 * <Gather numDigits=1>; pressing 1 posts Digits to the action URL. Without it
 * (no https PUBLIC_URL) it is a plain read-out, said twice for voicemail.
 */
export function buildVoiceTwiml(spoken: string, gatherActionUrl: string | null): string {
  const say = escapeXml(truncateText(spoken, VOICE_MAX_CHARS));
  if (gatherActionUrl) {
    const action = escapeXml(gatherActionUrl);
    return (
      `<Response><Pause length="1"/>` +
      `<Gather numDigits="1" timeout="8" method="POST" action="${action}">` +
      `<Say>${say}</Say><Say>Press 1 to acknowledge this page.</Say></Gather>` +
      `<Gather numDigits="1" timeout="8" method="POST" action="${action}">` +
      `<Say>Repeating. ${say}</Say><Say>Press 1 to acknowledge this page.</Say></Gather>` +
      `<Say>No acknowledgement received. Goodbye.</Say></Response>`
    );
  }
  return `<Response><Pause length="1"/><Say>${say}</Say><Pause length="1"/><Say>Repeating. ${say}</Say></Response>`;
}

export async function twilioPlaceVoice(to: string, twiml: string): Promise<{ ok: boolean; sid?: string; detail?: string }> {
  const c = creds();
  if (!c) return { ok: false, detail: "Twilio not configured" };
  const cb = twilioCallbackBase();
  return twilioPost("/Calls.json", {
    From: c.from,
    To: to,
    Twiml: twiml,
    ...(cb ? { StatusCallback: `${cb}/api/public/twilio/status` } : {}),
  });
}

/** The ack token is the last path segment of the signed ack link. */
function ackTokenFrom(msg: DeliveryMessage): string | null {
  if (!msg.ackUrl) return null;
  try {
    return new URL(msg.ackUrl).pathname.split("/").filter(Boolean).pop() ?? null;
  } catch {
    return null;
  }
}

export function createTwilioSmsProvider(): DeliveryProvider {
  return {
    id: "twilio-sms",
    displayName: "SMS (Twilio)",
    channels: ["sms"],
    isConfigured: twilioConfigured,
    async send(msg: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult> {
      if (!recipient.phone) return { status: "skipped", error: "No phone number on file" };
      if (!twilioConfigured()) return { status: "skipped", error: "not configured" };
      const r = await twilioSendSms(recipient.phone, renderSms(msg, inboundSmsAckEnabled() && msg.ackUrl != null));
      return r.ok ? { status: "sent", providerRef: r.sid } : { status: "failed", error: r.detail ?? "Twilio send failed" };
    },
  };
}

export function createTwilioVoiceProvider(): DeliveryProvider {
  return {
    id: "twilio-voice",
    displayName: "Voice call (Twilio)",
    channels: ["voice"],
    isConfigured: twilioConfigured,
    async send(msg: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult> {
      if (!recipient.phone) return { status: "skipped", error: "No phone number on file" };
      if (!twilioConfigured()) return { status: "skipped", error: "not configured" };
      const base = twilioCallbackBase();
      const token = ackTokenFrom(msg);
      const gather = base && token ? `${base}/api/public/twilio/voice?t=${encodeURIComponent(token)}` : null;
      const r = await twilioPlaceVoice(recipient.phone, buildVoiceTwiml(renderVoice(msg), gather));
      return r.ok ? { status: "sent", providerRef: r.sid } : { status: "failed", error: r.detail ?? "Twilio call failed" };
    },
  };
}
