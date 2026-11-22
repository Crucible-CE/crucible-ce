// Read, edit and delete one template. Includes secret columns, so only
// templates.manage may call it.
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { parseJsonBody } from "@/lib/http/parse-body";
import {
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
} from "@/lib/exercise/modes/crisissim/schema";
import { validateTemplate } from "@/lib/exercise/modes/crisissim/validate";
import {
  NOT_FOUND,
  crisisSimInjectEditSchema,
  crisisSimTemplateBodySchema,
  loadTemplate,
  requireTemplateManager,
  secretsGuard,
  serializeTemplate,
  templateInUse,
} from "../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export async function GET(_req: Request, ctx: Ctx) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const denied = await secretsGuard(a.user.id, id);
  if (denied) return denied;
  const t = await loadTemplate(id);
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });
  const body = serializeTemplate(t);
  const issues =
    t.mode === "crisissim" ? currentIssues(t) : [];
  return NextResponse.json({ ...body, issues }, { headers: { "Cache-Control": "no-store" } });
}

function currentIssues(t: NonNullable<Awaited<ReturnType<typeof loadTemplate>>>) {
  const config = templateConfigSchema.safeParse(t.config);
  const objectives = templateObjectivesSchema.safeParse(t.objectives);
  if (!config.success) return [{ inject: null, message: "Scenario settings are invalid." }];
  const injects = [];
  for (const [i, inj] of t.injects.entries()) {
    const content = templateInjectContentSchema.safeParse(inj.content);
    const secret = templateInjectSecretSchema.safeParse(inj.secret);
    if (!content.success || !secret.success) return [{ inject: i, message: "Inject content is invalid." }];
    const expectedActions = expectedActionsSchema.safeParse(inj.expectedActions);
    injects.push({ ...inj, expectedActions: expectedActions.success ? expectedActions.data : [], content: content.data, secret: secret.data });
  }
  return validateTemplate({ config: config.data, injects, objectives: objectives.success ? objectives.data : [] });
}

const patchSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a title.").max(160).optional(),
    summary: z.string().trim().max(800).nullable().optional(),
    config: z.unknown().optional(),
    objectives: z.unknown().optional(),
    injects: z.array(z.unknown()).max(30).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change.");

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const parsed = await parseJsonBody(req, patchSchema, { maxBytes: 2 * 1024 * 1024 });
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const t = await loadTemplate(id);
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });

  const structural = body.config !== undefined || body.objectives !== undefined || body.injects !== undefined;
  if (structural && t.mode !== "crisissim") {
    return NextResponse.json({ error: "Only the title and summary can be edited for this mode." }, { status: 400 });
  }
  if (structural && (await templateInUse(id))) {
    return NextResponse.json({ error: "An exercise using this template has not ended. Duplicate the template to make changes." }, { status: 409 });
  }

  if (!structural) {
    await db.exerciseTemplate.update({
      where: { id },
      data: { ...(body.title !== undefined ? { title: body.title } : {}), ...(body.summary !== undefined ? { summary: body.summary } : {}) },
    });
    audit({ actorUserId: a.user.id, action: "template.updated", targetType: "ExerciseTemplate", targetId: id, req });
    return NextResponse.json({ ok: true, issues: [] });
  }

  // Merge with what is stored, then validate the whole template.
  const merged = crisisSimTemplateBodySchema.safeParse({
    title: body.title ?? t.title,
    summary: body.summary !== undefined ? body.summary : t.summary,
    config: body.config ?? stripGeneration(t.config),
    objectives: body.objectives ?? t.objectives,
    injects:
      body.injects ??
      t.injects.map((i) => ({
        id: i.id,
        nodeId: i.nodeId,
        title: i.title,
        scenarioOffsetMin: i.scenarioOffsetMin,
        plannedDelayMin: i.plannedDelayMin,
        targetTeams: i.targetTeams,
        objectiveKeys: i.objectiveKeys,
        expectedActions: i.expectedActions,
        content: i.content,
        secret: i.secret,
      })),
  });
  if (!merged.success) return NextResponse.json({ error: "Invalid input", details: merged.error.flatten() }, { status: 400 });
  const next = merged.data;
  const issues = validateTemplate({ config: next.config, injects: next.injects, objectives: next.objectives });

  const existing = new Map(t.injects.map((i) => [i.id, i]));
  let maxNode = Math.max(0, ...t.injects.map((i) => Number(/^n(\d+)$/.exec(i.nodeId)?.[1] ?? 0)));
  const keep: Array<z.infer<typeof crisisSimInjectEditSchema> & { nodeId: string; existingId: string | null }> = next.injects.map((inj) => {
    const prior = inj.id ? existing.get(inj.id) : undefined;
    return { ...inj, existingId: prior?.id ?? null, nodeId: prior?.nodeId ?? `n${++maxNode}` };
  });
  const keepIds = new Set(keep.map((k) => k.existingId).filter((x): x is string => Boolean(x)));

  await db.$transaction(async (tx) => {
    await tx.exerciseTemplate.update({
      where: { id },
      data: {
        title: next.title,
        summary: next.summary ?? null,
        config: json(next.config),
        objectives: json(next.objectives),
      },
    });
    await tx.templateInject.deleteMany({ where: { templateId: id, id: { notIn: [...keepIds] } } });
    // Free seq values first so reordering never collides.
    await tx.templateInject.updateMany({ where: { templateId: id }, data: { seq: { increment: 1000 } } });
    for (const [i, inj] of keep.entries()) {
      const data = {
        seq: i + 1,
        title: inj.title,
        scenarioOffsetMin: inj.scenarioOffsetMin,
        plannedDelayMin: inj.plannedDelayMin,
        targetTeams: inj.targetTeams,
        objectiveKeys: inj.objectiveKeys,
        expectedActions: json(inj.expectedActions),
        content: json(inj.content),
        secret: json(inj.secret),
        position: json({ x: 0, y: i * 160 }),
      };
      if (inj.existingId) await tx.templateInject.update({ where: { id: inj.existingId }, data });
      else await tx.templateInject.create({ data: { ...data, templateId: id, nodeId: inj.nodeId } });
    }
  });
  audit({ actorUserId: a.user.id, action: "template.updated", targetType: "ExerciseTemplate", targetId: id, data: { injects: keep.length }, req });
  return NextResponse.json({ ok: true, issues });
}

function stripGeneration(config: unknown) {
  const { generation: _g, ...rest } = (config ?? {}) as Record<string, unknown>;
  return rest;
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  const t = await db.exerciseTemplate.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });
  const used = await db.exercise.count({ where: { templateId: id } });
  if (used > 0) return NextResponse.json({ error: "Exercises use this template. Archive it instead." }, { status: 409 });
  await db.exerciseTemplate.delete({ where: { id } });
  audit({ actorUserId: a.user.id, action: "template.deleted", targetType: "ExerciseTemplate", targetId: id, data: { title: t.title }, req });
  return NextResponse.json({ ok: true });
}
