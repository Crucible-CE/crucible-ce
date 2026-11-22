// Public status pages. One page per incident, reached by a link whose token is
// the only auth (only its SHA-256 is stored, like guest links). The page shows
// the organization name, the page title, a public status label and the status
// updates posted to it. Nothing else from the incident leaves the server.
//
// Posting an update to a live page emails its confirmed subscribers (double
// opt-in through CE mail). Unsubscribe links are signed, so no token table:
//   <subscriberId>.<sig>   sig = base64url(HMAC-SHA256(k, "unsub.<id>"))[0..22)
//   k = HKDF-SHA256(AUTH_SECRET, info "crucible/status-unsubscribe/v1")
//
// A restricted (locked) or deleted incident never has a live page.

import { createHmac, hkdfSync } from "node:crypto";
import { db } from "@/lib/db";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { escapeHtml, sendMail } from "@/lib/email/transport";
import { secureEqual } from "@/lib/security/secure-compare";
import { hashPublicToken, isWellFormedToken } from "@/lib/incident/guest";
import { appendLedger } from "@/lib/ledger/append";

export const STATUS_AUDIENCE_SCOPES = ["public", "customer"] as const;

/** Which update audiences a page shows. Internal updates never do. */
export function eligibleAudiences(scope: string): string[] {
  return scope === "customer" ? ["public", "customer"] : ["public"];
}

/** Incident status to a public label. Never the raw internal status. */
export function publicStatusLabel(status: string): "Investigating" | "Monitoring" | "Resolved" {
  switch (status) {
    case "contained":
    case "eradicated":
    case "recovered":
      return "Monitoring";
    case "closed":
      return "Resolved";
    default:
      return "Investigating";
  }
}

/** The `where` for updates a page shows: posted to it, not retracted, eligible audience. */
export function pageUpdatesWhere(incidentId: string, scope: string) {
  return {
    incidentId,
    publishedToPageAt: { not: null },
    unpublishedAt: null,
    audience: { in: eligibleAudiences(scope) },
  };
}

export interface ResolvedStatusPage {
  id: string;
  organizationId: string;
  incidentId: string;
  title: string;
  audienceScope: string;
  updatedAt: Date;
  incidentStatus: string;
  orgName: string;
}

/** Pure decision: is the page live for the public? */
export function statusPageLive(
  page: { isPublished: boolean },
  incident: { restricted: boolean; deletedAt: Date | null; isTraining?: boolean },
): boolean {
  return page.isPublished && !incident.restricted && !incident.deletedAt && !incident.isTraining;
}

/** Resolve a public token to a live page, or null (unknown, unpublished, locked, deleted). */
export async function resolveStatusPageToken(token: string | null | undefined): Promise<ResolvedStatusPage | null> {
  if (!isWellFormedToken(token)) return null;
  const page = await db.incidentStatusPage.findUnique({
    where: { tokenHash: hashPublicToken(token) },
    select: {
      id: true,
      organizationId: true,
      incidentId: true,
      title: true,
      audienceScope: true,
      isPublished: true,
      updatedAt: true,
      incident: { select: { status: true, restricted: true, deletedAt: true, isTraining: true, organization: { select: { name: true } } } },
    },
  });
  if (!page || !statusPageLive(page, page.incident)) return null;
  return {
    id: page.id,
    organizationId: page.organizationId,
    incidentId: page.incidentId,
    title: page.title,
    audienceScope: page.audienceScope,
    updatedAt: page.updatedAt,
    incidentStatus: page.incident.status,
    orgName: page.incident.organization.name,
  };
}

/** The public view of a live page: exactly what the page and its JSON show. */
export async function publicStatusView(page: ResolvedStatusPage) {
  const updates = await db.incidentStatusUpdate.findMany({
    where: pageUpdatesWhere(page.incidentId, page.audienceScope),
    orderBy: { publishedToPageAt: "desc" },
    take: 50,
    select: { id: true, headline: true, body: true, publishedToPageAt: true, editedAt: true },
  });
  return {
    title: page.title,
    orgName: page.orgName,
    status: publicStatusLabel(page.incidentStatus),
    updatedAt: updates[0]?.publishedToPageAt ?? page.updatedAt,
    updates,
  };
}

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

const UNSUB_RE = /^([a-z0-9]{8,40})\.([A-Za-z0-9_-]{22})$/;

function unsubKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET / NEXTAUTH_SECRET is required to sign unsubscribe links");
  return Buffer.from(hkdfSync("sha256", secret, "crucible-ce", "crucible/status-unsubscribe/v1", 32));
}

export function createUnsubscribeToken(subscriberId: string): string {
  const sig = createHmac("sha256", unsubKey()).update(`unsub.${subscriberId}`).digest("base64url").slice(0, 22);
  return `${subscriberId}.${sig}`;
}

