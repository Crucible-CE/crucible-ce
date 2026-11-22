// POST /api/documents/templates/{id}/archive   {archived?: boolean}. True by default; false restores it as a draft.
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { withErrors } from "@/lib/exercise/errors";
import { setArchived } from "@/lib/exercise/templates/document-edit";
import { requireTemplateManager } from "../../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ archived: z.boolean().default(true) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const parsed = await parseJsonBody(req, bodySchema);
    if (!parsed.ok) return parsed.response;
    const status = await setArchived(id, parsed.data.archived);
    audit({
      actorUserId: a.user.id,
      action: parsed.data.archived ? "template.archived" : "template.restored",
      targetType: "ExerciseTemplate",
      targetId: id,
      req,
    });
    return NextResponse.json({ ok: true, status });
  });
}
