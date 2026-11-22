import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time string equality. Hashes both sides to a fixed length
// first, so unequal lengths neither early-return (which would leak the
// secret's length via timing) nor throw timingSafeEqual's equal-length
// precondition. The SHA-256 pre-hash is the standard constant-time-string
// idiom — use this for every secret comparison (bearer tokens, cron secrets,
// webhook signatures) instead of `===` or hand-rolled Buffer compares.
export function secureEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
