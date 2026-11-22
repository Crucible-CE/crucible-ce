// Exercise email (invites, reminders) through CE's mail transport (SMTP or
// Resend). When no transport is configured, sendEmail returns { sent: false }.
// Plain text; the HTML part is the same text, escaped.

import { activeEmailTransport, escapeHtml, sendMail } from "@/lib/email/transport";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** True when CE can send mail. */
export function emailConfigured(): boolean {
  return activeEmailTransport() !== null;
}

/** Strip CR and LF so a header value cannot carry another header. */
function headerSafe(v: string): string {
  return v.replace(/[\r\n]+/g, " ").trim();
}

export async function sendEmail(msg: EmailMessage): Promise<{ sent: boolean }> {
  if (!emailConfigured()) return { sent: false };
  const res = await sendMail({
    to: headerSafe(msg.to),
    subject: headerSafe(msg.subject).slice(0, 200),
    text: msg.text,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(msg.text)}</pre>`,
  });
  if (!res.ok) throw new Error(res.error ?? "Email send failed");
  return { sent: true };
}
