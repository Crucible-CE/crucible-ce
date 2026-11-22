// Webhook request signing (Stripe-style). The receiver recomputes
//   HMAC-SHA256(secret, `${t}.${rawBody}`)  (hex)
// and compares it to v1 in the X-Crucible-Signature header
//   X-Crucible-Signature: t=<unix seconds>,v1=<hex>
// rejecting timestamps outside a tolerance window to stop replays.
// Verification snippets for receivers live in docs/delivery-providers.md.

import { createHmac } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";

export const SIGNATURE_HEADER = "X-Crucible-Signature";
export const TIMESTAMP_HEADER = "X-Crucible-Timestamp";

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function signatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, body)}`;
}

/**
 * Verify a signature header against the raw request body. Accepts several v1
 * values (secret rotation). `toleranceSeconds` bounds clock skew + replay.
 */
export function verifySignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  opts: { toleranceSeconds?: number; now?: number } = {},
): boolean {
  if (!header) return false;
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v && /^\d+$/.test(v)) t = parseInt(v, 10);
    else if (k === "v1" && v) v1.push(v);
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(now - t) > tolerance) return false;
  const expected = computeSignature(secret, t, body);
  return v1.some((sig) => secureEqual(sig, expected));
}
