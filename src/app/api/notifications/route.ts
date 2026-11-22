import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserNotifications } from "@/lib/notifications";

// GET /api/notifications — paginated list for the authenticated user
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const limit = Math.min(
    Math.max(parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1),
    100
  );
  const offset = Math.max(
    parseInt(searchParams.get("offset") ?? "0", 10) || 0,
    0
  );

  const result = await getUserNotifications(session.user.id, {
    unreadOnly,
    limit,
    offset,
  });

  return NextResponse.json(result);
}
