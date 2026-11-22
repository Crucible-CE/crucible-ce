// Copy a template with its injects, branches and rubrics into a new local draft.
// Strategic TTX and Document TTX templates go through the Studio duplicate so
// every route copies the graph the same way.
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/exercise/audit";
import { isStudioMode } from "@/lib/exercise/studio/schema";
import { duplicateStudioTemplate } from "@/lib/exercise/studio/service";
import { studioErrorResponse } from "@/lib/exercise/studio/http";
import { NOT_FOUND, requireTemplateManager, secretsGuard } from "../../_lib/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireTemplateManager();
  if (!a.ok) return a.response;
  const { id } = await ctx.params;
  // A copy carries the hidden scoring, so the same rule as reading it applies.
  const denied = await secretsGuard(a.user.id, id);
  if (denied) return denied;
  const t = await db.exerciseTemplate.findUnique({
    where: { id },
    include: { injects: { orderBy: { seq: "asc" } }, branches: true, rubrics: true },
  });
  if (!t) return NextResponse.json(NOT_FOUND, { status: 404 });

  let copyId: string;
  if (isStudioMode(t.mode)) {
    try {
      copyId = await duplicateStudioTemplate(id, a.user);
    } catch (e) {
      return studioErrorResponse(e);
    }
  } else {
    // Node ids are unique per template, so the copy keeps them and the
    // branches still point at the same nodes. Rubrics key on question keys.
    copyId = await db.$transaction(async (tx) => {
      const created = await tx.exerciseTemplate.create({
        data: {
          mode: t.mode,
          title: `${t.title} (copy)`.slice(0, 160),
          summary: t.summary,
          scope: "local",
          status: "draft",
          config: json(t.config),
          objectives: json(t.objectives),
          branching: t.branching,
          sourceId: t.id,
          createdById: a.user.id,
        },
        select: { id: true },
      });
      if (t.injects.length) {
        await tx.templateInject.createMany({
          data: t.injects.map((i) => ({
            templateId: created.id,
            nodeId: i.nodeId,
            seq: i.seq,
            title: i.title,
            scenarioOffsetMin: i.scenarioOffsetMin,
            plannedDelayMin: i.plannedDelayMin,
            targetTeams: i.targetTeams,
            expectedActions: json(i.expectedActions),
            objectiveKeys: i.objectiveKeys,
            content: json(i.content),
            secret: json(i.secret),
            position: json(i.position),
          })),
        });
      }
      if (t.branches.length) {
        await tx.templateBranch.createMany({
          data: t.branches.map((b) => ({
            templateId: created.id,
            fromNodeId: b.fromNodeId,
            toNodeId: b.toNodeId,
            condition: json(b.condition),
            priority: b.priority,
          })),
        });
      }
      if (t.rubrics.length) {
        await tx.rubric.createMany({
          data: t.rubrics.map((r) => ({
            templateId: created.id,
            questionKey: r.questionKey,
            criteria: json(r.criteria),
            modelAnswer: r.modelAnswer,
            maxScore: r.maxScore,
            capabilityKey: r.capabilityKey,
          })),
        });
      }
      return created.id;
    });
  }
  audit({ actorUserId: a.user.id, action: "template.duplicated", targetType: "ExerciseTemplate", targetId: copyId, data: { sourceId: id }, req });
  return NextResponse.json({ id: copyId }, { status: 201 });
}
