// Import a template from a portable JSON file (src/templates/portable.ts), any
// mode. Always creates a new local draft. Response: {id, mode, href, issues, warnings};
// href is where the new template opens (the Studio for graph templates).
import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { importTemplate } from "@/lib/exercise/templates/portable";
import { studioErrorResponse } from "@/lib/exercise/studio/http";
import { db } from "@/lib/db";
import { templateHref } from "@/components/templates/labels";
import { requireTemplateManager } from "../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const parsed = await parseJsonBody(req, z.unknown(), { maxBytes: 2 * 1024 * 1024 });
  if (!parsed.ok) {
    if (parsed.response.status === 400) {
      return NextResponse.json({ error: "This is not a template export file." }, { status: 400 });
    }
    return parsed.response;
  }
  try {
    const r = await importTemplate(parsed.data, a.user.id);
    audit({ actorUserId: a.user.id, action: "template.imported", targetType: "ExerciseTemplate", targetId: r.id, data: { mode: r.mode }, req });
    const t = await db.exerciseTemplate.findUnique({ where: { id: r.id }, select: { id: true, mode: true, branching: true, status: true } });
    const href = templateHref(t ?? { id: r.id, mode: r.mode });
    return NextResponse.json({ id: r.id, mode: r.mode, href, issues: r.issues, warnings: r.warnings }, { status: 201 });
  } catch (e) {
    return studioErrorResponse(e);
  }
}
