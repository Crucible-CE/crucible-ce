// GET /api/exercises/{id}/feedback   control: participant feedback summary (no names)
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/exercise/errors";
import { userAccess } from "@/lib/exercise/hotwash/access";
import { FEEDBACK_SCALES, feedbackSummary } from "@/lib/exercise/hotwash/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const { id } = await params;
    await userAccess(id, "control");
    const summary = await feedbackSummary(id);
    return NextResponse.json({ summary, scales: FEEDBACK_SCALES }, { headers: { "Cache-Control": "no-store" } });
  });
}
