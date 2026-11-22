// Copy a Studio template with its injects, branches and rubrics into a local draft.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { duplicateStudioTemplate } from "@/lib/exercise/studio/service";
import { studioErrorResponse } from "@/lib/exercise/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requirePermission("templates.manage");
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  try {
    const copy = await duplicateStudioTemplate(id, a.user);
    audit({ actorUserId: a.user.id, action: "template.duplicated", targetType: "ExerciseTemplate", targetId: copy, data: { sourceId: id }, req });
    return NextResponse.json({ id: copy }, { status: 201 });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
