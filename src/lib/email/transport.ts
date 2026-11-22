// One email entry point for the whole app (transactional mail + notification
// email + out-of-band paging). Picks the transport:
//   EMAIL_PROVIDER=smtp|resend  explicit choice
//   otherwise                   SMTP when SMTP_HOST is set, else Resend when
//                               RESEND_API_KEY is set, else none (honest skip)

import { getFromEmail, getResend, resendConfigured } from "./resend";
import { smtpConfigured, smtpSend } from "./smtp";

export type EmailTransportId = "smtp" | "resend";

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

export interface MailResult {
  ok: boolean;
  /** true = nothing was attempted (no transport configured). */
  skipped?: boolean;
  id?: string;
  error?: string;
  transport: EmailTransportId | null;
}

/** The transport outgoing mail will use, or null when none is configured. */
export function activeEmailTransport(): EmailTransportId | null {
  const forced = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "smtp") return smtpConfigured() ? "smtp" : null;
  if (forced === "resend") return resendConfigured() ? "resend" : null;
  if (smtpConfigured()) return "smtp";
  if (resendConfigured()) return "resend";
  return null;
}

export async function resendSend(mail: OutgoingMail): Promise<{ ok: boolean; id?: string; error?: string }> {
  const resend = getResend();
  if (!resend) return { ok: false, error: "Resend not configured" };
  try {
    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendMail(mail: OutgoingMail, via: EmailTransportId | null = activeEmailTransport()): Promise<MailResult> {
  if (via === "smtp") return { ...(await smtpSend(mail)), transport: "smtp" };
  if (via === "resend") return { ...(await resendSend(mail)), transport: "resend" };
  return { ok: false, skipped: true, error: "No email transport configured (set SMTP_HOST or RESEND_API_KEY)", transport: null };
}

let warnedUnconfigured = false;

/**
 * Transactional mail (verification, reset, invites): no-op when no transport is
 * configured (logged once), throw when a configured transport fails so the
 * caller can surface it.
 */
export async function sendTransactionalMail(mail: OutgoingMail, tag: string): Promise<void> {
  const r = await sendMail(mail);
  if (r.skipped) {
    if (!warnedUnconfigured) {
      console.warn(`[email] no transport configured; "${tag}" and other emails are not being sent. Set SMTP_HOST or RESEND_API_KEY.`);
      warnedUnconfigured = true;
    }
    return;
  }
  if (!r.ok) {
    console.error(`[email:${tag}] ${r.transport} send failed:`, { to: mail.to, error: r.error });
    throw new Error(`Email send failed (${r.transport}): ${r.error}`);
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
