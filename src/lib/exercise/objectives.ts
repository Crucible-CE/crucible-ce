// Link objectives to delivered injects. An objective is tested by a set of
// template injects: the ones the facilitator picked in the lobby
// (Exercise.plan.objectiveTemplateInjects), else the template injects whose
// objectiveKeys include the objective's template key (Exercise.plan.objectiveKeys).
// Each delivered inject from one of those template injects is added to
// Objective.injectIds. Idempotent; manual links already there stay.

import { db } from "@/lib/db";
import { readPlan, templateInjectsForObjective } from "./schemas";

export async function syncObjectiveInjects(exerciseId: string): Promise<number> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { plan: true, templateId: true } });
  if (!ex?.templateId) return 0;
  const plan = readPlan(ex.plan);
  if (Object.keys(plan.objectiveKeys).length === 0 && Object.keys(plan.objectiveTemplateInjects).length === 0) return 0;

  const injects = await db.inject.findMany({
    where: { exerciseId, status: { in: ["open", "closed"] }, templateInjectId: { not: null } },
    select: { id: true, templateInjectId: true },
  });
  if (injects.length === 0) return 0;
  const tInjects = await db.templateInject.findMany({
    where: { templateId: ex.templateId },
    select: { id: true, objectiveKeys: true },
  });

  const objectives = await db.objective.findMany({ where: { exerciseId }, select: { id: true, injectIds: true } });
  let changed = 0;
  for (const o of objectives) {
    const tIds = new Set(templateInjectsForObjective(plan, o.id, tInjects));
    if (tIds.size === 0) continue;
    const linked = injects.filter((i) => tIds.has(i.templateInjectId!)).map((i) => i.id);
    const next = [...new Set([...o.injectIds, ...linked])];
    if (next.length !== o.injectIds.length) {
      await db.objective.update({ where: { id: o.id }, data: { injectIds: next } });
      changed++;
    }
  }
  return changed;
}
