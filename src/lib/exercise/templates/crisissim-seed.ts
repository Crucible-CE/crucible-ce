// Seeds the Crisis Sim library: the solo practice sim and two starter
// templates. Idempotent: templates upsert by stable id and their injects are
// rebuilt from the data file on every run.

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  expectedActionsSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateObjectivesSchema,
} from "@/lib/exercise/modes/crisissim/schema";
import { formatIssues, validateTemplate } from "@/lib/exercise/modes/crisissim/validate";
import { CRISISSIM_SEED_TEMPLATES, type SeedTemplate } from "./crisissim-seed-data";

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Parse and check one seed template. Throws when the data drifts out of spec. */
export function parseSeedTemplate(t: SeedTemplate) {
  const config = templateConfigSchema.parse(t.config);
  const objectives = templateObjectivesSchema.parse(t.objectives);
  const injects = t.injects.map((inj, i) => ({
    nodeId: `n${i + 1}`,
    seq: i + 1,
    title: inj.title,
    scenarioOffsetMin: inj.scenarioOffsetMin,
    plannedDelayMin: inj.plannedDelayMin,
    targetTeams: inj.targetTeams,
    objectiveKeys: inj.objectiveKeys,
    expectedActions: expectedActionsSchema.parse(inj.expectedActions),
    content: templateInjectContentSchema.parse(inj.content),
    secret: templateInjectSecretSchema.parse(inj.secret),
    position: { x: 0, y: i * 160 },
  }));
  const issues = validateTemplate({ config, injects, objectives });
  if (issues.length) throw new Error(`Seed template ${t.id} is invalid. ${formatIssues(issues)}`);
  return { config, objectives, injects };
}

export async function seedCrisisSimTemplates(db: PrismaClient, templates: readonly SeedTemplate[] = CRISISSIM_SEED_TEMPLATES): Promise<void> {
  for (const t of templates) {
    const { config, objectives, injects } = parseSeedTemplate(t);
    await db.$transaction(async (tx) => {
      const data = {
        mode: "crisissim",
        title: t.title,
        summary: t.summary,
        scope: "library",
        collection: t.collection ?? null,
        status: "published",
        config: json(config),
        objectives: json(objectives),
        branching: "linear",
      };
      await tx.exerciseTemplate.upsert({ where: { id: t.id }, create: { id: t.id, ...data }, update: data });
      await tx.templateInject.deleteMany({ where: { templateId: t.id } });
      await tx.templateInject.createMany({
        data: injects.map((inj) => ({
          templateId: t.id,
          nodeId: inj.nodeId,
          seq: inj.seq,
          title: inj.title,
          scenarioOffsetMin: inj.scenarioOffsetMin,
          plannedDelayMin: inj.plannedDelayMin,
          targetTeams: inj.targetTeams,
          objectiveKeys: inj.objectiveKeys,
          expectedActions: json(inj.expectedActions),
          content: json(inj.content),
          secret: json(inj.secret),
          position: json(inj.position),
        })),
      });
    });
  }
  console.log(`[seed] Crisis Sim templates: ${templates.length}`);
}
