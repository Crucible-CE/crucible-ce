// Studio graph for one Strategic TTX or Document TTX template.
//   GET: template settings, nodes and branches, secrets included. Template
//        managers who may read this template's secrets only.
//   PUT: {expectedUpdatedAt, graph {template, injects[], branches[]}} replaces
//        the whole graph. 409 when someone saved in between or when a
//        non-ended exercise uses the template.
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { requirePermission } from "@/lib/exercise/auth/session";
import { parseJsonBody } from "@/lib/http/parse-body";
import { getStudioTemplate, saveStudioGraph } from "@/lib/exercise/studio/service";
import { NO_STORE, studioErrorResponse } from "@/lib/exercise/studio/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const a = await requirePermission("templates.manage");
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await getStudioTemplate(id, a.user), { headers: NO_STORE });
  } catch (e) {
    return studioErrorResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const a = await requirePermission("templates.manage");
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const parsed = await parseJsonBody(req, z.unknown(), { maxBytes: 2 * 1024 * 1024 });
  if (!parsed.ok) return parsed.response;
  try {
    const r = await saveStudioGraph(id, parsed.data, a.user);
    audit({ actorUserId: a.user.id, action: "template.updated", targetType: "ExerciseTemplate", targetId: id, data: { via: "studio" }, req });
    return NextResponse.json({ ok: true, updatedAt: r.updatedAt, issues: r.issues }, { headers: NO_STORE });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
