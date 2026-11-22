// Built-in email providers: generic SMTP (nodemailer) and Resend. Only ONE of
// them carries a page's email channel: the active transport (EMAIL_PROVIDER, or
// SMTP when SMTP_HOST is set, else Resend). Both appear in Settings → Delivery
// and can be test-sent individually.

import { smtpConfigured, smtpSend } from "@/lib/email/smtp";
import { resendConfigured } from "@/lib/email/resend";
import { resendSend } from "@/lib/email/transport";
import { renderEmail } from "../render";
import type { DeliveryMessage, DeliveryProvider, DeliveryRecipient, DeliveryResult } from "../types";

function headersFor(msg: DeliveryMessage): Record<string, string> {
  // Lets mail rules route/escalate pages; also marks them as automated.
  return {
    "X-Crucible-Kind": msg.kind,
    "X-Crucible-Delivery": msg.id,
    "X-Crucible-Delivery-Attempt": String(msg.attempt),
    "Auto-Submitted": "auto-generated",
    // Never on a restricted (redacted) page: no incident identifier leaks.
    ...(msg.incident?.id && !msg.restricted ? { "X-Crucible-Incident": msg.incident.id } : {}),
  };
}

function makeEmailProvider(
  id: "smtp" | "resend",
  displayName: string,
  configured: () => boolean,
  transport: (m: { to: string; subject: string; html: string; text: string; headers: Record<string, string> }) => Promise<{ ok: boolean; id?: string; error?: string }>,
): DeliveryProvider {
  return {
    id,
    displayName,
    channels: ["email"],
    isConfigured: configured,
    async send(msg: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult> {
      if (!recipient.email) return { status: "skipped", error: "No email address on file" };
      if (!configured()) return { status: "skipped", error: "not configured" };
      const { subject, html, text } = renderEmail(msg);
      const r = await transport({ to: recipient.email, subject, html, text, headers: headersFor(msg) });
      return r.ok ? { status: "sent", providerRef: r.id } : { status: "failed", error: r.error ?? "send failed" };
    },
  };
}

export function createSmtpProvider(): DeliveryProvider {
  return makeEmailProvider("smtp", "Email (SMTP)", smtpConfigured, smtpSend);
}

export function createResendProvider(): DeliveryProvider {
  return makeEmailProvider("resend", "Email (Resend)", resendConfigured, resendSend);
}
