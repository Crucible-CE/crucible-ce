// WebAuthn relying-party settings, derived from the URL people open
// (PUBLIC_URL, falling back to AUTH_URL / NEXTAUTH_URL). Browsers only offer
// WebAuthn in a secure context: https, or http://localhost. The RP ID is the
// host name (no port), which must be a domain, not an IP address.
//
// Pure: reads env at call time (the self-hosted image is built once and the
// URL is supplied when the container starts).

type Env = Record<string, string | undefined>;

export const WEBAUTHN_RP_NAME = "Crucible CE";

export type WebAuthnConfig =
  | { available: true; rpID: string; origin: string }
  | { available: false; reason: string };

function isLocalhost(host: string): boolean {
  return host === "localhost" || host.endsWith(".localhost");
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[") || host.includes(":");
}

export function webauthnConfig(env: Env = process.env): WebAuthnConfig {
  const raw = [env.PUBLIC_URL, env.AUTH_URL, env.NEXTAUTH_URL].map((v) => v?.trim()).find((v) => !!v);
  if (!raw) {
    return {
      available: false,
      reason: "Security keys need PUBLIC_URL. Set it to an https URL and restart.",
    };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { available: false, reason: `PUBLIC_URL "${raw}" isn't a valid URL. Security keys are off.` };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "http:" && isLocalhost(host)) return { available: true, rpID: host, origin: url.origin };
  if (url.protocol !== "https:") {
    return {
      available: false,
      reason: `Security keys need https. Set an https PUBLIC_URL (now ${url.origin}).`,
    };
  }
  if (isIpLiteral(host)) {
    return {
      available: false,
      reason: `Security keys need a domain name, not an IP address. PUBLIC_URL is ${url.origin}.`,
    };
  }
  return { available: true, rpID: host, origin: url.origin };
}
