// Incident guest links. An outside party (outside counsel, IR firm, insurer)
// gets a link to ONE incident: a read-only summary, the war-room chat (read and
// post) and the evidence list (and upload, when the invite allows it). No
// account, no org navigation, no other incident. Only the SHA-256 of the
// token is stored; the raw token lives only in the link.
//
// Lock rule: locking an incident suspends every guest link made BEFORE the
// lock. A link made while the incident is locked was made by an administrator
// or the incident commander (the only people who may manage access then).

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";

const TOKEN_BYTES = 32;
const TOKEN_RE = /^[a-f0-9]{64}$/;

export const GUEST_MAX_DAYS = 90;
export const GUEST_DEFAULT_DAYS = 7;

/** A fresh random link token (64 hex characters). Also used by status pages. */
export function generatePublicToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedToken(token: string | null | undefined): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export interface GuestContext {
  inviteId: string;
  incidentId: string;
  organizationId: string;
  email: string;
  name: string | null;
  company: string | null;
  canUpload: boolean;
  expiresAt: Date;
  /** Author id for chat and evidence written by this guest. */
  principalId: string;
  displayName: string;
}

export function guestPrincipalId(inviteId: string): string {
  return `guest:${inviteId}`;
}

export function guestDisplayName(invite: { name: string | null; email: string }): string {
  return `${invite.name?.trim() || invite.email} (guest)`;
}

/**
 * Pure decision: is this invite usable now? False when revoked, expired, the
 * incident is deleted, or the incident was locked after the invite was made.
 */
export function guestInviteUsable(
  invite: { revokedAt: Date | null; expiresAt: Date; createdAt: Date },
  incident: { deletedAt: Date | null; restricted: boolean; lockedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (invite.revokedAt) return false;
  if (invite.expiresAt.getTime() <= now.getTime()) return false;
  if (incident.deletedAt) return false;
  if (incident.restricted && (!incident.lockedAt || invite.createdAt.getTime() < incident.lockedAt.getTime())) return false;
  return true;
}

/** Resolve a raw guest token to its context, or null when it is not usable. */
export async function resolveGuestToken(token: string | null | undefined, now: Date = new Date()): Promise<GuestContext | null> {
  if (!isWellFormedToken(token)) return null;
  const invite = await db.incidentGuestInvite.findUnique({
    where: { tokenHash: hashPublicToken(token) },
    select: {
      id: true,
      incidentId: true,
      organizationId: true,
      email: true,
      name: true,
      company: true,
      canUpload: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      lastAccessAt: true,
      incident: { select: { organizationId: true, deletedAt: true, restricted: true, lockedAt: true } },
    },
  });
  if (!invite || invite.incident.organizationId !== invite.organizationId) return null;
  if (!guestInviteUsable(invite, invite.incident, now)) return null;

  // Stamp access at most once a minute (best-effort, never blocks access).
  if (!invite.lastAccessAt || now.getTime() - invite.lastAccessAt.getTime() > 60_000) {
    void db.incidentGuestInvite.update({ where: { id: invite.id }, data: { lastAccessAt: now } }).catch(() => {});
  }

  return {
    inviteId: invite.id,
    incidentId: invite.incidentId,
    organizationId: invite.organizationId,
    email: invite.email,
    name: invite.name,
    company: invite.company,
    canUpload: invite.canUpload,
    expiresAt: invite.expiresAt,
    principalId: guestPrincipalId(invite.id),
    displayName: guestDisplayName(invite),
  };
}

type GuestAction = "read" | "chat" | "upload";

const LIMITS: Record<GuestAction, { windowMs: number; max: number }> = {
  read: { windowMs: 60_000, max: 120 },
  chat: { windowMs: 60_000, max: 30 },
  upload: { windowMs: 60 * 60_000, max: 30 },
};

const tooMany = (retryAfter: number) =>
  NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } });

/**
 * The guest API front door: per-IP rate limit, token check, per-invite rate
 * limit. Returns the context or the response to send.
 */
export async function guestGate(
  req: Request,
  token: string,
  action: GuestAction,
): Promise<{ ok: true; ctx: GuestContext } | { ok: false; response: NextResponse }> {
  const ip = await checkRateLimit({ namespace: "guest:ip", identifier: ipFromRequest(req), windowMs: 60_000, max: 240 });
  if (!ip.allowed) return { ok: false, response: tooMany(ip.retryAfter) };
  const ctx = await resolveGuestToken(token);
  if (!ctx) return { ok: false, response: NextResponse.json({ error: "This link is not valid." }, { status: 401, headers: { "Cache-Control": "no-store" } }) };
  const limit = LIMITS[action];
  const rl = await checkRateLimit({ namespace: `guest:${action}`, identifier: ctx.inviteId, ...limit });
  if (!rl.allowed) return { ok: false, response: tooMany(rl.retryAfter) };
  return { ok: true, ctx };
}

/** The incident fields a guest may see. Nothing else from the incident leaves the server. */
export const GUEST_INCIDENT_SELECT = {
  id: true,
  title: true,
  description: true,
  severity: true,
  status: true,
  category: true,
  declaredAt: true,
  createdAt: true,
} as const;

export const GUEST_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } as const;