/** The subscriber id of a valid unsubscribe token, else null. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const m = UNSUB_RE.exec(token ?? "");
  if (!m) return null;
  try {
    return secureEqual(createUnsubscribeToken(m[1]), `${m[1]}.${m[2]}`) ? m[1] : null;
  } catch {
    return null;
  }
}

export function unsubscribeUrl(subscriberId: string): string {
  return `${getPublicBaseUrl().replace(/\/+$/, "")}/api/public/status-unsubscribe/${createUnsubscribeToken(subscriberId)}`;
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

function shell(inner: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px">${inner}</div>`;
}

export async function sendSubscribeConfirmEmail(args: { to: string; orgName: string; title: string; confirmUrl: string; pageUrl: string }): Promise<void> {
  const text = [
    `Confirm to get status updates for "${args.title}" from ${args.orgName}.`,
    "",
    `Confirm: ${args.confirmUrl}`,
    "",
    `Status page: ${args.pageUrl}`,
    "",
    "If you did not ask for this, ignore this email.",
  ].join("\n");
  const html = shell(
    `<p style="font-size:14px;line-height:1.6;color:#333">Confirm to get status updates for <strong>${escapeHtml(args.title)}</strong> from ${escapeHtml(args.orgName)}.</p>
     <p><a href="${escapeHtml(args.confirmUrl)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Confirm</a></p>
     <p style="font-size:12px;color:#666">If you did not ask for this, ignore this email.</p>`,
  );
  await sendMail({ to: args.to, subject: `Confirm status updates: ${args.title}`, html, text }).catch(() => null);
}

/**
 * Email one posted update to every confirmed subscriber of the page. Sequential
 * and best-effort: one failed address never stops the rest. Returns the count sent.
 */
export async function notifyStatusPageSubscribers(statusPageId: string, update: { headline: string; body: string }): Promise<number> {
  const page = await db.incidentStatusPage.findUnique({
    where: { id: statusPageId },
    select: { title: true, isPublished: true, incident: { select: { restricted: true, deletedAt: true, isTraining: true, organization: { select: { name: true } } } } },
  });
  if (!page || !statusPageLive(page, page.incident)) return 0;
  const subscribers = await db.statusPageSubscriber.findMany({
    where: { statusPageId, confirmedAt: { not: null }, unsubscribedAt: null },
    select: { id: true, email: true },
    take: 5000,
  });
  let sent = 0;
  for (const s of subscribers) {
    let unsub: string;
    try {
      unsub = unsubscribeUrl(s.id);
    } catch {
      return sent;
    }
    const text = [`${page.title}: ${update.headline}`, "", update.body, "", `${page.incident.organization.name}`, "", `Unsubscribe: ${unsub}`].join("\n");
    const html = shell(
      `<p style="font-size:12px;color:#666;margin:0 0 6px">${escapeHtml(page.incident.organization.name)} · ${escapeHtml(page.title)}</p>
       <h2 style="font-size:17px;margin:0 0 12px">${escapeHtml(update.headline)}</h2>
       <p style="font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap">${escapeHtml(update.body)}</p>
       <p style="font-size:12px;color:#666;margin-top:24px"><a href="${escapeHtml(unsub)}" style="color:#666">Unsubscribe</a></p>`,
    );
    const r = await sendMail({
      to: s.email,
      subject: `Status update: ${update.headline}`,
      html,
      text,
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }).catch(() => null);
    if (r?.ok) sent++;
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Posting an update to the page
// ---------------------------------------------------------------------------

export type PostToPageResult =
  | { ok: true; notifyQueued: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Put one published status update on the incident's page, exactly once (a
 * guarded claim, so a double click never emails subscribers twice), ledger it,
 * and email confirmed subscribers in the background when the page is live.
 */
export async function postUpdateToStatusPage(args: {
  incidentId: string;
  organizationId: string;
  updateId: string;
  actor: { id: string; label: string | null };
}): Promise<PostToPageResult> {
  const page = await db.incidentStatusPage.findUnique({
    where: { incidentId: args.incidentId },
    select: { id: true, audienceScope: true, isPublished: true, incident: { select: { restricted: true, deletedAt: true, isTraining: true } } },
  });
  if (!page) return { ok: false, status: 400, error: "Create the status page first." };
  if (page.incident.isTraining) return { ok: false, status: 409, error: "Training incidents do not have a status page." };
  const update = await db.incidentStatusUpdate.findFirst({
    where: { id: args.updateId, incidentId: args.incidentId, organizationId: args.organizationId, unpublishedAt: null },
    select: { id: true, headline: true, body: true, audience: true },
  });
  if (!update) return { ok: false, status: 404, error: "Update not found." };
  if (!eligibleAudiences(page.audienceScope).includes(update.audience)) {
    return { ok: false, status: 400, error: `Only ${eligibleAudiences(page.audienceScope).join(" or ")} updates can go on this page.` };
  }
  const { count } = await db.incidentStatusUpdate.updateMany({
    where: { id: update.id, publishedToPageAt: null },
    data: { publishedToPageAt: new Date(), publishedToPageById: args.actor.id },
  });
  if (count === 0) return { ok: false, status: 409, error: "Already on the status page." };
  await db.$transaction(async (tx) => {
    await appendLedger(tx, {
      incidentId: args.incidentId,
      organizationId: args.organizationId,
      eventType: "status_page_update_posted",
      actorUserId: args.actor.id,
      actorLabel: args.actor.label,
      payload: { updateId: update.id, headline: update.headline, statusPageId: page.id },
    });
  });
  const live = statusPageLive(page, page.incident);
  if (live) {
    void notifyStatusPageSubscribers(page.id, update).catch((e) => console.error("[status-page] notify failed:", e));
  }
  return { ok: true, notifyQueued: live };
}
