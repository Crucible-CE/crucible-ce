// Generic SMTP transport (nodemailer). Works with any mail server: Postfix,
// Exchange, Gmail/Workspace relay, SES SMTP, Mailgun, a local Mailpit catcher.
//
//   SMTP_HOST    required to enable SMTP
//   SMTP_PORT    default 587 (465 when SMTP_SECURE=true)
//   SMTP_SECURE  "true" = implicit TLS (port 465). Otherwise STARTTLS.
//   SMTP_REQUIRE_TLS  STARTTLS is REQUIRED (no plaintext fallback, so pages,
//                ack links and AUTH credentials never cross the network in
//                clear) by default for every host except loopback
//                (localhost / 127.0.0.1 / ::1, e.g. a local Mailpit).
//                "false" allows plaintext (a trusted relay on a private
//                network without TLS); "true" forces it on loopback too.
//   SMTP_USER / SMTP_PASS  optional AUTH credentials
//   SMTP_FROM    sender; falls back to FROM_EMAIL
//
// Used by both the transactional email transport (./transport) and the SMTP
// delivery provider (lib/delivery/providers/email).

import nodemailer, { type Transporter } from "nodemailer";
import { getFromEmail } from "./resend";

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * Must the (non-implicit-TLS) connection upgrade with STARTTLS? Default: yes
 * for any non-loopback host. SMTP_REQUIRE_TLS=true|false overrides.
 */
export function smtpRequireTls(host: string = process.env.SMTP_HOST ?? "", env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.SMTP_REQUIRE_TLS ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return !isLoopbackHost(host);
}

export function getSmtpFrom(): string {
  return process.env.SMTP_FROM?.trim() || getFromEmail();
}

function smtpOptions() {
  const secure = (process.env.SMTP_SECURE ?? "").trim().toLowerCase() === "true";
  const port = parseInt(process.env.SMTP_PORT ?? "", 10) || (secure ? 465 : 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS ?? "";
  const host = process.env.SMTP_HOST!.trim();
  return {
    host,
    port,
    secure,
    // Implicit TLS already encrypts; otherwise refuse to send in plaintext.
    requireTLS: !secure && smtpRequireTls(host),
    auth: user ? { user, pass } : undefined,
    // Bounded: a hung mail server must not stall a page fan-out.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  };
}

let cached: { key: string; transport: Transporter } | null = null;

function getTransport(): Transporter | null {
  if (!smtpConfigured()) return null;
  const opts = smtpOptions();
  const key = JSON.stringify(opts);
  if (!cached || cached.key !== key) {
    cached = { key, transport: nodemailer.createTransport(opts) };
  }
  return cached.transport;
}

export interface SmtpMail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

export async function smtpSend(
  mail: SmtpMail,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const transport = getTransport();
  if (!transport) return { ok: false, error: "SMTP not configured" };
  try {
    const info = await transport.sendMail({
      from: getSmtpFrom(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
    });
    const rejected = Array.isArray(info.rejected) ? info.rejected : [];
    if (rejected.length > 0) return { ok: false, error: `Rejected by server: ${rejected.join(", ")}` };
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
