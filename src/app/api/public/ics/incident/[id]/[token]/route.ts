import { NextResponse } from "next/server";
import { verifyIcsToken } from "@/lib/ics/token";
import { buildIncidentIcs } from "@/lib/ics/incident-feed";
import { ICS_CONTENT_TYPE } from "@/lib/ics/ics";
import { fileResponse } from "@/lib/http/file-response";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getClientIp } from "@/lib/security/client-ip";

interface RouteContext {
  params: Promise<{ id: string; token: string }>;
}

// GET /api/public/ics/incident/[id]/[token] — The standing calendar
// subscription feed calendar apps poll. The token is a stored, revocable
// per-user secret (src/lib/ics/token.ts): honoured only while its owner is
// active and can still see the incident. Responses are uniform 404s on any
// failure so the route leaks nothing about incident existence.
export async function GET(req: Request, context: RouteContext) {
  const ip = getClientIp(req) ?? "unknown";
  const rl = await checkRateLimit({
    namespace: "ics-feed:ip",
    identifier: ip,
    windowMs: 60_000,
    max: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id, token } = await context.params;
  if (!(await verifyIcsToken(id, token))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ics = await buildIncidentIcs(id);
  if (!ics) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return fileResponse(ics, {
    filename: `incident-${id}.ics`,
    contentType: ICS_CONTENT_TYPE,
    trustedContentType: true,
    // Calendar apps poll; a short private cache keeps the DB out of the
    // refresh path without making the feed feel stale.
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
