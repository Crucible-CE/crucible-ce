import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAsRead, dismissNotification } from "@/lib/notifications";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// PATCH /api/notifications/[id] — mark a single notification as read
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  const notification = await markAsRead(id, session.user.id);
  if (!notification) {
    return NextResponse.json(
      { error: "Notification not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(notification);
}

// DELETE /api/notifications/[id] — dismiss (soft-delete) a notification
export async function DELETE(req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const notification = await dismissNotification(id, session.user.id);
  if (!notification) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
