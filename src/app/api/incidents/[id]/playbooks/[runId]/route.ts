import { NextResponse } from "next/server";
import { playbookErrorResponse, playbookGate } from "@/lib/incident/playbooks/http";
import { removeRun } from "@/lib/incident/playbooks/service";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

// DELETE /api/incidents/[id]/playbooks/[runId]: remove a playbook from the
// incident. The ledger keeps the attach, the check-offs and the removal.
export async function DELETE(_req: Request, context: RouteContext) {
  const { id, runId } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  try {
    await removeRun({ incidentId: id, runId, actor: g.gate.actor });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}
