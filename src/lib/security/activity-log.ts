// ---------------------------------------------------------------------------
// UserActivityLog writer — the auth/security activity trail.
//
// This is a bespoke FIRE-AND-FORGET logger, deliberately NOT appendLedger:
// the ledger is incident-scoped, hash-chained, and transactional; auth
// telemetry is org/user-scoped, has no chain, and must never block or fail an
// auth flow. It parallels recordAdminAuditLog. Rows carry organizationId when
// the org is known; unknown-email login failures are stored with a null org.
//
// Privacy: raw IPs and raw attacker-supplied emails are never stored. Both
// hash with ACTIVITY_IP_SALT; if the salt is unset the hashes are stored NULL
// (fail closed — an unsalted SHA-256 of an IP/email is rainbow-tableable).
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/security/client-ip";

export type ActivityAction =
  | "login.success"
  | "login.failure"
  | "logout"
  | "password.changed"
  | "session.revoked"
  | "email.verified"
  | "password.reset_requested"
  | "password.reset_completed"
  | "setup.completed"
  // Two-factor sign-in (src/lib/auth/mfa).
  | "mfa.success"
  | "mfa.failure"
  | "mfa.enabled"
  | "mfa.disabled"
  | "mfa.recovery_regenerated"
  | "mfa.reset_by_admin";

export interface ActivityLogInput {
  action: ActivityAction;
  /** null for unknown-email failed logins. */
  userId?: string | null;
  /** null pre-auth / unknown user. */
  organizationId?: string | null;
  /** Hashed to emailHash; the raw address is never stored. */
  email?: string | null;
  req?: Request | { headers: Headers };
  /** Pre-derived IP fields (e.g. stashed in authorize() for events.signIn). */
  ip?: { ipHash: string | null; ipLastOctet: string | null };
  path?: string;
  method?: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
}

const USER_AGENT_MAX = 512;

function salt(): string | null {
  const s = process.env.ACTIVITY_IP_SALT;
  return s && s.length > 0 ? s : null;
}

function saltedHash(value: string): string | null {
  const s = salt();
  if (!s) return null; // fail closed — never hash with an empty salt
  return createHash("sha256").update(value + s).digest("hex");
}

/** Last IPv4 octet / IPv6 hextet, for "matched .42 again" triage. */
function lastOctet(ip: string): string | null {
  const sep = ip.includes(":") ? ":" : ".";
  const parts = ip.split(sep).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

/**
 * Derive the storable IP fields from a request. Exported so authorize() can
 * stash them for events.signIn (which receives no request). Null-safe: a
 * missing/unparseable IP or unset salt yields nulls, never a throw.
 */
export function deriveActivityIp(
  req: Request | { headers: Headers } | null | undefined,
): { ipHash: string | null; ipLastOctet: string | null } {
  try {
    const ip = getClientIp(req, "lenient");
    if (!ip || ip === "unknown") return { ipHash: null, ipLastOctet: null };
    return { ipHash: saltedHash(ip), ipLastOctet: lastOctet(ip) };
  } catch {
    return { ipHash: null, ipLastOctet: null };
  }
}

/** Salted hash of a (lowercased) email; null when the salt is unset. */
export function hashActivityEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return saltedHash(email.toLowerCase().trim());
}

/**
 * Append one activity row. NEVER throws and is safe to call un-awaited —
 * a failed write logs to console and the auth flow proceeds untouched.
 */
export async function recordActivity(input: ActivityLogInput): Promise<void> {
  try {
    const ip = input.ip ?? deriveActivityIp(input.req);
    const userAgentRaw = input.req?.headers?.get?.("user-agent") ?? null;
    const data = {
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      action: input.action,
      emailHash: hashActivityEmail(input.email),
      path: input.path ?? null,
      method: input.method ?? null,
      statusCode: input.statusCode ?? null,
      ipHash: ip.ipHash,
      ipLastOctet: ip.ipLastOctet,
      userAgent: userAgentRaw ? userAgentRaw.slice(0, USER_AGENT_MAX) : null,
      metadataJson: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
    };

    await db.userActivityLog.create({ data });
  } catch (err) {
    console.error("[activity-log] write failed (non-fatal):", err);
  }
}
