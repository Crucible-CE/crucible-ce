// Publish a Studio template. Errors and warnings must be fixed first.
import { NextResponse } from "next/server";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { publishStudioTemplate } from "@/lib/exercise/studio/service";
import { studioErrorResponse } from "@/lib/exercise/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requirePermission("templates.manage");
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  try {
    await publishStudioTemplate(id, a.user);
    audit({ actorUserId: a.user.id, action: "template.published", targetType: "ExerciseTemplate", targetId: id, req });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
