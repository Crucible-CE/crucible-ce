import { getPublicBaseUrl } from "./resend";
import { escapeHtml, sendTransactionalMail } from "./transport";

/**
 * Tell a member an administrator removed their two-factor sign-in. If they
 * didn't ask for it, this is how they find out. No-op without an email
 * transport (sendTransactionalMail logs that once). adminLabel null (the
 * server recovery command) reads "An administrator".
 */
export async function sendMfaResetEmail(email: string, name: string | null, adminLabel: string | null): Promise<void> {
  const url = `${getPublicBaseUrl()}/settings?tab=security`;
  const who = adminLabel ? `${adminLabel}, an administrator,` : "An administrator";
  await sendTransactionalMail(
    {
      to: email,
      subject: "Your Crucible CE two-factor sign-in was reset",
      html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #1a1a2e;">Two-factor sign-in reset</h1>
        <p>Hi ${escapeHtml(name ?? "there")},</p>
        <p>${escapeHtml(who)} removed your two-factor sign-in methods and signed you out everywhere.</p>
        <p>Sign in with your password and set it up again: <a href="${url}">${url}</a></p>
        <p style="color: #b91c1c;">If you didn't ask for this, contact your administrator now.</p>
      </div>
    `,
      text: `${who} removed your Crucible CE two-factor sign-in methods and signed you out everywhere. Sign in and set it up again: ${url}\n\nIf you didn't ask for this, contact your administrator now.`,
    },
    "mfa-reset",
  );
}
