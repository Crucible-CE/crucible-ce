// POST /api/documents/{id}/templates   {title, objectives, teams, moduleMinutes, paced, start} -> {templateId}
// Creates a draft Playbook Exercise template from the document. The author
// writes the modules in the editor.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { db } from "@/lib/db";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { createDocumentTemplate, createDocumentTemplateSchema } from "@/lib/exercise/templates/document";
import { DOC_NOT_FOUND, hourlyLimit, requireTemplateManager } from "../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const limited = await hourlyLimit(a.user.id, "document-template:create", 60);
    if (limited) return limited;
    const parsed = await parseJsonBody(req, createDocumentTemplateSchema, { maxBytes: 64 * 1024 });
    if (!parsed.ok) return parsed.response;
    const doc = await db.sourceDocument.findUnique({ where: { id }, select: { id: true } });
    if (!doc) return NextResponse.json(DOC_NOT_FOUND, { status: 404 });
    const templateId = await createDocumentTemplate(id, parsed.data, a.user.id);
    audit({
      actorUserId: a.user.id,
      action: "template.created",
      targetType: "ExerciseTemplate",
      targetId: templateId,
      data: { mode: "document", documentId: id, start: parsed.data.start },
      req,
    });
    return NextResponse.json({ templateId }, { status: 201 });
  });
}
