import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markAllAsRead } from "@/lib/notifications";

// POST /api/notifications/mark-all-read — mark all notifications as read
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await markAllAsRead(session.user.id);

  return NextResponse.json({ count });
}
