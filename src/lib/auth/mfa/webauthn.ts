// WebAuthn (security keys + passkeys) on @simplewebauthn/server.
//
// Challenges live in the database (WebAuthnChallenge): 5-minute TTL, bound to
// the user and a purpose ("register" | "login" | "reauth", and for "login"
// the pending sign-in ticket), and DELETED when used, so each one verifies at
// most one response. The challenge is looked up from the response's own
// clientDataJSON, then consumed atomically before verification runs.
//
// userVerification "preferred": a PIN / biometric is used when the
// authenticator has one, but a plain touch-only key still works as a second
// factor (the password is the first).
//
// A response whose signature counter does not increase over the stored one is
// rejected (cloned-authenticator signal); authenticators that never count
// (always 0, e.g. synced passkeys) are allowed by the library and by us.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { WEBAUTHN_RP_NAME, webauthnConfig } from "./webauthn-config";

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 2 * 60 * 1000;
export const CREDENTIAL_NAME_MAX = 64;

export type ChallengePurpose = "register" | "login" | "reauth";

type Fail = { ok: false; reason: string };

const TRANSPORTS = new Set(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]);
const asTransports = (t: string[]): AuthenticatorTransportFuture[] =>
  t.filter((x) => TRANSPORTS.has(x)) as AuthenticatorTransportFuture[];

/** The challenge a response claims to answer (from clientDataJSON), or null. */
export function challengeFromResponse(response: { response?: { clientDataJSON?: unknown } } | null | undefined): string | null {
  try {
    const raw = response?.response?.clientDataJSON;
    if (typeof raw !== "string" || raw.length > 4096) return null;
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" && parsed.challenge.length <= 256 ? parsed.challenge : null;
  } catch {
    return null;
  }
}

async function storeChallenge(userId: string, purpose: ChallengePurpose, challenge: string, ticketId?: string): Promise<void> {
  const now = new Date();
  // Housekeeping: expired challenges, plus older ones for the SAME ceremony
  // only: a sign-in challenge replaces the earlier one of its own ticket, never
  // another pending sign-in's (someone else holding the password can't cancel
  // the owner's security-key prompt); register / reauth are per session.
  await db.webAuthnChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        purpose === "login" ? { userId, purpose, ticketId: ticketId ?? null } : { userId, purpose },
      ],
    },
  });
  await db.webAuthnChallenge.create({
    data: { userId, purpose, challenge, ticketId: ticketId ?? null, expiresAt: new Date(now.getTime() + WEBAUTHN_CHALLENGE_TTL_MS) },
  });
}

/** Atomically consume a live challenge; true exactly once. */
export async function consumeChallenge(input: {
  userId: string;
  purpose: ChallengePurpose;
  challenge: string;
  ticketId?: string;
}): Promise<boolean> {
  const res = await db.webAuthnChallenge.deleteMany({
    where: {
      challenge: input.challenge,
      userId: input.userId,
      purpose: input.purpose,
      expiresAt: { gt: new Date() },
      ...(input.ticketId ? { ticketId: input.ticketId } : {}),
    },
  });
  return res.count === 1;
}

// ---- Registration ----------------------------------------------------------

export async function registrationOptions(user: {
  id: string;
  email: string;
  name: string | null;
}): Promise<{ ok: true; options: PublicKeyCredentialCreationOptionsJSON } | Fail> {
  const cfg = webauthnConfig();
  if (!cfg.available) return { ok: false, reason: cfg.reason };
  const existing = await db.webAuthnCredential.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN_RP_NAME,
    rpID: cfg.rpID,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    timeout: TIMEOUT_MS,
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: asTransports(c.transports) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await storeChallenge(user.id, "register", options.challenge);
  return { ok: true, options };
}

