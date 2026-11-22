import { activeEmailTransport } from "@/lib/email/transport";
import { NO_EMAIL_MESSAGE } from "@/lib/auth/password-reset";
import { ForgotPasswordForm, NoEmailNotice } from "./forgot-password-form";

// Decided on the server, per request (the auth layout is force-dynamic):
// without an email transport there is no form, only the way to get help.
// The browser learns nothing about which accounts exist.
export default function ForgotPasswordPage() {
  if (activeEmailTransport() === null) return <NoEmailNotice message={NO_EMAIL_MESSAGE} />;
  return <ForgotPasswordForm />;
}
