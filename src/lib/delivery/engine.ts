// =============================================================================
// Out-of-band delivery engine
// =============================================================================
// deliverPage(): fan a page (or an escalation of it) out to every configured
//   channel for its target. One PageDelivery row per provider attempt,
//   idempotent on (pageId, level, provider, attempt); a ledger summary event
//   per fan-out. The in-app notification is created by the caller, as before.
// processDeliveryRetries(): the cron half (every minute). It
//   1. sweeps rows stuck in "pending" (crash mid-send) to failed + retry,
//   2. re-fans-out open pages whose CURRENT level has no delivery rows at all
//      (crash between the escalation claim / page insert and deliverPage),
//   3. retries due rows: failed attempts on backoff (1m / 5m / 15m by default)
//      and rate-limited skips waiting for their window. The NEXT attempt's
//      row is inserted first (its unique key is the claim), and only then is
//      the old row's nextRetryAt cleared, so a crash in between re-tries the
//      idempotent insert instead of silently losing the retry.
// Crash safety: the message is built BEFORE the row exists (a build failure is
//   a failed row with a retry, never an orphaned "pending"), and a throw after
//   the insert marks the row failed with a retry.
// Rate limits (anti toll-fraud): SMS and voice are counted separately per
//   phone number and per org per rolling hour. Escalations and critical pages
//   are exempt from the per-number cap but not from the high per-number abuse
//   ceiling or the org cap. A rate-limited send is never silently dropped: it
//   is re-queued for when the window frees (bounded) and the IC + admins get
//   an in-app alert.
// Toll fraud (L7): SMS/voice only to a VERIFIED phone (member: SMS code;
//   contact: SMS link) or one an administrator overrode (lib/delivery/phone-gate).
// Unreachable target: when NO addressed channel (email/SMS/voice) could even
//   be attempted for the target, the IC + admins get an in-app alert and the
//   result carries a warning for the pager.
// Locked incidents: a target the lock excludes still gets the page, REDACTED
//   (lib/delivery/redaction).
// =============================================================================

import { db } from "@/lib/db";
import { appendLedger } from "@/lib/ledger/append";
import { isClosedStatus } from "@/lib/incident/status";
import { createNotification } from "@/lib/notifications";
import { getPublicBaseUrl } from "@/lib/email/resend";
import { toE164 } from "@/lib/phone/e164";
import { claimOne } from "@/lib/db/atomic-claim";
import { createAckToken } from "./ack-token";
import {
  MAX_RATE_LIMITED_ATTEMPTS,
  METERED_CHANNELS,
  PENDING_STALE_MINUTES,
  REFANOUT_AFTER_MINUTES,
  nextRetryAt,
} from "./config";
import { checkMeteredRateLimit, type RateLimitHit } from "./metered";
import { UNVERIFIED_PHONE_REASON, contactPhoneAllowed, resolveMemberPhones } from "./phone-gate";
import { redactDeliveryError } from "./redact";
import { RESTRICTED_INCIDENT_TITLE, isRedactedTarget, redactedPageSentence } from "./redaction";
import { safeSend } from "./safe-send";
import { allProviders, planFanOut } from "./registry";
import { liveIncidentWhere } from "@/lib/incident/live";
import type {
  DeliveryChannel,
  DeliveryKind,
  DeliveryMessage,
  DeliveryProvider,
  DeliveryRecipient,
  DeliveryResult,
} from "./types";

export type PageDeliveryKind = Extract<DeliveryKind, "page" | "escalation">;

export interface DeliveryOutcome {
  provider: string;
  channel: string;
  attempt: number;
  /** "duplicate" = this (page, level, provider, attempt) was already recorded; nothing sent. */
  status: DeliveryResult["status"] | "duplicate";
  error?: string;
}

