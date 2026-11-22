// Create an empty Strategic TTX or Document TTX draft for the Studio.
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { createStudioTemplate } from "@/lib/exercise/studio/service";
import { studioErrorResponse } from "@/lib/exercise/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ mode: z.string().max(20), title: z.string().max(200), summary: z.string().max(800).optional() });

export async function POST(req: Request) {
  const a = await requirePermission("templates.manage");
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, bodySchema);
  if (!parsed.ok) return parsed.response;
  try {
    const id = await createStudioTemplate(parsed.data.mode, parsed.data.title, a.user, parsed.data.summary);
    audit({ actorUserId: a.user.id, action: "template.created", targetType: "ExerciseTemplate", targetId: id, data: { mode: parsed.data.mode }, req });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
