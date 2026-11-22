// Digest flush — turns batched low-urgency NotificationDigestItem rows into one
// summary in-app notification (+ push) per user, then clears them. Driven by a
// cron tick (in-process, see server.ts); each user is flushed at most once per
// their cadence interval.

import { db } from "@/lib/db";
import { claimOne } from "@/lib/db/atomic-claim";
import { sendPushToUser } from "@/lib/push";
import { SOCKET_EVENTS } from "@/lib/socket/events";
import { canUserSeeIncident } from "@/lib/incident/access";

const INTERVAL_MS: Record<string, number> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

export async function flushDigests(now: Date = new Date()): Promise<{ usersFlushed: number; itemsSent: number }> {
  // Candidate users: have a cadence set AND at least one pending item.
  const settings = await db.userNotificationSetting.findMany({ where: { digestCadence: { in: ["hourly", "daily"] } } });
  let usersFlushed = 0;
  let itemsSent = 0;

  for (const s of settings) {
    const interval = INTERVAL_MS[s.digestCadence];
    if (!interval) continue;
    if (s.digestLastSentAt && now.getTime() - s.digestLastSentAt.getTime() < interval) continue;

    // Claim this user's cadence slot FIRST (guarded on the exact timestamp we
    // read) so two concurrent ticks can't both flush the same user. The loser
    // sees count 0 and skips.
    const won = await claimOne(
      db.userNotificationSetting.updateMany({
        where: { userId: s.userId, digestLastSentAt: s.digestLastSentAt },
        data: { digestLastSentAt: now },
      }),
    );
    if (!won) continue;

    const pending = await db.notificationDigestItem.findMany({ where: { userId: s.userId }, orderBy: { createdAt: "asc" } });
    if (pending.length === 0) continue; // nothing to send; clock already advanced

    // Access is re-checked at FLUSH time: an item queued before the incident
    // was locked (without this user on the allowlist) or soft-deleted must not
    // leak its title in the summary. Such items are dropped.
    const incidentIds = [...new Set(pending.map((i) => i.incidentId).filter((x): x is string => !!x))];
    const visible = new Set<string>();
    for (const incidentId of incidentIds) {
      if (await canUserSeeIncident(s.userId, incidentId).catch(() => false)) visible.add(incidentId);
    }
    const hiddenIds = pending.filter((i) => i.incidentId && !visible.has(i.incidentId)).map((i) => i.id);
    if (hiddenIds.length > 0) {
      await db.notificationDigestItem.deleteMany({ where: { id: { in: hiddenIds } } });
    }
    const items = pending.filter((i) => !i.incidentId || visible.has(i.incidentId));
    if (items.length === 0) continue;

    const title = `Incident activity (${items.length})`;
    const lines = items.slice(0, 8).map((i) => `• ${i.title}`);
    if (items.length > 8) lines.push(`…and ${items.length - 8} more`);
    const body = lines.join("\n");
    const link = items.find((i) => i.link)?.link ?? undefined;

    const notification = await db.notification.create({
      data: { userId: s.userId, type: "notification.digest", title, body, link, metadata: { count: items.length, digest: true } },
    });
    try {
      const { getIO } = await import("@/lib/socket/server");
      getIO().to(`user:${s.userId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification);
    } catch { /* socket down */ }
    await sendPushToUser(s.userId, { title, body: `${items.length} new updates.`, link }).catch(() => {});

    // Delete ONLY the ids we summarized — an item written between the read and
    // this delete survives and rolls into the next flush instead of vanishing.
    const summarizedIds = items.map((i) => i.id);
    await db.notificationDigestItem.deleteMany({ where: { id: { in: summarizedIds } } });
    usersFlushed += 1;
    itemsSent += items.length;
  }

  return { usersFlushed, itemsSent };
}
