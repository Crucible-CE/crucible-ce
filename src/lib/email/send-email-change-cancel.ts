import { getPublicBaseUrl } from "./resend";
import { escapeHtml, sendTransactionalMail } from "./transport";

/**
 * Sent to the OLD email address when a user changes their email.
 * Contains a cancellation link that, if clicked within the grace window,
 * reverts the email change and restores the account's original address.
 */
export async function sendEmailChangeCancelEmail(
  oldEmail: string,
  name: string,
  newEmail: string,
  cancellationToken: string
): Promise<void> {
  const cancelUrl = `${getPublicBaseUrl()}/cancel-email-change?token=${cancellationToken}`;

  await sendTransactionalMail(
    {
      to: oldEmail,
      subject: "Your Crucible CE email address was changed",
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Email changed</h1>
        <p>Hi ${escapeHtml(name ?? "there")},</p>
        <p>
          Your Crucible CE email was changed from
          <strong>${escapeHtml(oldEmail)}</strong> to
          <strong>${escapeHtml(newEmail)}</strong>.
        </p>
        <p>If this was you, no action is needed.</p>
        <p style="margin-top: 24px;">
          <strong>If this wasn't you</strong>, cancel the change, then change your password.
        </p>
        <p>
          <a href="${cancelUrl}" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 6px;">
            Cancel email change
          </a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 32px;">
          This link expires in 7 days.
        </p>
      </div>
    `,
      text: `Your Crucible CE email was changed from ${oldEmail} to ${newEmail}. If this wasn't you, cancel the change: ${cancelUrl}`,
    },
    "email-change-cancel",
  );
}
