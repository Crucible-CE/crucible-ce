// GET  /api/play/{id}/chat   messages this viewer may read
// POST /api/play/{id}/chat   {body, channel, teamId?}
// Participants (users or guests). Control reads every team channel.
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { checkRateLimit, tooManyRequests } from "@/lib/exercise/rate-limit";
import { requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { listChat, postChat } from "@/lib/exercise/chat";
import { withErrors } from "@/lib/exercise/errors";
import { notifyChat } from "@/lib/exercise/notify";
import { chatPostSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { viewer } = await requireAccess(id, principal, "any");
    return NextResponse.json({ messages: await listChat(id, viewer) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const { participant, viewer } = await requireAccess(id, principal, "participant");
    const limit = await checkRateLimit({ namespace: "chat:participant", identifier: participant!.id, windowMs: 60_000, max: 30 });
    if (!limit.allowed) {
      const r = tooManyRequests(limit.retryAfter);
      return NextResponse.json(r.body, r.init);
    }
    const parsed = await parseJsonBody(req, chatPostSchema);
    if (!parsed.ok) return parsed.response;
    const posted = await postChat(id, viewer, participant!, parsed.data);
    // Control sockets sit in every team room, so a team notice reaches them too.
    notifyChat(id, posted.scope, parsed.data.channel);
    return NextResponse.json({ id: posted.id }, { status: 201 });
  });
}
