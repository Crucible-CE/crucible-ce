// The guest link email. No incident title or details: the link is the only
// way in, and mail can be forwarded or read by others.

import { escapeHtml, sendMail } from "@/lib/email/transport";

export async function sendGuestInviteEmail(args: {
  to: string;
  name: string | null;
  inviterName: string | null;
  url: string;
  expiresAt: Date;
}): Promise<boolean> {
  const who = args.inviterName?.trim() || "A responder";
  const until = args.expiresAt.toUTCString();
  const text = [
    `${args.name ? `${args.name}, ` : ""}${who} invited you to an incident room in Crucible.`,
    "",
    `Open the incident: ${args.url}`,
    "",
    `The link works until ${until}. Do not forward it.`,
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <p style="font-size:14px;line-height:1.6;color:#333">${args.name ? `${escapeHtml(args.name)}, ` : ""}${escapeHtml(who)} invited you to an incident room in Crucible.</p>
      <p><a href="${escapeHtml(args.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Open the incident</a></p>
      <p style="font-size:12px;color:#666">The link works until ${escapeHtml(until)}. Do not forward it.</p>
    </div>`;
  const r = await sendMail({ to: args.to, subject: "You are invited to an incident room", html, text }).catch(() => null);
  return !!r?.ok;
}
