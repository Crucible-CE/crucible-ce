import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/http/parse-body";
import { playbookErrorResponse, playbookGate } from "@/lib/incident/playbooks/http";
import { deleteStep, editStep, setStepDone } from "@/lib/incident/playbooks/service";

interface RouteContext {
  params: Promise<{ id: string; runId: string; stepId: string }>;
}

const patchSchema = z
  .object({
    done: z.boolean().optional(),
    text: z.string().trim().min(1).max(240).optional(),
    detail: z.string().trim().max(2000).nullable().optional(),
    move: z.enum(["up", "down"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

// PATCH: check a step off or reopen it, edit its text, or move it.
export async function PATCH(req: Request, context: RouteContext) {
  const { id, runId, stepId } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  const parsed = await parseJsonBody(req, patchSchema);
  if (!parsed.ok) return parsed.response;
  const { done, ...edit } = parsed.data;
  try {
    if (done !== undefined) await setStepDone({ incidentId: id, runId, stepId, done, actor: g.gate.actor });
    if (edit.text !== undefined || edit.detail !== undefined || edit.move) {
      await editStep({ incidentId: id, runId, stepId, text: edit.text, detail: edit.detail === "" ? null : edit.detail, move: edit.move });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}

// DELETE: remove a step from this incident's checklist.
export async function DELETE(_req: Request, context: RouteContext) {
  const { id, runId, stepId } = await context.params;
  const g = await playbookGate(id, "write");
  if (!g.ok) return g.response;
  try {
    await deleteStep({ incidentId: id, runId, stepId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return playbookErrorResponse(e);
  }
}