const pageSelect = {
  id: true,
  organizationId: true,
  incidentId: true,
  targetUserId: true,
  targetContactId: true,
  targetLabel: true,
  message: true,
  priority: true,
  status: true,
  escalationLevel: true,
  createdById: true,
  incident: { select: { id: true, title: true, severity: true, status: true, restricted: true, deletedAt: true, isTraining: true } },
} as const;

export type LoadedPage = {
  id: string;
  organizationId: string;
  incidentId: string;
  targetUserId: string | null;
  targetContactId: string | null;
  targetLabel: string | null;
  message: string | null;
  priority: string;
  status: string;
  escalationLevel: number;
  createdById: string | null;
  incident: { id: string; title: string; severity: string; status: string; restricted?: boolean; deletedAt?: Date | null; isTraining?: boolean };
};

function loadPage(pageId: string): Promise<LoadedPage | null> {
  return db.incidentPage.findUnique({ where: { id: pageId }, select: pageSelect }) as Promise<LoadedPage | null>;
}

/** Why a page must not be delivered right now, or null when it is deliverable. */
export function undeliverableReason(page: LoadedPage | null, level?: number): string | null {
  if (!page) return "page_not_found";
  if (page.incident.deletedAt) return "incident_deleted";
  // Backstop: the page route refuses training incidents before any row exists.
  if (page.incident.isTraining) return "training_incident";
  if (isClosedStatus(page.incident.status)) return "incident_closed";
  if (page.status !== "sent") return `page_${page.status}`;
  if (level !== undefined && page.escalationLevel !== level) return "page_escalated";
  return null;
}

// ---------------------------------------------------------------------------
// Recipient + message
// ---------------------------------------------------------------------------

/** A resolved page recipient. `phoneBlocked` = there is a phone, but it may not be dialed. */
export type PageRecipient = DeliveryRecipient & { phoneBlocked?: string | null };

/**
 * The page target's channel addresses. Users: account email; phone from
 * lib/delivery/phone-gate (their own VERIFIED or admin-overridden notification
 * number, else a linked matrix contact's verified/overridden phone). External
 * contacts: the matrix entry itself, dialed only when its phone is verified
 * (SMS link) or allowUnverifiedPhone is set. Phones are E.164.
 */
