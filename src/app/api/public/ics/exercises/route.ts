// GET /api/public/ics/exercises?token=...   public: the private schedule subscription feed.
// The token is a random secret; only its sha256 is stored (ExerciseSettings.policy).
// Rate limited per IP. A wrong or missing token gets 404 with no detail.
import { NextResponse } from "next/server";
import { fileResponse } from "@/lib/http/file-response";
import { ICS_CONTENT_TYPE } from "@/lib/exercise/schedule/ics";
import { feedIcs } from "@/lib/exercise/schedule/service";
import { feedTokenHashOf, feedTokenMatches } from "@/lib/exercise/schedule/feed-token";
import { checkRateLimit, ipFromRequest, tooManyRequests } from "@/lib/exercise/rate-limit";
import { getExerciseSettings } from "@/lib/exercise/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const limit = await checkRateLimit({ namespace: "ics-feed:ip", identifier: ipFromRequest(req), windowMs: 60 * 60_000, max: 120 });
  if (!limit.allowed) {
    const r = tooManyRequests(limit.retryAfter);
    return NextResponse.json(r.body, r.init);
  }
  const token = new URL(req.url).searchParams.get("token");
  const instance = await getExerciseSettings();
  if (!feedTokenMatches(token, feedTokenHashOf(instance?.policy))) return notFound();
  try {
    const ics = await feedIcs();
    return fileResponse(ics, { filename: "exercises.ics", contentType: ICS_CONTENT_TYPE, trustedContentType: true });
  } catch (err) {
    console.error("[ics] feed failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "The calendar could not be built. Try again later." }, { status: 500 });
  }
}
