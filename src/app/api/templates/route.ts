// GET  /api/templates   template list for every mode. Used by the templates
//                        page and the new-exercise picker. Never includes
//                        inject content or secret columns.
// POST /api/templates   {mode: "crisissim", title} -> {id}. A blank Crisis Sim
//                        draft for the editor.
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import { templateConfigSchema } from "@/lib/exercise/modes/crisissim/schema";
import { MODES } from "@/lib/exercise/runtime/types";
import { ensureExerciseLibrary } from "@/lib/exercise/library";
import { TEMPLATE_STATUSES, hourlyRateLimit, requireTemplateManager, requireTemplateReader } from "./_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireTemplateReader();
  if (!a.ok) return a.response;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const statusParam = url.searchParams.get("status");
  const statuses = statusParam
    ? statusParam.split(",").filter((s): s is (typeof TEMPLATE_STATUSES)[number] => (TEMPLATE_STATUSES as readonly string[]).includes(s))
    : null;
  if (mode && !(MODES as readonly string[]).includes(mode)) {
    return NextResponse.json({ error: "Unknown mode." }, { status: 400 });
  }

  await ensureExerciseLibrary();
  const rows = await db.exerciseTemplate.findMany({
    where: {
      ...(mode ? { mode } : {}),
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      mode: true,
      title: true,
      summary: true,
      status: true,
      scope: true,
      collection: true,
      branching: true,
      config: true,
      updatedAt: true,
      _count: { select: { injects: true } },
    },
  });

  return NextResponse.json({
    templates: rows.map((t) => {
      const cfg = (t.config ?? {}) as { teams?: unknown; targetDurationMin?: unknown; practice?: unknown };
      return {
        id: t.id,
        mode: t.mode,
        title: t.title,
        summary: t.summary,
        status: t.status,
        scope: t.scope,
        collection: t.collection,
        branching: t.branching,
        updatedAt: t.updatedAt,
        injectCount: t._count.injects,
        teams: Array.isArray(cfg.teams) ? cfg.teams.filter((x): x is string => typeof x === "string") : [],
        targetDurationMin: typeof cfg.targetDurationMin === "number" ? cfg.targetDurationMin : null,
        practice: cfg.practice === true,
      };
    }),
  });
}

const createSchema = z.object({
  mode: z.literal("crisissim"),
  title: z.string().trim().min(3, "Enter a title.").max(160),
  summary: z.string().trim().max(800).optional(),
});

export async function POST(req: Request) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const limited = await hourlyRateLimit(a.user.id, "template:create", 60);
  if (limited) return limited;
  const parsed = await parseJsonBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const config = templateConfigSchema.parse({ teams: ["Executive team"], targetDurationMin: 60 });
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "crisissim",
      title: parsed.data.title,
      summary: parsed.data.summary || null,
      scope: "local",
      status: "draft",
      config,
      objectives: [],
      branching: "linear",
      createdById: a.user.id,
    },
    select: { id: true },
  });
  audit({ actorUserId: a.user.id, action: "template.created", targetType: "ExerciseTemplate", targetId: t.id, data: { mode: "crisissim" }, req });
  return NextResponse.json({ id: t.id }, { status: 201 });
}
