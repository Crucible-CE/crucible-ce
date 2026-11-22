// POST /api/exercises/{id}/control {action, injectId?, edits?, addMinutes?, message?, teamId?}
// Drivers only (lead facilitator, controller, owner, admin).
import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/http/parse-body";
import { actorOf, requestPrincipal, requireAccess } from "@/lib/exercise/access";
import { runControl } from "@/lib/exercise/control";
import { withErrors } from "@/lib/exercise/errors";
import { controlSchema } from "@/lib/exercise/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    const principal = await requestPrincipal(req, { allowGuest: false });
    const { participant } = await requireAccess(id, principal, "driver");
    const parsed = await parseJsonBody(req, controlSchema);
    if (!parsed.ok) return parsed.response;
    const result = await runControl({ exerciseId: id, actor: actorOf(principal, participant), req }, parsed.data);
    return NextResponse.json(result);
  });
}
