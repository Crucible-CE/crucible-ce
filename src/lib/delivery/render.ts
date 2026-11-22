// Channel renderings of a DeliveryMessage. Providers call these so every
// built-in channel says the same thing in its own medium.
//
// Restricted (redacted) messages carry only severity + the ack link: no
// incident title, no pager note, no incident deep link (lib/delivery/redaction).

import { escapeHtml } from "@/lib/email/transport";
import type { DeliveryMessage } from "./types";

/** Twilio's hard cap on one (concatenated) SMS body. */
export const SMS_MAX_CHARS = 1600;
/** Bound on the spoken voice script (read twice per call). */
export const VOICE_MAX_CHARS = 800;

/** Truncate to `max` UTF-16 units with an ellipsis, never splitting a surrogate pair. */
export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, Math.max(0, max));
  let cut = max - 1;
  const code = s.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // don't leave a lone high surrogate
  return `${s.slice(0, cut).trimEnd()}…`;
}

export function renderEmail(msg: DeliveryMessage): { subject: string; html: string; text: string } {
  const incidentUrl = !msg.restricted && msg.incident?.url ? msg.incident.url : null;
  const lines = [msg.text];
  const broadcast = msg.kind === "broadcast";
  if (msg.ackUrl) lines.push("", `${broadcast ? "Acknowledge" : "Acknowledge this page"}: ${msg.ackUrl}`);
  if (incidentUrl) lines.push("", `Open the incident: ${incidentUrl}`);
  const text = lines.join("\n");
  const button = (href: string, label: string, bg: string) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;background:${bg};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;margin-right:8px">${label}</a>`;
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="font-size:17px;margin:0 0 12px">${escapeHtml(msg.title)}</h2>
      <p style="font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${escapeHtml(msg.text)}</p>
      <p style="margin-top:20px">
        ${msg.ackUrl ? button(msg.ackUrl, "Acknowledge", "#dc2626") : ""}
        ${incidentUrl ? button(incidentUrl, "Open in Crucible", "#4f46e5") : ""}
      </p>
      ${msg.ackUrl ? `<p style="font-size:12px;color:#666">${broadcast ? "The link works once and expires." : "The link works once and expires. Acknowledging stops escalation."}</p>` : ""}
    </div>`;
  return { subject: msg.title, html, text };
}

/**
 * SMS body, at most SMS_MAX_CHARS. The links are never truncated: the
 * headline + text are shortened to make room for them. Unrestricted pages
 * carry the incident deep link and the ack link; restricted (redacted) pages
 * carry only the ack link. `replyAck` adds the reply instruction when inbound
 * SMS ack is wired.
 */
export function renderSms(msg: DeliveryMessage, replyAck: boolean): string {
  const incidentUrl = !msg.restricted && msg.incident?.url ? msg.incident.url : null;
  // Restricted text already starts with "Crucible:"; prefix the unrestricted one.
  const head = msg.restricted ? msg.text : `Crucible: ${msg.title}. ${msg.text}`;
  let tail = "";
  if (incidentUrl) tail += ` Open: ${incidentUrl}`;
  if (msg.ackUrl) {
    // Inbound "ACK" replies resolve pages only, so broadcasts never offer it.
    if (replyAck && msg.kind !== "broadcast") tail += ` Reply ACK or acknowledge: ${msg.ackUrl}`;
    else tail += msg.restricted ? ` Acknowledge: ${msg.ackUrl}` : ` Ack: ${msg.ackUrl}`;
  }
  const room = SMS_MAX_CHARS - tail.length;
  if (room < 20) return tail.trim(); // pathological ack URL: the link matters more than prose
  return `${truncateText(head, room)}${tail}`;
}

/** Spoken script for the voice channel, at most VOICE_MAX_CHARS. */
export function renderVoice(msg: DeliveryMessage): string {
  const intro = "This is an automated page from Crucible.";
  if (msg.restricted) {
    const severity = msg.incident?.severity ?? "unknown";
    const kind =
      msg.kind === "escalation"
        ? `An unacknowledged page for a restricted incident was escalated to you. Severity ${severity}.`
        : `You are being paged for a restricted incident. Severity ${severity}.`;
    return truncateText(`${intro} ${kind}`, VOICE_MAX_CHARS);
  }
  if (msg.kind === "broadcast") return truncateText(`This is an automated message from Crucible. ${msg.title}. ${msg.text}`, VOICE_MAX_CHARS);
  const kind = msg.kind === "escalation" ? "An unacknowledged page was escalated to you." : "You are being paged.";
  const incident = msg.incident ? ` Incident: ${msg.incident.title}. Severity ${msg.incident.severity}.` : "";
  return truncateText(`${intro} ${kind}${incident} ${msg.text}`, VOICE_MAX_CHARS);
}
