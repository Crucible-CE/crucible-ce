// POST /api/documents/{id}/duplicate   copy into the organization's own documents (documents.manage).
//                                      Library documents are read only; this is how they are edited.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { withErrors } from "@/lib/exercise/errors";
import { duplicateDocument } from "@/lib/exercise/documents/documents";
import { hourlyLimit, requireDocumentManager } from "../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  return withErrors(async () => {
    const a = await requireDocumentManager();
    if (!a.ok) return a.response;
    const limited = await hourlyLimit(a.user.id, "documents:create", 60);
    if (limited) return limited;
    const { id } = await ctx.params;
    const copy = await duplicateDocument(id, a.user.id);
    audit({ actorUserId: a.user.id, action: "document.duplicated", targetType: "SourceDocument", targetId: copy.id, data: { sourceId: id, title: copy.title }, req });
    return NextResponse.json({ id: copy.id }, { status: 201 });
  });
}
