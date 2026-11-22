import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { SOCKET_EVENTS } from "@/lib/socket/events";

// POST /api/notifications/test — fire a test notification at yourself across
// in-app + push, so you can confirm delivery (and that your device is
// registered) without waiting for a real incident event.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const notification = await db.notification.create({
    data: {
      userId,
      type: "system",
      title: "Test notification",
      body: "In-app notifications work.",
      metadata: { test: true },
    },
  });
  try {
    const { getIO } = await import("@/lib/socket/server");
    getIO().to(`user:${userId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification);
  } catch {
    /* socket not running */
  }

  const push = await sendPushToUser(userId, {
    title: "Test notification",
    body: "Push notifications work.",
  }).catch(() => ({ sent: 0, devices: 0 }));

  return NextResponse.json({ ok: true, pushDevices: push.devices, pushSent: push.sent });
}
