// GET    /api/documents/templates/{id}   editor data, including secret content (templates.manage)
// PATCH  /api/documents/templates/{id}   {title?, summary?, objectives?, teams?, moduleMinutes?, paced?, modules?, rubrics?}
// DELETE /api/documents/templates/{id}   only when no exercise uses it
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { deleteDocumentTemplate, loadDocumentTemplate, saveDocumentTemplate, templateEditSchema } from "@/lib/exercise/templates/document-edit";
import { requireTemplateManager, templateSecretsGuard } from "../../_lib/guards";

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
    return NextResponse.json(await loadDocumentTemplate(id), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const denied = await templateSecretsGuard(a.user.id, id);
    if (denied) return denied;
    const parsed = await parseJsonBody(req, templateEditSchema, { maxBytes: 2 * 1024 * 1024 });
    if (!parsed.ok) return parsed.response;
    const { issues } = await saveDocumentTemplate(id, parsed.data);
    audit({
      actorUserId: a.user.id,
      action: "template.updated",
      targetType: "ExerciseTemplate",
      targetId: id,
      data: { mode: "document", modules: parsed.data.modules?.length ?? null, rubrics: parsed.data.rubrics?.length ?? null },
      req,
    });
    return NextResponse.json({ ok: true, issues });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const title = await deleteDocumentTemplate(id);
    audit({ actorUserId: a.user.id, action: "template.deleted", targetType: "ExerciseTemplate", targetId: id, data: { title }, req });
    return NextResponse.json({ ok: true });
  });
}
