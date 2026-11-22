import { getPublicBaseUrl } from "./resend";
import { escapeHtml, sendTransactionalMail } from "./transport";

export async function sendWelcomeEmail(
  email: string,
  name: string,
  orgName: string,
  verificationToken?: string
): Promise<void> {
  const verifyUrl = verificationToken
    ? `${getPublicBaseUrl()}/api/public/verify-email?token=${verificationToken}`
    : null;

  await sendTransactionalMail(
    {
      to: email,
      subject: `Your Crucible CE workspace is ready`,
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Welcome to Crucible CE</h1>
        <p>Hi ${escapeHtml(name)},</p>
        <p><strong>${escapeHtml(orgName)}</strong> is set up.</p>
        ${verifyUrl ? `<p><a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 6px;">Verify your email</a></p>` : ""}
        <h3>Next steps</h3>
        <ol>
          <li>Set up your escalation matrix.</li>
          <li>Invite your team from Org admin &gt; Members.</li>
          <li>Run a test incident.</li>
        </ol>
      </div>
    `,
    },
    "welcome",
  );
}
