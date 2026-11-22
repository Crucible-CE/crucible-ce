// Ed25519 signing over canonical JSON. Tamper evidence for finalized AARs and
// evidence bundles: a signature proves the content has not changed since the
// instance key signed it. It does not prove who sat at the keyboard; the
// signer identities are part of the signed content.

import { createHash, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonical";

export interface SignedEnvelope<T = unknown> {
  /** The signed document. Its canonical form is what was signed. */
  document: T;
  keyId: string;
  signedAt: string;
  algorithm: "Ed25519";
  /** sha256 of the canonical document, hex. */
  contentHash: string;
  /** base64 Ed25519 signature over canonicalize({document, keyId, signedAt}). */
  signature: string;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function signingPayload(document: unknown, keyId: string, signedAt: string): string {
  return canonicalize({ document, keyId, signedAt });
}

export function signDocument<T>(document: T, key: { keyId: string; privateKey: KeyObject }, signedAt = new Date()): SignedEnvelope<T> {
  const at = signedAt.toISOString();
  const payload = signingPayload(document, key.keyId, at);
  const signature = edSign(null, Buffer.from(payload, "utf8"), key.privateKey).toString("base64");
  return {
    document,
    keyId: key.keyId,
    signedAt: at,
    algorithm: "Ed25519",
    contentHash: sha256Hex(canonicalize(document)),
    signature,
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Verify an envelope against a PEM public key. Never throws. */
export function verifyEnvelope(envelope: SignedEnvelope, publicKeyPem: string): VerifyResult {
  try {
    if (envelope.algorithm !== "Ed25519") return { ok: false, reason: "unknown algorithm" };
    const pub = createPublicKey({ key: publicKeyPem, format: "pem" });
    if (pub.asymmetricKeyType !== "ed25519") return { ok: false, reason: "public key is not Ed25519" };
    if (sha256Hex(canonicalize(envelope.document)) !== envelope.contentHash) return { ok: false, reason: "content hash does not match" };
    const payload = signingPayload(envelope.document, envelope.keyId, envelope.signedAt);
    const ok = edVerify(null, Buffer.from(payload, "utf8"), pub, Buffer.from(envelope.signature, "base64"));
    return ok ? { ok: true } : { ok: false, reason: "signature does not verify" };
  } catch (err) {
    return { ok: false, reason: `verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
