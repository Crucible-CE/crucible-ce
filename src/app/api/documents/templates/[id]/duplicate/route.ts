// POST /api/documents/templates/{id}/duplicate   -> {id} of the new draft (modules, branches and rubrics copied)
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { withErrors } from "@/lib/exercise/errors";
import { duplicateDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { requireTemplateManager } from "../../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const copyId = await duplicateDocumentTemplate(id, a.user.id);
    audit({ actorUserId: a.user.id, action: "template.duplicated", targetType: "ExerciseTemplate", targetId: copyId, data: { from: id }, req });
    return NextResponse.json({ id: copyId }, { status: 201 });
  });
}
