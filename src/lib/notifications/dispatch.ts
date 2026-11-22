// =============================================================================
// notify() — the event-centric dispatcher for incident notifications.
//
// One call describes WHAT happened; the dispatcher works out WHO should hear
// about it (audience), HOW each person wants it (resolveDelivery), suppresses
// muted incidents and rapid duplicates, then fans out across channels. Callers
// never touch channels or preferences directly.
// =============================================================================

import { usersWithIncidentAccess } from "@/lib/socket/access";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { SOCKET_EVENTS } from "@/lib/socket/events";
import { sendPushToUser } from "@/lib/push";
import { sendEmail } from "./channels";
import { resolveMemberPhones } from "@/lib/delivery/phone-gate";
import { sendMeteredSms } from "@/lib/delivery/metered";
import { resolveDelivery } from "./resolve";
import { CATEGORY_BY_CODE, EVENT_TO_CATEGORY, type Channel } from "./catalog";
import { isTrainingIncident } from "@/lib/incident/training-guard";

export interface NotifyInput {
  event: string; // ledger-style event key (see EVENT_TO_CATEGORY)
  organizationId: string;
  title: string;
  body: string;
  link?: string;
  incidentId?: string;
  actorUserId?: string | null; // never notifies the actor about their own action
  metadata?: Prisma.InputJsonValue;
  /** Explicit recipients — required for "direct" categories (assignee etc.). */
  recipientIds?: string[];
  /** Override the category when the event key isn't in the catalog map. */
  categoryOverride?: string;
  /** Per-call EMAIL override. (There is no phone override: SMS only ever goes
   * to the recipient's own verified number, see resolveRecipientContacts.) */
  contact?: { email?: string | null };
}

export interface NotifyResult {
  category: string;
  recipients: number;
  /** channels = what actually DELIVERED (in_app deduped counts as delivered;
   * push counts when ≥1 device accepted; email/sms only on provider accept). */
  delivered: { userId: string; channels: Channel[]; digested: boolean }[];
}

/**
 * Per-recipient contact resolution: email from the User row; phone through the
 * SAME toll-fraud gate as paging (lib/delivery/phone-gate): the user's own
 * VERIFIED (or admin-overridden) notification phone, else a linked matrix
 * contact's verified/overridden phone; an unverified number is never texted.
 * Batched: three queries for any roster size.
 */
async function resolveRecipientContacts(
  userIds: string[],
  organizationId: string,
): Promise<Map<string, { email: string | null; phone: string | null }>> {
  const map = new Map<string, { email: string | null; phone: string | null }>();
  if (userIds.length === 0) return map;
  const [users, phones] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    resolveMemberPhones(organizationId, userIds),
  ]);
  for (const u of users) {
    map.set(u.id, { email: u.email ?? null, phone: phones.get(u.id)?.phone ?? null });
  }
  return map;
}

// ---- low-level in-app writer (persist + realtime emit) --------------------
async function deliverInApp(userId: string, type: string, title: string, body: string, link?: string, metadata?: Prisma.InputJsonValue) {
  const notification = await db.notification.create({
    data: { userId, type, title, body, link: link ?? undefined, metadata: metadata ?? undefined },
  });
  try {
    const { getIO } = await import("@/lib/socket/server");
    getIO().to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification);
  } catch {
    // socket not running (build/test/SSR) — DB row already persisted
  }
  return notification;
}

// ---- audience resolution ---------------------------------------------------
async function resolveAudience(input: NotifyInput, categoryCode: string): Promise<string[]> {
  if (input.recipientIds && input.recipientIds.length > 0) return input.recipientIds;
  const cat = CATEGORY_BY_CODE[categoryCode];
  if (!cat || !input.incidentId) return [];

  const ids = new Set<string>();
  if (cat.audience === "roster" || cat.audience === "command") {
    const roles = await db.incidentRoleAssignment.findMany({ where: { incidentId: input.incidentId, userId: { not: null } }, select: { userId: true } });
    roles.forEach((r) => r.userId && ids.add(r.userId));
  }
  if (cat.audience === "roster") {
    const parts = await db.incidentParticipant.findMany({ where: { incidentId: input.incidentId, userId: { not: null } }, select: { userId: true } });
    parts.forEach((p) => p.userId && ids.add(p.userId));
  }
  if (cat.audience === "roster" || cat.audience === "watchers") {
    const watchers = await db.incidentSubscription.findMany({ where: { incidentId: input.incidentId, mode: "watch" }, select: { userId: true } });
    watchers.forEach((w) => ids.add(w.userId));
  }
  return [...ids];
}

