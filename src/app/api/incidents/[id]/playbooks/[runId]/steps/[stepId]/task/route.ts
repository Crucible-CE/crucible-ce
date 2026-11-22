import { NextResponse } from "next/server";
import { playbookErrorResponse, playbookGate } from "@/lib/incident/playbooks/http";
import { stepToTask } from "@/lib/incident/playbooks/service";

interface RouteContext {
  params: Promise<{ id: string; runId: string; stepId: string }>;
}

// POST: make an incident task from this step (once per step).
export async function POST(_req: Request, context: RouteContext) {
  const { id, runId, stepId } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  try {
    const taskId = await stepToTask({ incidentId: id, runId, stepId, actor: g.gate.actor });
    return NextResponse.json({ taskId }, { status: 201 });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}
