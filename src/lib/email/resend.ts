import { Resend } from "resend";

// Lazy singleton: no-ops gracefully when RESEND_API_KEY is not set. The key is
// read at call time (not module load) so tests and late env loading see it.
let _resend: Resend | null = null;
let _resendKey: string | null = null;

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!_resend || _resendKey !== apiKey) {
    _resend = new Resend(apiKey);
    _resendKey = apiKey;
  }
  return _resend;
}

/**
 * Sender address. `||` (not `??`) on purpose: docker compose passes unset
 * optional vars through as EMPTY strings (`FROM_EMAIL: ${FROM_EMAIL:-}`), and an
 * empty From makes every provider reject the message.
 */
export function getFromEmail(): string {
  return process.env.FROM_EMAIL?.trim() || "noreply@localhost.invalid";
}

// Public base URL for links inside emails and out-of-band pages. Falls back to
// NEXTAUTH_URL, then localhost. Set PUBLIC_URL to the public app URL so links
// don't point at the internal container hostname. `||` for the same
// empty-string reason as getFromEmail.
export function getPublicBaseUrl(): string {
  return (
    process.env.PUBLIC_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}
