import { getPublicBaseUrl } from "./resend";
import { escapeHtml, sendTransactionalMail } from "./transport";

export async function sendVerificationEmail(
  email: string,
  name: string,
  token: string
): Promise<void> {
  const verifyUrl = `${getPublicBaseUrl()}/api/public/verify-email?token=${token}`;

  await sendTransactionalMail(
    {
      to: email,
      subject: "Verify your Crucible CE email address",
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Verify your email</h1>
        <p>Hi ${escapeHtml(name)},</p>
        <p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 6px;">
            Verify email
          </a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 32px;">
          This link expires in 24 hours. Didn't create a Crucible CE account? Ignore this email.
        </p>
      </div>
    `,
      text: `Verify your Crucible CE email address: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    },
    "verification",
  );
}
