// After-action report signing key (Ed25519).
//
// CE signs case files and after-action reports with one key:
// EXPORT_SIGNING_PRIVATE_KEY (a PKCS8 PEM, or base64 of that PEM). Its public
// key and keyId live in the SigningKey table so old signatures stay verifiable
// after rotation. keyId = first 16 hex chars of the SHA-256 of the public key's
// SPKI DER encoding (the same fingerprint as case-file exports).

import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import type { DbClient } from "@/lib/db";

export const SIGNING_KEY_ENV = "EXPORT_SIGNING_PRIVATE_KEY";

export interface LoadedSigningKey {
  keyId: string;
  privateKey: KeyObject;
  publicKeyPem: string;
}

/** keyId for a public key: sha256 of the SPKI DER, hex, first 16 chars. */
export function keyIdFor(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Parse the env key: a PEM, or base64 of a PEM. Throws on anything else. */
export function parseEnvPrivateKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  const pem = trimmed.includes("-----BEGIN") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  if (!pem.includes("-----BEGIN")) throw new Error(`${SIGNING_KEY_ENV} is not a PEM or base64 of a PEM`);
  const key = createPrivateKey({ key: pem, format: "pem" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${SIGNING_KEY_ENV} must be an Ed25519 key`);
  return key;
}

function toLoaded(privateKey: KeyObject): LoadedSigningKey {
  const publicKey = createPublicKey(privateKey);
  return {
    keyId: keyIdFor(publicKey),
    privateKey,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** The configured key, or null when none is set. Throws when it is set but unusable. */
export function readSigningKey(): LoadedSigningKey | null {
  const envKey = process.env[SIGNING_KEY_ENV];
  if (!envKey || envKey.trim() === "") return null;
  return toLoaded(parseEnvPrivateKey(envKey));
}

/** The signing key for report signatures. Throws when none is configured. */
export function loadSigningKey(): { keyId: string; privateKey: KeyObject } {
  const key = readSigningKey();
  if (!key) throw new Error(`No signing key. Set ${SIGNING_KEY_ENV}.`);
  return { keyId: key.keyId, privateKey: key.privateKey };
}

/**
 * Register the configured key's public half in SigningKey. Safe to call more
 * than once. Returns null when no key is configured.
 */
export async function ensureSigningKey(client: DbClient): Promise<{ keyId: string } | null> {
  const key = readSigningKey();
  if (!key) return null;
  await client.signingKey.upsert({
    where: { keyId: key.keyId },
    create: { keyId: key.keyId, publicKeyPem: key.publicKeyPem },
    update: {},
  });
  return { keyId: key.keyId };
}