// ---- duplicate suppression -------------------------------------------------
// Drops an identical in-app notification fired for the same user within a short
// window (rapid repeated events), so 10 quick edits aren't 10 pings.
async function isDuplicate(userId: string, type: string, title: string, body: string): Promise<boolean> {
  const since = new Date(Date.now() - 45_000);
  const existing = await db.notification.findFirst({
    where: { userId, type, title, body, createdAt: { gte: since } },
    select: { id: true },
  });
  return existing !== null;
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const categoryCode = input.categoryOverride ?? EVENT_TO_CATEGORY[input.event] ?? "";
  const cat = CATEGORY_BY_CODE[categoryCode];
  const result: NotifyResult = { category: categoryCode, recipients: 0, delivered: [] };
  if (!cat) return result; // unknown event — caller should use createNotification directly
  // A training incident reaches no one, on any channel.
  if (await isTrainingIncident(input.incidentId)) return result;

  const audience = (await resolveAudience(input, categoryCode)).filter((id) => id && id !== input.actorUserId);
  let recipients = [...new Set(audience)];
  // Lock rules apply to notifications too: a watcher or non-IC role holder
  // who can't see a locked incident must not get its titles pushed to them.
  if (input.incidentId && recipients.length > 0) {
    const allowed = await usersWithIncidentAccess(input.incidentId, recipients);
    recipients = recipients.filter((id) => allowed.has(id));
  }
  result.recipients = recipients.length;
  const isCritical = cat.urgency === "critical";

  // Mute overlay: a muted incident silences everything but criticals.
  let mutedSet = new Set<string>();
  if (input.incidentId && !isCritical) {
    const muted = await db.incidentSubscription.findMany({ where: { incidentId: input.incidentId, mode: "mute", userId: { in: recipients } }, select: { userId: true } });
    mutedSet = new Set(muted.map((m) => m.userId));
  }

  // each recipient gets THEIR OWN contact details (the old shared
  // input.contact was never passed by any call site, so email/SMS silently
  // never sent). input.contact remains an optional per-call override.
  const contactMap = await resolveRecipientContacts(recipients, input.organizationId);

  for (const userId of recipients) {
    if (mutedSet.has(userId)) continue;
    const decision = await resolveDelivery(userId, input.organizationId, categoryCode);
    if (decision.channels.length === 0 && !decision.digest) continue;

    // Digest path: stash a low-urgency item instead of delivering now.
    if (decision.digest) {
      await db.notificationDigestItem.create({
        data: { userId, categoryCode, title: input.title, body: input.body, link: input.link ?? null, incidentId: input.incidentId ?? null },
      });
      result.delivered.push({ userId, channels: [], digested: true });
      continue;
    }

    const contact = {
      email: input.contact?.email ?? contactMap.get(userId)?.email ?? null,
      phone: contactMap.get(userId)?.phone ?? null,
    };

    // Track what actually delivered — the report must never claim a channel
    // that skipped or failed (the old code echoed decision.channels verbatim).
    const delivered: Channel[] = [];
    if (decision.channels.includes("in_app")) {
      if (!(await isDuplicate(userId, categoryCode, input.title, input.body))) {
        await deliverInApp(userId, categoryCode, input.title, input.body, input.link, input.metadata);
      }
      delivered.push("in_app"); // deduped still counts — the user has the ping
    }
    if (decision.channels.includes("push")) {
      try {
        const { sent } = await sendPushToUser(userId, { title: input.title, body: input.body, link: input.link, critical: isCritical });
        if (sent > 0) delivered.push("push");
      } catch { /* best effort */ }
    }
    if (decision.channels.includes("email")) {
      try {
        const r = await sendEmail(contact.email, { subject: input.title, message: input.body, link: input.link });
        if (r.ok) delivered.push("email");
      } catch { /* best effort */ }
    }
    if (decision.channels.includes("sms")) {
      try {
        // Metered gate: E.164, per-number + per-org rate limits and the
        // per-number ceiling, counted together with page deliveries.
        const body = `${input.title}: ${input.body}`;
        const r = await sendMeteredSms({
          organizationId: input.organizationId,
          to: contact.phone,
          body: input.link ? `${body} ${input.link}` : body,
          purpose: "notify",
        });
        if (r.ok) delivered.push("sms");
      } catch { /* best effort */ }
    }
    result.delivered.push({ userId, channels: delivered, digested: false });
  }

  return result;
}
