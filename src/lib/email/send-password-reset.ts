import { escapeHtml, sendTransactionalMail } from "./transport";

/** Email a reset link (the full URL from issuePasswordResetLink). */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  resetUrl: string
): Promise<void> {

  await sendTransactionalMail(
    {
      to: email,
      subject: "Reset your Crucible CE password",
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Reset your password</h1>
        <p>Hi ${escapeHtml(name ?? "there")},</p>
        <p>
          <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #7c3aed; color: white; text-decoration: none; border-radius: 6px;">
            Reset password
          </a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 32px;">
          This link expires in 1 hour. Didn't ask for it? Ignore this email.
        </p>
      </div>
    `,
      text: `Reset your Crucible CE password: ${resetUrl}\n\nThis link expires in 1 hour.`,
    },
    "password-reset",
  );
}
