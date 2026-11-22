// The email channel for the notify() dispatcher: a thin wrapper over the
// shared transport (src/lib/email/transport) that paging uses too, so one
// SMTP/Resend config drives everything. Notification SMS goes through the
// metered gate (src/lib/delivery/metered). Env-gated, with an HONEST result:
//   unconfigured / no destination -> { ok:false, skipped:true, detail }
//   attempted but failed          -> { ok:false, detail }
//   provider accepted             -> { ok:true, detail: provider message id }

import { escapeHtml, sendMail } from "@/lib/email/transport";

export interface ChannelPayload {
  subject?: string;
  message: string;
  link?: string;
}

// ok=true once a provider actually accepts the message. skipped=true means we
// deliberately didn't send (no provider configured, or no destination on file).
export interface ChannelResult {
  ok: boolean;
  skipped?: boolean;
  detail?: string;
}

function buildEmailHtml(p: ChannelPayload): string {
  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      ${p.subject ? `<h2 style="font-size:17px;margin:0 0 12px">${escapeHtml(p.subject)}</h2>` : ""}
      <p style="font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${escapeHtml(p.message)}</p>
      ${p.link ? `<p style="margin-top:20px"><a href="${escapeHtml(p.link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Open in Crucible</a></p>` : ""}
    </div>`;
}

export async function sendEmail(toEmail: string | null | undefined, p: ChannelPayload): Promise<ChannelResult> {
  if (!toEmail) return { ok: false, skipped: true, detail: "No email on file" };
  const r = await sendMail({
    to: toEmail,
    subject: p.subject ?? "Crucible notification",
    html: buildEmailHtml(p),
    text: p.link ? `${p.message}\n\n${p.link}` : p.message,
  });
  if (r.skipped) return { ok: false, skipped: true, detail: "Email provider not configured (SMTP or Resend)" };
  return r.ok ? { ok: true, detail: r.id } : { ok: false, detail: r.error ?? "Email send failed" };
}
