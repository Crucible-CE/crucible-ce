// Publish a template. Crisis Sim templates must pass every check first;
// Strategic TTX and Document TTX templates go through the Studio publish.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { isStudioMode } from "@/lib/exercise/studio/schema";
import { publishStudioTemplate } from "@/lib/exercise/studio/service";
import { studioErrorResponse } from "@/lib/exercise/studio/http";
import {
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
} from "@/lib/exercise/modes/crisissim/schema";
import { validateTemplate, type TemplateInjectDraft } from "@/lib/exercise/modes/crisissim/validate";
import { NOT_FOUND, loadTemplate, requireTemplateManager } from "../../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const t = await loadTemplate(id);
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (t.injects.length === 0) return NextResponse.json({ error: "Add at least one inject before publishing." }, { status: 409 });

  // Strategic TTX and Document TTX, linear or branched, pass the Studio
  // graph checks (and the Document TTX rubric checks) before publishing.
  if (isStudioMode(t.mode)) {
    try {
      await publishStudioTemplate(id, a.user);
    } catch (e) {
      return studioErrorResponse(e);
    }
    audit({ actorUserId: a.user.id, action: "template.published", targetType: "ExerciseTemplate", targetId: id, req });
    return NextResponse.json({ ok: true });
  }

  if (t.mode === "crisissim") {
    const config = templateConfigSchema.safeParse(t.config);
    const objectives = templateObjectivesSchema.safeParse(t.objectives);
    const injects: TemplateInjectDraft[] = [];
    for (const i of t.injects) {
      const content = templateInjectContentSchema.safeParse(i.content);
      const secret = templateInjectSecretSchema.safeParse(i.secret);
      if (!content.success || !secret.success) break;
      const expectedActions = expectedActionsSchema.safeParse(i.expectedActions);
      injects.push({ ...i, expectedActions: expectedActions.success ? expectedActions.data : [], content: content.data, secret: secret.data });
    }
    if (!config.success || !objectives.success || injects.length !== t.injects.length) {
      return NextResponse.json({ error: "The template has invalid content. Open it in the editor and save it again." }, { status: 409 });
    }
    const issues = validateTemplate({ config: config.data, objectives: objectives.data, injects });
    if (issues.length) return NextResponse.json({ error: "Fix the listed problems before publishing.", issues }, { status: 409 });
  }

  await db.exerciseTemplate.update({
    where: { id },
    data: { status: "published", ...(t.status === "published" ? {} : { version: { increment: 1 } }) },
  });
  audit({ actorUserId: a.user.id, action: "template.published", targetType: "ExerciseTemplate", targetId: id, req });
  return NextResponse.json({ ok: true });
}
