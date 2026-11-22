// Seeds the Strategic TTX library: two published templates. Idempotent:
// templates upsert by stable id and their injects and branches are rebuilt
// from seed-data.ts on every run.

import type { Prisma, PrismaClient } from "@prisma/client";
import { branchConditionSchema } from "@/lib/exercise/modes/shared/branching";
import {
  injectSecretSchema,
  templateConfigSchema,
  templateInjectContentSchema,
  templateObjectivesSchema,
} from "@/lib/exercise/modes/strategic/schema";
import { STRATEGIC_SEED_TEMPLATES, type StrategicSeedTemplate } from "./seed-data";

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Parse and check one seed template. Throws when the data drifts out of spec. */
export function parseStrategicSeed(t: StrategicSeedTemplate) {
  const config = templateConfigSchema.parse(t.config);
  const objectives = templateObjectivesSchema.parse(t.objectives);
  const objectiveKeys = new Set(objectives.map((o) => o.key));
  const teams = new Set(config.teams);
  const nodeIds = new Set<string>();

  const injects = t.injects.map((inj, i) => {
    if (nodeIds.has(inj.nodeId)) throw new Error(`${t.id}: duplicate node ${inj.nodeId}`);
    nodeIds.add(inj.nodeId);
    const content = templateInjectContentSchema.parse({
      schemaVersion: 1,
      narrativeMd: inj.narrativeMd,
      phase: inj.phase,
      artifacts: inj.artifacts,
      teamVariants: inj.teamVariants,
    });
    const secret = injectSecretSchema.parse({
      schemaVersion: 1,
      expectedActions: inj.expectedActions,
      capabilityKeys: inj.capabilityKeys,
      mitreTags: inj.mitreTags ?? [],
      ...(inj.gradingNotes ? { gradingNotes: inj.gradingNotes } : {}),
      clockUpdates: inj.clockUpdates ?? [],
    });
    for (const v of content.teamVariants) if (!teams.has(v.team)) throw new Error(`${t.id} ${inj.nodeId}: unknown team ${v.team}`);
    const activeTeams = new Set(content.teamVariants.filter((v) => v.status === "active").map((v) => v.team));
    for (const team of activeTeams) {
      const n = secret.expectedActions[team]?.length ?? 0;
      if (n < 1 || n > 8) throw new Error(`${t.id} ${inj.nodeId}: ${team} needs one to eight expected actions`);
    }
    for (const team of Object.keys(secret.expectedActions)) {
      if (!activeTeams.has(team)) throw new Error(`${t.id} ${inj.nodeId}: expected actions for a team that is not active (${team})`);
    }
    for (const k of inj.objectiveKeys) if (!objectiveKeys.has(k)) throw new Error(`${t.id} ${inj.nodeId}: unknown objective ${k}`);
    const clockKeys = new Set(config.regulatoryClocks.map((c) => c.key));
    for (const c of secret.clockUpdates) if (!clockKeys.has(c.key)) throw new Error(`${t.id} ${inj.nodeId}: unknown clock ${c.key}`);
    return {
      nodeId: inj.nodeId,
      seq: i + 1,
      title: inj.title,
      scenarioOffsetMin: inj.scenarioOffsetMin,
      plannedDelayMin: inj.plannedDelayMin,
      targetTeams: content.teamVariants.map((v) => v.team),
      objectiveKeys: inj.objectiveKeys,
      expectedActions: secret.expectedActions,
      content,
      secret,
      position: { x: 0, y: i * 160 },
    };
  });

  const branches = t.branches.map((b) => {
    if (!nodeIds.has(b.from) || !nodeIds.has(b.to)) throw new Error(`${t.id}: branch ${b.from} -> ${b.to} names an unknown node`);
    return { fromNodeId: b.from, toNodeId: b.to, condition: branchConditionSchema.parse(b.condition), priority: b.priority };
  });
  if (t.branching === "branched" && branches.length === 0) throw new Error(`${t.id}: a branched template needs branches`);
  // A branched graph marks its terminal nodes as end nodes, as the Studio does;
  // otherwise Studio publish warns that the node has no branch out.
  const hasOut = new Set(branches.map((b) => b.fromNodeId));
  const placed = injects.map((inj) =>
    t.branching === "branched" && !hasOut.has(inj.nodeId) ? { ...inj, position: { ...inj.position, end: true } } : inj,
  );
  return { config, objectives, injects: placed, branches };
}

export async function seedStrategicTemplates(db: PrismaClient, templates: readonly StrategicSeedTemplate[] = STRATEGIC_SEED_TEMPLATES): Promise<void> {
  for (const t of templates) {
    const { config, objectives, injects, branches } = parseStrategicSeed(t);
    await db.$transaction(async (tx) => {
      const data = {
        mode: "strategic",
        title: t.title,
        summary: t.summary,
        scope: "library",
        collection: t.collection ?? null,
        status: "published",
        config: json(config),
        objectives: json(objectives),
        branching: t.branching,
      };
      await tx.exerciseTemplate.upsert({ where: { id: t.id }, create: { id: t.id, ...data }, update: data });
      await tx.templateBranch.deleteMany({ where: { templateId: t.id } });
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
      if (branches.length) {
        await tx.templateBranch.createMany({
          data: branches.map((b) => ({ templateId: t.id, fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: json(b.condition), priority: b.priority })),
        });
      }
    });
  }
  console.log(`[seed] Strategic TTX templates: ${templates.length}`);
}
