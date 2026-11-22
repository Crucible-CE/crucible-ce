// GET    /api/schedule/feed   signed-in users: {enabled}
// POST   /api/schedule/feed   facilitator, admin: make a new feed link. Shown once; the old link stops working.
// DELETE /api/schedule/feed   facilitator, admin: turn the feed off
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission, requireUser } from "@/lib/exercise/auth/session";
import { withErrors } from "@/lib/exercise/errors";
import { disableFeed, feedEnabled, rotateFeedToken } from "@/lib/exercise/schedule/feed-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const a = await requireUser();
  if (!a.ok) return a.response;
  return withErrors(async () => NextResponse.json({ enabled: await feedEnabled() }, { headers: NO_STORE }));
}

export async function POST(req: Request) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    const token = await rotateFeedToken();
    if (!token) return NextResponse.json({ error: "Setup has not run." }, { status: 404 });
    // The token itself is never audited or logged.
    audit({ actorUserId: a.user.id, action: "schedule.feed_rotated", targetType: "ExerciseSettings", req });
    return NextResponse.json({ path: `/api/public/ics/exercises?token=${encodeURIComponent(token)}` }, { headers: NO_STORE });
  });
}

export async function DELETE(req: Request) {
  const a = await requirePermission("exercises.create");
  if (!a.ok) return a.response;
  return withErrors(async () => {
    await disableFeed();
    audit({ actorUserId: a.user.id, action: "schedule.feed_disabled", targetType: "ExerciseSettings", req });
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  });
}
