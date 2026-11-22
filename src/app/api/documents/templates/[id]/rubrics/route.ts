// GET /api/documents/templates/{id}/rubrics   rubric rows (criteria, model answers)
// PUT /api/documents/templates/{id}/rubrics   {rubrics: [...]} replaces every rubric of the template
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { loadDocumentTemplate, rubricEditSchema, saveDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { requireTemplateManager, templateSecretsGuard } from "../../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const denied = await templateSecretsGuard(a.user.id, id);
    if (denied) return denied;
    const t = await loadDocumentTemplate(id);
    return NextResponse.json({ rubrics: t.rubrics }, { headers: { "Cache-Control": "no-store" } });
  });
}

const putSchema = z.object({ rubrics: z.array(rubricEditSchema).max(120) });

export async function PUT(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const denied = await templateSecretsGuard(a.user.id, id);
    if (denied) return denied;
    const parsed = await parseJsonBody(req, putSchema, { maxBytes: 1024 * 1024 });
    if (!parsed.ok) return parsed.response;
    const { issues } = await saveDocumentTemplate(id, { rubrics: parsed.data.rubrics });
    audit({
      actorUserId: a.user.id,
      action: "template.rubrics_updated",
      targetType: "ExerciseTemplate",
      targetId: id,
      data: { rubrics: parsed.data.rubrics.length },
      req,
    });
    return NextResponse.json({ ok: true, issues });
  });
}
