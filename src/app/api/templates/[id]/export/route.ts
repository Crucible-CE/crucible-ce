// Export a template as portable JSON (src/templates/portable.ts), any mode.
// The file includes hidden scoring and expected actions, so only template
// managers who may read this template's secrets may export.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { exportTemplateFor, portableFileName } from "@/lib/exercise/templates/portable";
import { studioErrorResponse } from "@/lib/exercise/studio/http";
import { requireTemplateManager } from "../../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  try {
    const file = await exportTemplateFor(a.user, id);
    audit({ actorUserId: a.user.id, action: "template.exported", targetType: "ExerciseTemplate", targetId: id, data: { mode: file.mode }, req });
    return new NextResponse(JSON.stringify(file, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${portableFileName(file.template.title)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
