import { getPublicBaseUrl } from "./resend";
import { escapeHtml, sendTransactionalMail } from "./transport";

// one-click "are your details still current?" email for stale escalation
// contacts. No-ops if no email transport is configured. A send failure is
// logged (inside sendTransactionalMail), not thrown, so one bad address
// doesn't abort the whole campaign.
export async function sendEscalationVerificationEmail(args: {
  to: string;
  contactName: string;
  orgName: string;
  token: string;
}): Promise<void> {
  const url = `${getPublicBaseUrl()}/api/public/escalation-verify/${args.token}`;
  await sendTransactionalMail(
    {
      to: args.to,
      subject: `Confirm your contact details for ${args.orgName}`,
      html: `
      <p>Hi ${escapeHtml(args.contactName)},</p>
      <p><strong>${escapeHtml(args.orgName)}</strong> lists you as an escalation contact for incident response. Confirm your details are current.</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#ea580c;color:#fff;text-decoration:none;border-radius:4px;">Confirm my details</a></p>
      <p>If anything changed, reply to this email.</p>
    `,
      text: `${args.orgName} lists you as an escalation contact. Confirm your details are current: ${url}`,
    },
    "escalation-verification",
  ).catch(() => undefined);
}
