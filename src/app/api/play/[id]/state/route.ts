// GET /api/play/{id}/state: projectFor output for a player (signed-in user or guest).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projectFor } from "@/lib/exercise/runtime/view";
import { requestPrincipal } from "@/lib/exercise/access";
import { withErrors } from "@/lib/exercise/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: true });
    const state = await projectFor(id, principal);
    const me = (state.me ?? null) as { participantId?: string } | null;
    if (me?.participantId) {
      await db.participant.updateMany({ where: { id: me.participantId, joinedAt: null }, data: { joinedAt: new Date() } });
    }
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  });
}
