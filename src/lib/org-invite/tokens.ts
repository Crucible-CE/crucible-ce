import crypto from "crypto";

// ---------------------------------------------------------------------------
// Admin-generated org invite tokens.
//
// Wire format for the generic
// /admin/org-invites flow — platform admins pick the destination org and
// optional role; the invitee follows /register?orgInvite=<token>.
//
// A row in the OrgInvite table is created at the same time as the token —
// the row stores the SHA-256 hash of the random `id` segment so we can mark
// the invite used / revoked / look up by id without storing the raw token.
//
// Token wire format:  <idB64url>.<payloadB64url>.<sigB64url>
// Payload:            { orgId, orgSlug, role, expiresAt }
// Signature:          HMAC-SHA256(idB64 + "." + payloadB64, k)
//   k = HKDF-SHA256(AUTH_SECRET || NEXTAUTH_SECRET, salt "crucible-ce",
//                   info "crucible-invite-v1", 32)
// The session secret is never used as a MAC key directly; every purpose gets
// its own derived key (see src/lib/delivery/ack-token.ts for the same pattern).
// ---------------------------------------------------------------------------

const DEFAULT_ROLE = "contributor";
const DEFAULT_EXPIRY_DAYS = 7;

// The CE org roles (src/lib/auth/rbac.ts ORG_ROLES) — nothing else exists.
export const ORG_INVITE_ALLOWED_ROLES = ["reader", "contributor", "exercise_director", "administrator"] as const;


/** HKDF info binding the derived key to org-invite signing only. */
export const ORG_INVITE_HKDF_INFO = "crucible-invite-v1";

function inviteKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "crucible-ce", ORG_INVITE_HKDF_INFO, 32));
}

function signInvite(idB64: string, payloadB64: string): string {
  return crypto.createHmac("sha256", inviteKey()).update(`${idB64}.${payloadB64}`).digest("base64url");
}

export function hashOrgInviteId(rawId: string): string {
  return crypto.createHash("sha256").update(rawId).digest("hex");
}

interface OrgInvitePayload {
  orgId: string;
  orgSlug: string;
  role: string;
  expiresAt: number;
}

export function createOrgInviteToken(params: {
  orgId: string;
  orgSlug: string;
  role?: string;
  expiryDays?: number;
}): { token: string; idHash: string; expiresAt: Date } {
  const rawId = crypto.randomBytes(24).toString("base64url");
  const idHash = hashOrgInviteId(rawId);

  const expiryDays = params.expiryDays ?? DEFAULT_EXPIRY_DAYS;
  const expiresAt = Date.now() + expiryDays * 24 * 60 * 60_000;
  const payload: OrgInvitePayload = {
    orgId: params.orgId,
    orgSlug: params.orgSlug,
    role: params.role ?? DEFAULT_ROLE,
    expiresAt,
  };

  const idB64 = rawId;
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signInvite(idB64, payloadB64);

  return {
    token: `${idB64}.${payloadB64}.${signature}`,
    idHash,
    expiresAt: new Date(expiresAt),
  };
}

export function verifyOrgInviteToken(
  token: string
):
  | { valid: true; idHash: string; payload: OrgInvitePayload }
  | { valid: false; error: string } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid invite token." };
  }

  const [idB64, payloadB64, signature] = parts;

  const expectedSig = signInvite(idB64, payloadB64);

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: "This invite link isn't valid." };
  }

  let payload: OrgInvitePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { valid: false, error: "Invalid invite token data." };
  }

  if (
    !payload ||
    typeof payload.orgId !== "string" ||
    typeof payload.role !== "string" ||
    typeof payload.expiresAt !== "number" ||
    !Number.isFinite(payload.expiresAt)
  ) {
    return { valid: false, error: "Invalid invite token data." };
  }

  if (Date.now() > payload.expiresAt) {
    return { valid: false, error: "This invite link expired." };
  }

  return { valid: true, idHash: hashOrgInviteId(idB64), payload };
}

export { DEFAULT_ROLE as ORG_INVITE_DEFAULT_ROLE };
