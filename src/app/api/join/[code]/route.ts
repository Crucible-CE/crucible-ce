// GET /api/join/{code}: public preview for the join page (title, teams to pick).
// Same rate limits as POST /api/join.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { toHttpError } from "@/lib/exercise/errors";
import { previewJoin, RateLimitedError } from "@/lib/exercise/join";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const preview = await previewJoin(req, decodeURIComponent(code).slice(0, 32), await getSessionUser());
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": String(Math.max(1, e.retryAfter)) } });
    }
    return toHttpError(e);
  }
}
