// ---------------------------------------------------------------------------
// First-run setup code.
//
// A fresh install exposes /setup (create the org + first administrator) to
// anyone who can reach the port. To stop a passer-by from claiming the
// install, POST /api/public/setup requires a one-time code that is only ever
// printed to the SERVER LOG, so only the operator (who can read the log) can
// finish setup.
//
// Lifecycle:
//   - server.ts boot, zero users  -> issue a fresh code, print the banner.
//   - no boot hook (plain `next dev`, or the boot-time DB check failed)
//                                 -> the /setup page (and GET /api/public/setup)
//                                    lazily issue + print one on first view.
//   - successful setup            -> invalidated; never valid again.
//   - process restart before setup -> the old code is gone, a new one prints,
//                                    and the setup rate limits start fresh
//                                    (their Redis keys carry setupBootId()).
//
// Storage: only the SHA-256 of the normalized code, in memory, on `globalThis`
// under a Symbol.for key. The custom server (server.ts) runs Next in the SAME
// Node process (`next({ dev })` -> getRequestHandlers in-process, no fork), but
// Next loads route/page modules through its own bundled module graph, so a
// module-level variable here would be a DIFFERENT instance from the one
// server.ts imported. globalThis is shared by both graphs. Consequence: during
// first-run setup run ONE app instance; with several replicas each prints its
// own code and only the replica that issued it accepts it.
// ---------------------------------------------------------------------------

import { createHash, randomBytes, randomInt } from "node:crypto";
import { secureEqual } from "@/lib/security/secure-compare";
import { getPublicBaseUrl } from "@/lib/email/resend";

/** Unambiguous alphabet: no 0/O, 1/I/L. 31 symbols, 16 chars -> ~79 bits. */
export const SETUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 4;
const GROUP_LEN = 4;

/**
 * pg_advisory_xact_lock key that serializes first-run setup transactions
 * (bytes spell "CRUCSETU"). Lives here, not in route.ts: Next rejects
 * non-route exports from a route module.
 */
export const SETUP_ADVISORY_LOCK_KEY = BigInt("0x4352554353455455");

const STATE_KEY = Symbol.for("crucible.ce.setupCode");

interface SetupCodeState {
  hash: string | null;
  issuedAt: number | null;
  bootId: string;
}

function state(): SetupCodeState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: SetupCodeState };
  if (!g[STATE_KEY]) g[STATE_KEY] = { hash: null, issuedAt: null, bootId: randomBytes(8).toString("hex") };
  return g[STATE_KEY];
}

/**
 * Random per-process id. The /api/public/setup rate-limit keys include it, so
 * restarting the server (which also prints a fresh code) resets the setup
 * limiter: an operator locked out by a proxy-shared IP bucket or too many
 * typos recovers with a restart, even though the limiter lives in Redis.
 */
export function setupBootId(): string {
  return state().bootId;
}

/** A fresh XXXX-XXXX-XXXX-XXXX code (crypto-random, unambiguous alphabet). */
export function generateSetupCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LEN; i++) {
      group += SETUP_CODE_ALPHABET[randomInt(0, SETUP_CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/** Uppercase, strip whitespace and dashes: "abcd-efgh ..." -> "ABCDEFGH...". */
export function normalizeSetupCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]+/g, "");
}

export function hashSetupCode(code: string): string {
  return createHash("sha256").update(normalizeSetupCode(code)).digest("hex");
}

/** Issue (and store the hash of) a new code, replacing any previous one. Returns the plaintext. */
export function issueSetupCode(): string {
  const code = generateSetupCode();
  const s = state();
  s.hash = hashSetupCode(code);
  s.issuedAt = Date.now();
  return code;
}

export function hasActiveSetupCode(): boolean {
  return state().hash !== null;
}

/** Constant-time check of an operator-entered code. False when no code is active. */
export function verifySetupCode(input: string | null | undefined): boolean {
  const stored = state().hash;
  if (!stored || typeof input !== "string") return false;
  const normalized = normalizeSetupCode(input);
  if (normalized.length === 0) return false;
  return secureEqual(hashSetupCode(normalized), stored);
}

/** Burn the active code (after a successful setup). */
export function invalidateSetupCode(): void {
  const s = state();
  s.hash = null;
  s.issuedAt = null;
}

export function formatSetupCodeBanner(code: string, baseUrl: string = getPublicBaseUrl()): string {
  const rule = "=".repeat(64);
  return [
    "",
    rule,
    `Crucible CE first-run setup code: ${code}`,
    `Enter it at ${baseUrl}/setup`,
    "(one-time; a new code is printed if the server restarts before setup)",
    rule,
    "",
  ].join("\n");
}

export type EnsureSetupCodeResult = "issued" | "active" | "not-needed";

/**
 * Issue + print a code when the install has zero users and none is active.
 * Used by the server.ts boot hook and, lazily, by the /setup page for
 * processes without that hook (plain `next dev`).
 */
export async function ensureSetupCode(
  countUsers: () => Promise<number>,
  log: (message: string) => void = console.log,
): Promise<EnsureSetupCodeResult> {
  if (hasActiveSetupCode()) return "active";
  const users = await countUsers();
  if (users > 0) return "not-needed";
  // Re-check after the await: a concurrent caller may have issued meanwhile
  // (the check-and-issue below is synchronous, so it cannot interleave).
  if (hasActiveSetupCode()) return "active";
  log(formatSetupCodeBanner(issueSetupCode()));
  return "issued";
}
