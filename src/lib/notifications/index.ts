// =============================================================================
// Crucible CE - Notification Service
// =============================================================================
// Server-side helpers for creating, fetching, and managing notifications.
// Notifications are persisted in PostgreSQL via Prisma and optionally pushed
// to connected clients in real-time via Socket.io.
//
// Per-category, per-channel delivery preferences are resolved upstream by the
// notification dispatcher (see dispatch.ts / resolve.ts).
// =============================================================================

import { db } from "@/lib/db";
import { SOCKET_EVENTS } from "@/lib/socket/events";
import { sendPushToUser } from "@/lib/push";
import type { Notification, Prisma } from "@prisma/client";
import { isTrainingIncident, notificationIncidentId } from "@/lib/incident/training-guard";

// Notification types that also fire a mobile push (the paging companion).
// `critical` breaks through silent/DND (only for true pages).
const PUSH_TYPES: Record<string, { critical?: boolean }> = {
  incident_page: { critical: true },
  incident_task_assigned: {},
  incident_task_comment: {},
};

// ---------------------------------------------------------------------------
// createNotification
// ---------------------------------------------------------------------------

/**
 * Create a notification for a user.
 *
 * 1. Inserts the notification row into the database.
 * 2. Attempts to push the notification to the user's Socket.io room
 *    (`user:{userId}`). If Socket.io is not running or the emit fails,
 *    the database record is still preserved.
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  metadata?: Prisma.InputJsonValue,
  link?: string
): Promise<Notification | null> {
  // A training incident notifies no one (in app or by push).
  if (await isTrainingIncident(notificationIncidentId(metadata, link))) return null;

  // ---- persist ----
  const notification = await db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      link: link ?? undefined,
      metadata: metadata ?? undefined,
    },
  });

  // ---- real-time push (best-effort) ----
  try {
    const { getIO } = await import("@/lib/socket/server");
    const io = getIO();
    io.to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification);
  } catch {
    // Socket.io may not be initialised (e.g. during tests, build, or
    // server-side rendering). The notification is already in the DB so
    // this is non-fatal.
  }

  // ---- mobile push (best-effort) ----
  const push = PUSH_TYPES[type];
  if (push) {
    try {
      await sendPushToUser(userId, { title, body, link, critical: push.critical });
    } catch {
      // Push is best-effort; the in-app notification already landed.
    }
  }

  return notification;
}

// ---------------------------------------------------------------------------
// getUserNotifications
// ---------------------------------------------------------------------------

interface GetNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

interface GetNotificationsResult {
  notifications: Notification[];
  total: number;
}

/**
 * Fetch paginated notifications for a user.
 */
export async function getUserNotifications(
  userId: string,
  options: GetNotificationsOptions = {}
): Promise<GetNotificationsResult> {
  const { unreadOnly = false, limit = 20, offset = 0 } = options;

  const where: Prisma.NotificationWhereInput = {
    userId,
    dismissedAt: null, // exclude dismissed notifications
  };
  if (unreadOnly) {
    where.read = false;
  }

  const [notifications, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    db.notification.count({ where }),
  ]);

  return { notifications, total };
}

// ---------------------------------------------------------------------------
// markAsRead
// ---------------------------------------------------------------------------

/**
 * Mark a single notification as read. Verifies that the notification belongs
 * to the given user before updating.
 *
 * Returns the updated notification, or `null` if the notification was not
 * found or does not belong to the user.
 */
export async function markAsRead(
  notificationId: string,
  userId: string
): Promise<Notification | null> {
  const notification = await db.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    return null;
  }

  return db.notification.update({
    where: { id: notificationId },
    data: { read: true, readAt: new Date() },
  });
}

/**
 * Dismiss (soft-delete) a notification so it no longer shows in the inbox.
 * Returns the updated notification or null if not found / not owned by user.
 */
export async function dismissNotification(
  notificationId: string,
  userId: string
): Promise<Notification | null> {
  const notification = await db.notification.findFirst({
    where: { id: notificationId, userId },
  });

  if (!notification) {
    return null;
  }

  return db.notification.update({
    where: { id: notificationId },
    data: { dismissedAt: new Date(), read: true, readAt: notification.readAt ?? new Date() },
  });
}

// ---------------------------------------------------------------------------
// markAllAsRead
// ---------------------------------------------------------------------------

/**
 * Mark every unread notification as read for the given user.
 *
 * Returns the count of notifications that were updated.
 */
export async function markAllAsRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, read: false },
    // Set readAt alongside read (markAsRead/dismissNotification do too) so
    // read-time analytics and "read N ago" UI don't treat bulk-read rows as unread.
    data: { read: true, readAt: new Date() },
  });

  return result.count;
}
