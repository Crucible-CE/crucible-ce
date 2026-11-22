// GET /api/exercises/{id}/state: projectFor output for a signed-in user.
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
    const principal = await requestPrincipal(req, { allowGuest: false });
    const state = await projectFor(id, principal);
    const me = (state.me ?? null) as { participantId?: string } | null;
    if (me?.participantId) {
      await db.participant.updateMany({ where: { id: me.participantId, joinedAt: null }, data: { joinedAt: new Date() } });
    }
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  });
}
