import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, type KeyObject } from "crypto";

// Ed25519 signing for incident case files. The private key lives in
// EXPORT_SIGNING_PRIVATE_KEY (a base64-encoded PKCS8 PEM, or a raw PEM). The
// public key is derived from it and published inside every export so a third
// party can verify authenticity + integrity without any shared secret.

function decodePem(raw: string): string {
  return raw.includes("BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
}

function loadPrivateKey(): KeyObject | null {
  const raw = process.env.EXPORT_SIGNING_PRIVATE_KEY;
  if (!raw) return null;
  try {
    const key = createPrivateKey(decodePem(raw));
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

export function isSigningConfigured(): boolean {
  return loadPrivateKey() !== null;
}

export function getPublicKeyPem(): string | null {
  const priv = loadPrivateKey();
  if (!priv) return null;
  return createPublicKey(priv).export({ type: "spki", format: "pem" }).toString();
}

/**
 * Short, public fingerprint of a signing public key: the first 16 hex chars of
 * sha256(SPKI DER). Stored next to every ledger head signature so a verifier
 * can tell "signed by a different (rotated) key" apart from tampering.
 */
export function publicKeyFingerprint(pem: string): string {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Fingerprint of the configured signing key, or null when signing is unconfigured. */
export function signingKeyId(): string | null {
  const pem = getPublicKeyPem();
  return pem ? publicKeyFingerprint(pem) : null;
}

/**
 * Boot check: EXPORT_SIGNING_PRIVATE_KEY is SET but unusable (not a PEM / not
 * base64 of one / not Ed25519). Signing then silently turns off (case-file
 * exports refuse, ledger heads go unsigned), so the server warns loudly.
 * Returns null when the key is unset or valid.
 */
export function signingKeyProblem(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.EXPORT_SIGNING_PRIVATE_KEY?.trim();
  if (!raw) return null;
  try {
    const key = createPrivateKey(decodePem(raw));
    if (key.asymmetricKeyType !== "ed25519") {
      return `EXPORT_SIGNING_PRIVATE_KEY is a ${key.asymmetricKeyType ?? "non-Ed25519"} key; an Ed25519 key is required (openssl genpkey -algorithm ed25519).`;
    }
    return null;
  } catch (err) {
    return `EXPORT_SIGNING_PRIVATE_KEY is set but cannot be parsed as a PKCS8 PEM (raw or base64-encoded): ${err instanceof Error ? err.message : String(err)}.`;
  }
}

// Sign bytes with Ed25519 (algorithm must be null for Ed25519). Returns a
// base64 signature, or null if no key is configured.
export function signData(data: Buffer | string): string | null {
  const priv = loadPrivateKey();
  if (!priv) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return cryptoSign(null, buf, priv).toString("base64");
}
