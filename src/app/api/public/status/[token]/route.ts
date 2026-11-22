import { NextResponse } from "next/server";
import { publicStatusView, resolveStatusPageToken } from "@/lib/incident/status-page";
import { checkRateLimit, ipFromRequest } from "@/lib/security/rate-limit";

// GET /api/public/status/[token]: the public status page as JSON. The token
// is the only auth; anything not live is a plain 404. Short public cache: a
// status page is public by design, and a retraction shows within a minute.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const rl = await checkRateLimit({ namespace: "status-page:read", identifier: ipFromRequest(req), windowMs: 60_000, max: 120 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const { token } = await params;
  const page = await resolveStatusPageToken(token);
  if (!page) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const view = await publicStatusView(page);
  return NextResponse.json(
    {
      title: view.title,
      orgName: view.orgName,
      status: view.status,
      updatedAt: view.updatedAt,
      updates: view.updates.map((u) => ({ headline: u.headline, body: u.body, postedAt: u.publishedToPageAt, editedAt: u.editedAt })),
    },
    { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=30", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } },
  );
}
