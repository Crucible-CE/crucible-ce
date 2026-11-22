// GET    /api/documents/{id}    text, sections, usage (any signed-in user)
// PATCH  /api/documents/{id}    {title?, kind?} (documents.manage)
// DELETE /api/documents/{id}    blocked while an exercise that has not ended uses it (documents.manage)
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import {
  deleteDocument,
  exercisesUsingDocument,
  getDocument,
  templatesFromDocument,
  updateDocument,
  updateDocumentSchema,
} from "@/lib/exercise/documents/documents";
import { DOC_NOT_FOUND, requireDocumentManager, requireDocumentReader } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const a = await requireDocumentReader();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const doc = await getDocument(id);
  if (!doc) return NextResponse.json(DOC_NOT_FOUND, { status: 404 });
  const [exercises, templates] = await Promise.all([exercisesUsingDocument(id), templatesFromDocument(id)]);
  return NextResponse.json({ document: doc, usage: { exercises, templates } }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireDocumentManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const parsed = await parseJsonBody(req, updateDocumentSchema);
    if (!parsed.ok) return parsed.response;
    await updateDocument(id, parsed.data);
    audit({ actorUserId: a.user.id, action: "document.updated", targetType: "SourceDocument", targetId: id, data: parsed.data, req });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireDocumentManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const { title } = await deleteDocument(id);
    audit({ actorUserId: a.user.id, action: "document.deleted", targetType: "SourceDocument", targetId: id, data: { title }, req });
    return NextResponse.json({ ok: true });
  });
}
