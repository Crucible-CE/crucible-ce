import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http/parse-body";
import { playbookErrorResponse, playbookGate } from "@/lib/incident/playbooks/http";
import { addStep } from "@/lib/incident/playbooks/service";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

const postSchema = z.object({ section: z.string().trim().min(1).max(120), text: z.string().trim().min(1).max(240) });

// POST /api/incidents/[id]/playbooks/[runId]/steps: add a step to this
// incident's checklist (the document is not changed).
export async function POST(req: Request, context: RouteContext) {
  const { id, runId } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  const parsed = await parseJsonBody(req, postSchema);
  if (!parsed.ok) return parsed.response;
  try {
    const stepId = await addStep({ incidentId: id, runId, section: parsed.data.section, text: parsed.data.text });
    return NextResponse.json({ stepId }, { status: 201 });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}
