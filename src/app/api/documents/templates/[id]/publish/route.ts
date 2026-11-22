// POST /api/documents/templates/{id}/publish   every check must pass
// A branched template also passes the Studio graph checks. Issues come back
// as {module, message} for the Document TTX editor either way.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { db } from "@/lib/db";
import { ServiceError, withErrors } from "@/lib/exercise/errors";
import { publishDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { StudioError, publishStudioTemplate } from "@/lib/exercise/studio/service";
import { requireTemplateManager, TEMPLATE_NOT_FOUND } from "../../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withErrors(async () => {
    const a = await requireTemplateManager();
    if (!a.ok) return a.response;
    const { id } = await ctx.params;
    const t = await db.exerciseTemplate.findUnique({
      where: { id },
      select: { mode: true, branching: true, injects: { orderBy: { seq: "asc" }, select: { nodeId: true } } },
    });
    if (!t) return NextResponse.json(TEMPLATE_NOT_FOUND, { status: 404 });
    try {
      if (t.mode === "document" && t.branching === "branched") await publishStudioTemplate(id, a.user);
      else await publishDocumentTemplate(id);
    } catch (e) {
      if (e instanceof StudioError) {
        const order = t.injects.map((i) => i.nodeId);
        const issues = e.issues.map((x) => {
          const at = x.nodeId ? order.indexOf(x.nodeId) : -1;
          return { module: at >= 0 ? at : null, message: x.message };
        });
        return NextResponse.json({ error: e.message, issues }, { status: e.status });
      }
      const issues = (e as { issues?: unknown }).issues;
      if (e instanceof ServiceError && issues) return NextResponse.json({ error: e.message, issues }, { status: e.status });
      throw e;
    }
    audit({ actorUserId: a.user.id, action: "template.published", targetType: "ExerciseTemplate", targetId: id, data: { mode: "document" }, req });
    return NextResponse.json({ ok: true });
  });
}