export async function resolvePageRecipient(page: {
  organizationId: string;
  targetUserId: string | null;
  targetContactId: string | null;
  targetLabel?: string | null;
}): Promise<PageRecipient | null> {
  if (page.targetUserId) {
    const user = await db.user.findFirst({
      where: { id: page.targetUserId, organizationId: page.organizationId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!user) return null;
    const phones = await resolveMemberPhones(page.organizationId, [user.id]);
    const p = phones.get(user.id) ?? { phone: null, blocked: null };
    return { name: user.name ?? user.email, email: user.email, phone: p.phone, userId: user.id, contactId: null, phoneBlocked: p.blocked };
  }
  if (page.targetContactId) {
    const c = await db.escalationContact.findFirst({
      where: { id: page.targetContactId, organizationId: page.organizationId, isActive: true },
      select: { id: true, name: true, email: true, phone: true, userId: true, phoneVerifiedAt: true, allowUnverifiedPhone: true },
    });
    if (!c) return null;
    const dialable = toE164(c.phone);
    const allowed = dialable !== null && contactPhoneAllowed(c);
    return {
      name: c.name,
      email: c.email,
      phone: allowed ? dialable : null,
      userId: c.userId,
      contactId: c.id,
      phoneBlocked: dialable && !allowed ? UNVERIFIED_PHONE_REASON : null,
    };
  }
  return null;
}

/** Strip engine-internal fields before a recipient reaches a provider. */
function providerRecipient(r: PageRecipient): DeliveryRecipient {
  return { name: r.name, email: r.email ?? null, phone: r.phone ?? null, userId: r.userId ?? null, contactId: r.contactId ?? null };
}

export function ackUrlFor(pageId: string, level: number, now: Date = new Date()): string {
  return `${getPublicBaseUrl().replace(/\/+$/, "")}/api/public/page-ack/${createAckToken(pageId, level, now)}`;
}

/** Stable idempotency key of a page delivery: the same for every retry. */
export function deliveryKey(pageId: string, level: number, providerId: string): string {
  return `${pageId}:${level}:${providerId}`;
}

export function buildPageMessage(
  page: LoadedPage,
  opts: { kind: PageDeliveryKind; providerId: string; attempt: number; pagerName?: string | null; now: Date; redacted?: boolean },
): DeliveryMessage {
  const base = getPublicBaseUrl().replace(/\/+$/, "");
  const sev = page.incident.severity.toUpperCase();
  const common = {
    kind: opts.kind,
    id: deliveryKey(page.id, page.escalationLevel, opts.providerId),
    attempt: opts.attempt,
    page: { id: page.id, level: page.escalationLevel, priority: page.priority },
    ackUrl: ackUrlFor(page.id, page.escalationLevel, opts.now),
    sentAt: opts.now.toISOString(),
  };
  if (opts.redacted) {
    // LOCKED incident + a target the lock excludes: severity + ack link only.
    // No title, no note, no incident id / deep link.
    return {
      ...common,
      incident: { id: "", title: RESTRICTED_INCIDENT_TITLE, severity: page.incident.severity, url: "" },
      title: `[${sev}] Restricted incident page`,
      text: redactedPageSentence(page.incident.severity, opts.kind),
      restricted: true,
    };
  }
  const note = page.message?.trim();
  const title =
    opts.kind === "escalation"
      ? `[${sev}] Escalated page: ${page.incident.title}`
      : `[${sev}] Paged: ${page.incident.title}`;
  const lead =
    opts.kind === "escalation"
      ? `An unacknowledged page was escalated to you (level ${page.escalationLevel}).`
      : `${opts.pagerName?.trim() || "A responder"} paged you to a ${page.incident.severity} incident.`;
  return {
    ...common,
    incident: {
      id: page.incident.id,
      title: page.incident.title,
      severity: page.incident.severity,
      url: `${base}/incidents/${page.incident.id}`,
    },
    title,
    text: note ? `${lead} Note: ${note}` : lead,
    restricted: false,
  };
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

function destinationFor(channel: string, recipient: PageRecipient | null): string | null {
  if (!recipient) return null;
  if (channel === "email") return recipient.email ?? null;
  if (channel === "sms" || channel === "voice") return toE164(recipient.phone) ?? recipient.phone ?? null;
  return null;
}

/**
 * In-app alert to the incident commander + org administrators that a page
 * channel was rate limited. It WILL be retried, but a human should know the
 * phone channel is throttled. Best-effort; never blocks delivery. (Both
 * audiences can see a locked incident, so the title is fine here.)
 */
async function alertAudience(page: LoadedPage): Promise<Set<string>> {
  const [ics, admins] = await Promise.all([
      db.incidentRoleAssignment.findMany({
        where: { incidentId: page.incidentId, organizationId: page.organizationId, role: "incident_commander", userId: { not: null } },
        select: { userId: true },
      }),
      db.user.findMany({
        where: { organizationId: page.organizationId, role: "administrator", isActive: true },
        select: { id: true },
        take: 25,
      }),
  ]);
  return new Set<string>([...ics.map((r) => r.userId).filter((x): x is string => !!x), ...admins.map((u) => u.id)]);
}

async function alertRateLimited(page: LoadedPage, channel: string, reason: string, retryAt: Date | null): Promise<void> {
  try {
    const ids = await alertAudience(page);
    const label = channel === "voice" ? "Voice call" : "SMS";
    const when = retryAt
      ? `It will be retried automatically at ${retryAt.toISOString().slice(11, 16)} UTC`
      : "It will NOT be retried again (retry limit reached)";
    for (const id of ids) {
      await createNotification(
        id,
        "page_delivery_rate_limited",
        `${label} page throttled: ${page.incident.title}`,
        `The ${label.toLowerCase()} page to ${page.targetLabel ?? "a responder"} hit a toll-fraud rate limit (${reason}). ${when}; other channels were still sent.`,
        { incidentId: page.incidentId, pageId: page.id, channel },
        `/incidents/${page.incidentId}/escalation`,
      );
    }
  } catch (err) {
    console.error(`[delivery] rate-limit alert for page ${page.id} failed:`, err);
  }
}

/** Channels that address the page TARGET (webhooks/plugins do not). */
const ADDRESSED_CHANNELS = new Set(["email", "sms", "voice"]);

/**
 * Could ANY addressed channel (email / SMS / voice) be attempted for the
 * target? Sent, pending and failed (retrying) count; a rate-limited skip
 * counts too (it is re-queued and already alerted). All-skipped means nobody
 * can be reached out of band: returns a human sentence, else null.
 */
export function unreachableWarning(outcomes: DeliveryOutcome[], targetLabel: string | null): string | null {
  const addressed = outcomes.filter((o) => ADDRESSED_CHANNELS.has(o.channel) && o.status !== "duplicate");
  if (addressed.length === 0) return null; // nothing recorded this call (e.g. a repeat fan-out)
  const reachable = addressed.some((o) => o.status !== "skipped" || (o.error ?? "").startsWith("rate limited"));
  if (reachable) return null;
  const reasons = [...new Set(addressed.map((o) => `${o.channel}: ${o.error ?? "skipped"}`))].join("; ");
  return `No email, SMS or voice channel could reach ${targetLabel ?? "the target"} (${reasons}). Only in-app and any webhooks/plugins were used. Verify their phone or configure a provider.`;
}

/** In-app alert to the IC + admins that a page reached nobody out of band. Best-effort. */
async function alertUnreachable(page: LoadedPage, warning: string): Promise<void> {
  try {
    const ids = await alertAudience(page);
    for (const id of ids) {
      await createNotification(
        id,
        "page_delivery_unreachable",
        `Page could not be delivered: ${page.incident.title}`,
        warning,
        { incidentId: page.incidentId, pageId: page.id },
        `/incidents/${page.incidentId}/escalation`,
      );
    }
  } catch (err) {
    console.error(`[delivery] unreachable alert for page ${page.id} failed:`, err);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

interface AttemptArgs {
  page: LoadedPage;
  recipient: PageRecipient | null;
  providerId: string;
  channel: DeliveryChannel | string;
  provider: DeliveryProvider | null;
  attempt: number;
  kind: PageDeliveryKind;
  pagerName?: string | null;
  /** Locked incident + a target the lock excludes: send the redacted page. */
  redacted?: boolean;
  /** Raise the IC/admin alert when this attempt is rate limited. */
  alertOnRateLimit?: boolean;
  /** Record this result without calling a provider (honest skips). */
  forced?: DeliveryResult;
  now: Date;
}

const isMetered = (channel: string) => (METERED_CHANNELS as readonly string[]).includes(channel);

async function executeAttempt(a: AttemptArgs): Promise<DeliveryOutcome> {
  const destination = destinationFor(a.channel, a.recipient);
  let forced = a.forced ?? null;
  let retryAt: Date | null = null;
  let rateLimited: RateLimitHit | null = null;
  if (!forced && !a.recipient) forced = { status: "skipped", error: "Recipient no longer active" };
  if (!forced && isMetered(a.channel) && a.recipient?.phoneBlocked && !destination) {
    forced = { status: "skipped", error: a.recipient.phoneBlocked };
  }
  // An addressed channel with no address on file: record an honest skip
  // without calling the provider.
  if (!forced && a.recipient && !destination && ADDRESSED_CHANNELS.has(a.channel)) {
    forced = { status: "skipped", error: a.channel === "email" ? "no email address on file" : "no phone number on file" };
  }
  if (!forced && destination && isMetered(a.channel)) {
    rateLimited = await checkMeteredRateLimit(a.page.organizationId, destination, a.channel, a.now, {
      exemptPerNumber: a.kind === "escalation" || a.page.incident.severity === "critical",
    });
    if (rateLimited) {
      forced = { status: "skipped", error: rateLimited.reason };
      // Never a silent drop: retry when the window frees (bounded).
      retryAt = a.attempt < MAX_RATE_LIMITED_ATTEMPTS ? rateLimited.retryAt : null;
    }
  }

  // Build the message BEFORE the row exists: a build failure (e.g. no
  // AUTH_SECRET to sign the ack link) is a failed attempt with a retry, never
  // an orphaned "pending" row.
  let msg: DeliveryMessage | null = null;
  if (!forced && a.provider && a.recipient) {
    try {
      msg = buildPageMessage(a.page, {
        kind: a.kind,
        providerId: a.providerId,
        attempt: a.attempt,
        pagerName: a.pagerName,
        now: a.now,
        redacted: a.redacted,
      });
    } catch (err) {
      forced = { status: "failed", error: `could not build message: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000) };
      retryAt = nextRetryAt(a.attempt, a.now);
    }
  }

  // Insert-or-skip on the (pageId, level, provider, attempt) unique key: a
  // concurrent or repeated fan-out gets an empty result instead of a second send.
  const created = await db.pageDelivery.createManyAndReturn({
    data: [
      {
        organizationId: a.page.organizationId,
        pageId: a.page.id,
        incidentId: a.page.incidentId,
        level: a.page.escalationLevel,
        kind: a.kind,
        provider: a.providerId,
        channel: a.channel,
        recipientName: a.recipient?.name ?? a.page.targetLabel,
        destination,
        attempt: a.attempt,
        status: forced ? forced.status : "pending",
        error: forced?.error ?? null,
        nextRetryAt: retryAt,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length === 0) return { provider: a.providerId, channel: a.channel, attempt: a.attempt, status: "duplicate" };
  const rowId = created[0].id;
  if (rateLimited && a.alertOnRateLimit) await alertRateLimited(a.page, a.channel, rateLimited.reason, retryAt);
  if (forced || !a.provider || !a.recipient || !msg) {
    const f = forced ?? { status: "skipped" as const, error: "not configured" };
    return { provider: a.providerId, channel: a.channel, attempt: a.attempt, status: f.status, error: f.error };
  }

  let result: DeliveryResult;
  try {
    result = await safeSend(a.provider, msg, providerRecipient(a.recipient));
    await db.pageDelivery.update({
      where: { id: rowId },
      data: {
        status: result.status,
        providerRef: result.providerRef ?? null,
        error: result.error ?? null,
        nextRetryAt: result.status === "failed" ? nextRetryAt(a.attempt, new Date()) : null,
      },
    });
  } catch (err) {
    // Never leave the row "pending": mark it failed with a retry. (If even
    // this write fails, the stale-pending sweep recovers the row.)
    const error = `internal error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000);
    await db.pageDelivery
      .updateMany({ where: { id: rowId, status: "pending" }, data: { status: "failed", error, nextRetryAt: nextRetryAt(a.attempt, new Date()) } })
      .catch((e) => console.error(`[delivery] could not mark delivery ${rowId} failed:`, e));
    result = { status: "failed", error };
  }
  return { provider: a.providerId, channel: a.channel, attempt: a.attempt, status: result.status, error: result.error };
}

/** Redact this page for its target? Fails closed (redacted, still delivered). */
function redactionFor(page: LoadedPage): Promise<boolean> {
  return isRedactedTarget(page).catch((err) => {
    console.error(`[delivery] lock check for page ${page.id} failed; sending redacted:`, err);
    return true;
  });
}

async function pagerNameFor(page: LoadedPage): Promise<string | null> {
  if (!page.createdById) return null;
  const u = await db.user.findUnique({ where: { id: page.createdById }, select: { name: true, email: true } });
  return u?.name ?? u?.email ?? null;
}

async function ledgerSummary(page: LoadedPage, kind: string, outcomes: DeliveryOutcome[]): Promise<void> {
  const recorded = outcomes.filter((o) => o.status !== "duplicate");
  if (recorded.length === 0) return;
  try {
    await db.$transaction(async (tx) => {
      await appendLedger(tx, {
        incidentId: page.incidentId,
        organizationId: page.organizationId,
        eventType: "page_delivery",
        actorUserId: null,
        actorLabel: "delivery",
        payload: {
          deliveryKind: kind,
          pageId: page.id,
          level: page.escalationLevel,
          target: page.targetLabel,
          deliveries: recorded.map((o) => ({
            provider: o.provider,
            channel: o.channel,
            attempt: o.attempt,
            status: o.status,
            // The ledger is readable by every viewer of the incident: a coarse
            // category, never raw provider text (phone numbers, bodies).
            ...(o.error ? { error: redactDeliveryError(o.error) } : {}),
          })),
        },
      });
    });
  } catch (err) {
    console.error(`[delivery] ledger summary failed for page ${page.id}:`, err);
  }
}

/**
 * Fan a page out to every configured channel for its current target. Safe to
 * call twice for the same page + level: the second call records nothing new.
 */
export async function deliverPage(
  pageId: string,
  opts: { kind?: PageDeliveryKind; pagerName?: string | null; now?: Date } = {},
): Promise<{ outcomes: DeliveryOutcome[]; skippedReason?: string; warning?: string }> {
  const now = opts.now ?? new Date();
  const kind = opts.kind ?? "page";
  const page = await loadPage(pageId);
  const reason = undeliverableReason(page);
  if (reason || !page) return { outcomes: [], skippedReason: reason ?? "page_not_found" };

  const [recipient, pagerName, redacted] = await Promise.all([
    resolvePageRecipient(page),
    opts.pagerName !== undefined ? Promise.resolve(opts.pagerName) : kind === "page" ? pagerNameFor(page) : Promise.resolve(null),
    redactionFor(page),
  ]);
  const plan = planFanOut(await allProviders());

  const outcomes = await Promise.all(
    plan.map((p) =>
      executeAttempt({
        page,
        recipient,
        kind,
        pagerName,
        redacted,
        alertOnRateLimit: true,
        attempt: 1,
        now,
        ...(p.kind === "send"
          ? { providerId: p.reg.provider.id, channel: p.channel, provider: p.reg.provider }
          : { providerId: p.providerId, channel: p.channel, provider: null, forced: p.result }),
      }).catch((err): DeliveryOutcome => {
        console.error(`[delivery] attempt failed for page ${page.id}:`, err);
        return {
          provider: p.kind === "send" ? p.reg.provider.id : p.providerId,
          channel: p.channel,
          attempt: 1,
          status: "failed",
          error: "internal error",
        };
      }),
    ),
  );
  await ledgerSummary(page, kind, outcomes);
  const warning = unreachableWarning(outcomes, page.targetLabel);
  if (warning) {
    await alertUnreachable(page, warning);
    return { outcomes, warning };
  }
  return { outcomes };
}

/**
 * Recover rows stuck in "pending" (the process died between inserting the
 * attempt and recording the provider's answer): after PENDING_STALE_MINUTES
 * they are marked failed with a retry on the normal backoff. A stale row may
 * in fact have been delivered; a duplicate page beats a missing one (the
 * webhook/plugin idempotency key lets receivers drop it).
 */
export async function sweepStalePendingDeliveries(now: Date = new Date(), limit = 100): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_STALE_MINUTES * 60_000);
  const stale = await db.pageDelivery.findMany({
    where: { status: "pending", updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, attempt: true },
  });
  let swept = 0;
  for (const row of stale) {
    const res = await db.pageDelivery.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "failed", error: "stalled: no provider result was recorded", nextRetryAt: nextRetryAt(row.attempt, now) },
    });
    swept += res?.count ?? 0;
  }
  return swept;
}

/**
 * Recover a crash between the escalation claim (level bump) or the page
 * insert and deliverPage(): any OPEN page whose CURRENT level has zero
 * PageDelivery rows (a fan-out always records at least the built-in
 * email/SMS/voice rows), untouched for > REFANOUT_AFTER_MINUTES, is fanned out
 * now. deliverPage is idempotent, so a racing original fan-out can't double-send.
 */
export async function refanOutUndeliveredPages(now: Date = new Date(), limit = 50): Promise<number> {
  const pages = await db.incidentPage.findMany({
    where: {
      status: "sent",
      updatedAt: { lt: new Date(now.getTime() - REFANOUT_AFTER_MINUTES * 60_000), gte: new Date(now.getTime() - 24 * 3600_000) },
      incident: liveIncidentWhere({ status: { not: "closed" } }),
    },
    orderBy: { updatedAt: "asc" },
    take: limit * 4,
    select: { id: true, escalationLevel: true, deliveries: { select: { level: true } } },
  });
  let refanned = 0;
  for (const p of pages) {
    if (refanned >= limit) break;
    if (p.deliveries.some((d) => d.level === p.escalationLevel)) continue;
    const res = await deliverPage(p.id, { kind: p.escalationLevel > 0 ? "escalation" : "page", now }).catch((err) => {
      console.error(`[delivery] re-fan-out of page ${p.id} failed:`, err);
      return null;
    });
    if (res && res.outcomes.some((o) => o.status !== "duplicate")) refanned += 1;
  }
  return refanned;
}

export interface RetryRunResult {
  retried: number;
  abandoned: number;
  swept: number;
  refanned: number;
}

/** Cron: sweep stale pending rows, re-fan-out undelivered pages, retry due rows. */
export async function processDeliveryRetries(now: Date = new Date(), limit = 50): Promise<RetryRunResult> {
  const swept = await sweepStalePendingDeliveries(now).catch((err) => {
    console.error("[delivery] stale-pending sweep failed:", err);
    return 0;
  });
  const refanned = await refanOutUndeliveredPages(now).catch((err) => {
    console.error("[delivery] re-fan-out sweep failed:", err);
    return 0;
  });
  const due = await db.pageDelivery.findMany({
    // failed attempts on backoff + rate-limited skips waiting for their window
    where: { status: { in: ["failed", "skipped"] }, nextRetryAt: { lte: now } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
  });
  let retried = 0;
  let abandoned = 0;
  if (due.length === 0) return { retried, abandoned, swept, refanned };
  const providers = await allProviders();

  const clear = (row: { id: string; nextRetryAt: Date | null }) =>
    claimOne(db.pageDelivery.updateMany({ where: { id: row.id, nextRetryAt: row.nextRetryAt }, data: { nextRetryAt: null } }));

  for (const row of due) {
    try {
      const page = await loadPage(row.pageId);
      if (undeliverableReason(page, row.level) || !page) {
        // Acked, escalated, cancelled, expired, incident closed or deleted.
        if (await clear(row)) abandoned += 1;
        continue;
      }
      const reg = providers.find((r) => r.provider.id === row.provider);
      const configured = reg ? (() => { try { return reg.provider.isConfigured(); } catch { return false; } })() : false;
      const [recipient, redacted] = await Promise.all([resolvePageRecipient(page), redactionFor(page)]);
      const kind: PageDeliveryKind = row.kind === "escalation" ? "escalation" : "page";
      const outcome = await executeAttempt({
        page,
        recipient,
        kind,
        pagerName: kind === "page" ? await pagerNameFor(page) : null,
        redacted,
        // A row that was itself a rate-limited skip already alerted.
        alertOnRateLimit: row.status !== "skipped",
        providerId: row.provider,
        channel: row.channel,
        provider: configured && reg ? reg.provider : null,
        attempt: row.attempt + 1,
        now,
        ...(configured ? {} : { forced: { status: "skipped" as const, error: "provider no longer configured" } }),
      });
      // The next attempt now exists (inserted here, or by a racing worker):
      // the old row's retry is done either way.
      await clear(row);
      if (outcome.status !== "duplicate") retried += 1;
    } catch (err) {
      console.error(`[delivery] retry of delivery ${row.id} failed:`, err);
    }
  }
  return { retried, abandoned, swept, refanned };
}

/**
 * Best-effort "page acknowledged" notice to webhooks and plugins (so an
 * external pager can resolve its own alert). Not recorded or retried. On a
 * LOCKED incident it never carries the incident title.
 */
export async function sendAckNotice(pageId: string, via: string, now: Date = new Date()): Promise<void> {
  try {
    const page = await loadPage(pageId);
    // A soft-deleted incident sends nothing out, not even an ack notice.
    if (!page || page.incident.deletedAt) return;
    const resolved = await resolvePageRecipient(page);
    const recipient: DeliveryRecipient = resolved ? providerRecipient(resolved) : { name: page.targetLabel ?? "responder" };
    const targets = (await allProviders()).filter((r) => !r.addressed && (() => { try { return r.provider.isConfigured(); } catch { return false; } })());
    const base = getPublicBaseUrl().replace(/\/+$/, "");
    const restricted = Boolean(page.incident.restricted);
    const incident = restricted
      ? { id: "", title: RESTRICTED_INCIDENT_TITLE, severity: page.incident.severity, url: "" }
      : { id: page.incident.id, title: page.incident.title, severity: page.incident.severity, url: `${base}/incidents/${page.incident.id}` };
    await Promise.all(
      targets.map((r) =>
        safeSend(
          r.provider,
          {
            kind: "ack",
            id: `${deliveryKey(page.id, page.escalationLevel, r.provider.id)}:ack`,
            attempt: 1,
            incident,
            page: { id: page.id, level: page.escalationLevel, priority: page.priority },
            title: restricted ? "Acknowledged: restricted incident page" : `Acknowledged: ${page.incident.title}`,
            text: `${recipient.name} acknowledged the page (via ${via}).`,
            ackUrl: null,
            sentAt: now.toISOString(),
            restricted,
          },
          recipient,
        ),
      ),
    );
  } catch (err) {
    console.error(`[delivery] ack notice for page ${pageId} failed:`, err);
  }
}

/** Settings → Delivery "Send test": one provider, one recipient, no DB rows. */
/**
 * One test message through one provider. `opts` lets the onboarding self test
 * page (lib/onboarding/test-page) carry its own signed ack link and wording;
 * Settings -> Delivery sends the plain provider test.
 */
export async function sendTestDelivery(
  providerId: string,
  recipient: DeliveryRecipient,
  opts: { title?: string; text?: string; ackUrl?: string | null } = {},
): Promise<DeliveryResult> {
  const reg = (await allProviders()).find((r) => r.provider.id === providerId);
  if (!reg) return { status: "failed", error: "unknown provider" };
  let configured = false;
  try {
    configured = reg.provider.isConfigured();
  } catch {
    configured = false;
  }
  if (!configured) return { status: "skipped", error: "not configured" };
  const now = new Date();
  return safeSend(
    reg.provider,
    {
      kind: "test",
      id: `test:${providerId}:${now.getTime()}`,
      attempt: 1,
      incident: null,
      page: null,
      title: opts.title ?? "Crucible delivery test",
      text: opts.text ?? `Test message from Crucible CE via ${reg.provider.displayName}. If you received this, the provider works.`,
      ackUrl: opts.ackUrl ?? null,
      sentAt: now.toISOString(),
    },
    providerRecipient(recipient),
  );
}
