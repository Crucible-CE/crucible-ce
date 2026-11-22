// Signed acknowledge tokens carried in every out-of-band page.
//
//   <pageId>.<level>.<expiresUnix>.<sig>
//   sig = base64url(HMAC-SHA256(k, "<pageId>.<level>.<expiresUnix>"))[0..22)  (128 bits)
//   k   = HKDF-SHA256(AUTH_SECRET || NEXTAUTH_SECRET, info "crucible/page-ack/v1")
//
// Single-use without a token table: the token is bound to the page's
// escalation LEVEL, and redeeming it is a guarded `status: "sent" AND
// escalationLevel: <level>` -> "acked" transition. Once acked (or escalated to
// the next level, or cancelled because the incident closed) the same token can
// never act again. Expiry bounds a leaked link.

import { createHmac, hkdfSync } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";

const TOKEN_RE = /^([a-z0-9]{8,40})\.(\d{1,3})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/;

function key(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET is required to sign ack links");
  return Buffer.from(hkdfSync("sha256", secret, "crucible-ce", "crucible/page-ack/v1", 32));
}

function sign(body: string): string {
  return createHmac("sha256", key()).update(body).digest("base64url").slice(0, 22);
}

export function ackLinkTtlSeconds(): number {
  const hours = parseFloat(process.env.DELIVERY_ACK_LINK_TTL_HOURS ?? "");
  return Math.round((Number.isFinite(hours) && hours > 0 ? hours : 24) * 3600);
}

export function createAckToken(pageId: string, level: number, now: Date = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + ackLinkTtlSeconds();
  const body = `${pageId}.${level}.${exp}`;
  return `${body}.${sign(body)}`;
}

export type AckTokenResult =
  | { ok: true; pageId: string; level: number; expiresAt: Date }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyAckToken(token: string, now: Date = new Date()): AckTokenResult {
  const m = TOKEN_RE.exec(token ?? "");
  if (!m) return { ok: false, reason: "malformed" };
  const [, pageId, levelStr, expStr, sig] = m;
  let expected: string;
  try {
    expected = sign(`${pageId}.${levelStr}.${expStr}`);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (!secureEqual(sig, expected)) return { ok: false, reason: "bad_signature" };
  const exp = parseInt(expStr, 10);
  if (exp * 1000 < now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, pageId, level: parseInt(levelStr, 10), expiresAt: new Date(exp * 1000) };
}