export async function verifyRegistration(
  userId: string,
  response: RegistrationResponseJSON,
  name: string,
): Promise<{ ok: true; credential: { id: string; name: string; createdAt: Date } } | Fail> {
  const cfg = webauthnConfig();
  if (!cfg.available) return { ok: false, reason: cfg.reason };
  const challenge = challengeFromResponse(response);
  if (!challenge || !(await consumeChallenge({ userId, purpose: "register", challenge }))) {
    return { ok: false, reason: "Registration expired. Add the key again." };
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpID,
      requireUserVerification: false,
    });
  } catch (err) {
    console.warn("[webauthn] registration verification failed:", err instanceof Error ? err.message : err);
    return { ok: false, reason: "Couldn't verify the security key. Try again." };
  }
  if (!verification.verified) return { ok: false, reason: "Couldn't verify the security key. Try again." };
  const info = verification.registrationInfo;
  const exists = await db.webAuthnCredential.findUnique({ where: { credentialId: info.credential.id }, select: { id: true } });
  if (exists) return { ok: false, reason: "That security key is already added." };
  const row = await db.webAuthnCredential.create({
    data: {
      userId,
      name,
      credentialId: info.credential.id,
      publicKey: Buffer.from(info.credential.publicKey),
      counter: BigInt(info.credential.counter),
      transports: info.credential.transports ?? response.response.transports ?? [],
      aaguid: info.aaguid || null,
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
    },
    select: { id: true, name: true, createdAt: true },
  });
  return { ok: true, credential: row };
}

// ---- Authentication (sign-in second step, and step-up) ---------------------

export async function authenticationOptions(
  userId: string,
  purpose: "login" | "reauth",
  ticketId?: string,
): Promise<{ ok: true; options: PublicKeyCredentialRequestOptionsJSON } | Fail> {
  const cfg = webauthnConfig();
  if (!cfg.available) return { ok: false, reason: cfg.reason };
  const creds = await db.webAuthnCredential.findMany({ where: { userId }, select: { credentialId: true, transports: true } });
  if (creds.length === 0) return { ok: false, reason: "No security keys on this account." };
  const options = await generateAuthenticationOptions({
    rpID: cfg.rpID,
    timeout: TIMEOUT_MS,
    userVerification: "preferred",
    allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: asTransports(c.transports) })),
  });
  await storeChallenge(userId, purpose, options.challenge, ticketId);
  return { ok: true, options };
}

export async function verifyAuthentication(
  userId: string,
  response: AuthenticationResponseJSON,
  purpose: "login" | "reauth",
  ticketId?: string,
): Promise<{ ok: true; credentialId: string } | Fail> {
  const cfg = webauthnConfig();
  if (!cfg.available) return { ok: false, reason: cfg.reason };
  if (!response || typeof response.id !== "string") return { ok: false, reason: "malformed" };
  const challenge = challengeFromResponse(response);
  if (!challenge || !(await consumeChallenge({ userId, purpose, challenge, ticketId }))) {
    return { ok: false, reason: "challenge" };
  }
  const cred = await db.webAuthnCredential.findUnique({ where: { credentialId: response.id } });
  if (!cred || cred.userId !== userId) return { ok: false, reason: "unknown_credential" };
  const stored = Number(cred.counter);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: cfg.origin,
      expectedRPID: cfg.rpID,
      requireUserVerification: false,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(cred.publicKey),
        counter: stored,
        transports: asTransports(cred.transports),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[webauthn] authentication verification failed:", msg);
    return { ok: false, reason: /counter/i.test(msg) ? "counter" : "verify" };
  }
  if (!verification.verified) return { ok: false, reason: "verify" };
  const next = verification.authenticationInfo.newCounter;
  // Belt and braces over the library's own check.
  if ((next > 0 || stored > 0) && next <= stored) return { ok: false, reason: "counter" };
  // Conditional on the counter we verified against: a concurrent use of the
  // same assertion can't both succeed.
  const upd = await db.webAuthnCredential.updateMany({
    where: { id: cred.id, counter: cred.counter },
    data: { counter: BigInt(next), lastUsedAt: new Date() },
  });
  if (upd.count !== 1) return { ok: false, reason: "counter" };
  return { ok: true, credentialId: cred.id };
}
