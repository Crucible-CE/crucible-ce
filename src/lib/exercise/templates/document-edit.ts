// Playbook Exercise template editor service: read for the editor, save edits,
// publish, duplicate, archive. Secret content (expected actions, rubric
// criteria, model answers) is served only through routes that require
// templates.manage.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CONTROLS, getControl } from "@/lib/exercise/content/frameworks";
import { ServiceError } from "@/lib/exercise/errors";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import { readSections } from "@/lib/exercise/documents/documents";
import { getExerciseSettings } from "@/lib/exercise/settings";
import {
  moduleDraftContentSchema,
  moduleSecretSchema,
  rubricCriteriaSchema,
  templateConfigSchema,
  templateObjectivesSchema,
  type RubricCriterion,
} from "@/lib/exercise/modes/document/schema";
import { MAX_MODULES, validateDocumentTemplate, type TemplateIssue } from "@/lib/exercise/modes/document/validate";

const ACTIVE = ["draft", "lobby", "live", "paused"];

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export const moduleEditSchema = z.object({
  id: z.string().max(40).optional(),
  title: z.string().trim().min(1, "Every module needs a title.").max(160),
  scenarioOffsetMin: z.number().int().min(0).max(525_600).default(0),
  plannedDelayMin: z.number().int().min(5).max(120).nullable().default(null),
  content: moduleDraftContentSchema,
  secret: moduleSecretSchema,
});
export type ModuleEdit = z.infer<typeof moduleEditSchema>;

export const rubricEditSchema = z.object({
  questionKey: z.string().min(1).max(40),
  criteria: rubricCriteriaSchema,
  modelAnswer: z.string().trim().max(3000).nullable().default(null),
  capabilityKey: z.string().max(40).nullable().default(null),
});
export type RubricEdit = z.infer<typeof rubricEditSchema>;

export const templateEditSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a title.").max(160).optional(),
    summary: z.string().trim().max(800).nullable().optional(),
    objectives: templateObjectivesSchema.optional(),
    teams: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
    moduleMinutes: z.number().int().min(5).max(120).nullable().optional(),
    paced: z.enum(["facilitator", "timer"]).optional(),
    modules: z.array(moduleEditSchema).max(MAX_MODULES, `Use ${MAX_MODULES} modules or fewer.`).optional(),
    rubrics: z.array(rubricEditSchema).max(120).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change.");
export type TemplateEdit = z.infer<typeof templateEditSchema>;

export async function templateInUse(templateId: string): Promise<boolean> {
  return (await db.exercise.count({ where: { templateId, status: { in: ACTIVE } } })) > 0;
}

async function loadRaw(id: string) {
  const t = await db.exerciseTemplate.findUnique({
    where: { id },
    include: {
      injects: { orderBy: { seq: "asc" } },
      rubrics: { orderBy: { questionKey: "asc" } },
      branches: { orderBy: [{ fromNodeId: "asc" }, { priority: "asc" }] },
    },
  });
  if (!t) throw new ServiceError(404, "Template not found.");
  if (t.mode !== "document") throw new ServiceError(400, "This template is not a Playbook Exercise template.");
  return t;
}

type Raw = Awaited<ReturnType<typeof loadRaw>>;

/** Stored canvas position, or the origin when it is missing or malformed. */
function positionOf(v: unknown): { x: number; y: number } {
  const p = (v && typeof v === "object" ? v : {}) as { x?: unknown; y?: unknown };
  return {
    x: typeof p.x === "number" && Number.isFinite(p.x) ? p.x : 0,
    y: typeof p.y === "number" && Number.isFinite(p.y) ? p.y : 0,
  };
}

function stripGeneration(config: unknown): Record<string, unknown> {
  const { generation: _g, ...rest } = (config ?? {}) as Record<string, unknown>;
  return rest;
}

function parseModules(t: Raw): ModuleEdit[] | null {
  const out: ModuleEdit[] = [];
  for (const i of t.injects) {
    const content = moduleDraftContentSchema.safeParse(i.content);
    const secret = moduleSecretSchema.safeParse(i.secret);
    if (!content.success || !secret.success) return null;
    out.push({ id: i.id, title: i.title, scenarioOffsetMin: i.scenarioOffsetMin, plannedDelayMin: i.plannedDelayMin, content: content.data, secret: secret.data });
  }
  return out;
}

function parseRubrics(t: Raw): RubricEdit[] {
  return t.rubrics.map((r) => {
    const c = rubricCriteriaSchema.safeParse(r.criteria);
    return { questionKey: r.questionKey, criteria: c.success ? c.data : [], modelAnswer: r.modelAnswer, capabilityKey: r.capabilityKey };
  });
}

async function sourceDocument(config: unknown) {
  const c = templateConfigSchema.safeParse(config);
  const id = c.success ? c.data.sourceDocumentId : null;
  if (!id) return null;
  const d = await db.sourceDocument.findUnique({ where: { id }, select: { id: true, title: true, kind: true, sha256: true, sections: true, text: true } });
  return d ? { ...d, sections: readSections(d.sections), sha: c.success ? c.data.sourceDocumentSha : null } : null;
}

function issuesFor(
  modules: ModuleEdit[],
  objectives: z.infer<typeof templateObjectivesSchema>,
  rubrics: RubricEdit[],
  doc: Awaited<ReturnType<typeof sourceDocument>>,
): TemplateIssue[] {
  return validateDocumentTemplate({
    modules,
    objectives,
    rubrics,
    sectionIds: doc ? doc.sections.map((s) => s.id) : null,
    documentText: doc?.text ?? null,
  });
}

/** Everything the editor needs. */
export async function loadDocumentTemplate(id: string) {
  const t = await loadRaw(id);
  const config = templateConfigSchema.safeParse(stripGeneration(t.config));
  const objectives = templateObjectivesSchema.safeParse(t.objectives);
  const modules = parseModules(t);
  const rubrics = parseRubrics(t);
  const doc = await sourceDocument(t.config);
  const instance = await getExerciseSettings();
  const capabilities = await db.capability.findMany({
    where: { framework: instance?.capabilityFramework ?? "nist-csf", isActive: true },
    orderBy: { seq: "asc" },
    select: { key: true, name: true },
  });
  const frameworks = instance?.enabledFrameworks?.length ? instance.enabledFrameworks : ["nist-csf"];
  const issues: TemplateIssue[] =
    modules === null
      ? [{ module: null, message: "A module has content that cannot be read. Save it again from the editor." }]
      : issuesFor(modules, objectives.success ? objectives.data : [], rubrics, doc);
  return {
    template: {
      id: t.id,
      title: t.title,
      summary: t.summary,
      status: t.status,
      version: t.version,
      config: config.success ? config.data : templateConfigSchema.parse({}),
      objectives: objectives.success ? objectives.data : [],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    modules: modules ?? [],
    rubrics,
    document: doc
      ? {
          id: doc.id,
          title: doc.title,
          kind: doc.kind,
          sha256: doc.sha256,
          changed: Boolean(doc.sha && doc.sha !== doc.sha256),
          sections: doc.sections.map((s) => ({ id: s.id, heading: s.heading, level: s.level, start: s.start, end: s.end })),
          text: doc.text,
        }
      : null,
    capabilities,
    controls: CONTROLS.filter((c) => frameworks.includes(c.framework)).map((c) => ({
      framework: c.framework,
      frameworkLabel: c.frameworkLabel,
      controlId: c.controlId,
      title: c.title,
    })),
    issues,
    inUse: await templateInUse(id),
  };
}

function cleanCriteria(criteria: RubricCriterion[]): RubricCriterion[] {
  return criteria.map((c, i) => ({
    id: c.id || `c${i + 1}`,
    text: c.text.trim(),
    controlRefs: c.controlRefs.filter((r) => Boolean(getControl(r.framework, r.controlId))),
  }));
}

/** Save editor changes. Returns the issues left (a draft may have issues; publishing may not). */
export async function saveDocumentTemplate(id: string, edit: TemplateEdit): Promise<{ issues: TemplateIssue[] }> {
  const t = await loadRaw(id);
  const structural = Object.entries(edit).some(([k, v]) => v !== undefined && k !== "title" && k !== "summary");
  if (structural && (await templateInUse(id))) {
    throw new ServiceError(409, "An exercise using this template has not ended. Duplicate the template to make changes.");
  }

  const storedModules = parseModules(t);
  if (structural && storedModules === null && edit.modules === undefined) {
    throw new ServiceError(409, "A module has content that cannot be read. Send every module.");
  }
  const modules = edit.modules ?? storedModules ?? [];
  const objectives = edit.objectives ?? (templateObjectivesSchema.safeParse(t.objectives).data ?? []);
  const rubrics = (edit.rubrics ?? parseRubrics(t)).map((r) => ({ ...r, criteria: cleanCriteria(r.criteria) }));
  const doc = await sourceDocument(t.config);
  const issues = issuesFor(modules, objectives, rubrics, doc);

  const baseConfig = templateConfigSchema.parse(stripGeneration(t.config));
  const config = {
    ...baseConfig,
    ...(edit.teams !== undefined ? { teams: edit.teams } : {}),
    ...(edit.moduleMinutes !== undefined ? { moduleMinutes: edit.moduleMinutes } : {}),
    ...(edit.paced !== undefined ? { paced: edit.paced } : {}),
  };
  if (config.paced === "timer" && !config.moduleMinutes) {
    throw new ServiceError(400, "Set the minutes per module for a timed exercise.");
  }

  await db.$transaction(async (tx) => {
    await tx.exerciseTemplate.update({
      where: { id },
      data: {
        ...(edit.title !== undefined ? { title: edit.title } : {}),
        ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
        ...(structural ? { config: json(config), objectives: json(objectives) } : {}),
      },
    });
    if (!structural) return;

    if (edit.modules !== undefined) {
      const existing = new Map(t.injects.map((i) => [i.id, i]));
      let maxNode = Math.max(0, ...t.injects.map((i) => Number(/^m(\d+)$/.exec(i.nodeId)?.[1] ?? 0)));
      const keep = edit.modules.map((m) => {
        const prior = m.id ? existing.get(m.id) : undefined;
        return { ...m, existingId: prior?.id ?? null, nodeId: prior?.nodeId ?? `m${++maxNode}` };
      });
      const keepIds = keep.map((k) => k.existingId).filter((x): x is string => Boolean(x));
      const keepNodes = keep.map((k) => k.nodeId);
      await tx.templateInject.deleteMany({ where: { templateId: id, id: { notIn: keepIds } } });
      // Branches drawn in the Studio stay. Only those that touch a removed module go.
      await tx.templateBranch.deleteMany({
        where: { templateId: id, OR: [{ fromNodeId: { notIn: keepNodes } }, { toNodeId: { notIn: keepNodes } }] },
      });
      await tx.templateInject.updateMany({ where: { templateId: id }, data: { seq: { increment: 1000 } } });
      // Kept modules keep their Studio layout. A new module goes below the lowest one.
      let nextY = Math.max(-160, ...t.injects.map((i) => positionOf(i.position).y)) + 160;
      for (const [i, m] of keep.entries()) {
        const objectiveKeys = [...new Set(m.content.questions.flatMap((q) => q.objectiveKeys))];
        const data = {
          seq: i + 1,
          title: m.title,
          scenarioOffsetMin: m.scenarioOffsetMin,
          plannedDelayMin: m.plannedDelayMin ?? config.moduleMinutes,
          targetTeams: [],
          objectiveKeys,
          expectedActions: json(m.secret.expectedActions),
          content: json(m.content),
          secret: json(m.secret),
        };
        if (m.existingId) {
          await tx.templateInject.update({ where: { id: m.existingId }, data });
        } else {
          const position = json({ x: 0, y: nextY });
          nextY += 160;
          await tx.templateInject.create({ data: { ...data, position, templateId: id, nodeId: m.nodeId } });
        }
      }
    }

    if (edit.rubrics !== undefined || edit.modules !== undefined) {
      // Rubrics follow the questions that exist after the save.
      const keys = new Set(modules.flatMap((m) => m.content.questions.map((q) => q.key)));
      await tx.rubric.deleteMany({ where: { templateId: id } });
      const rows = rubrics.filter((r) => keys.has(r.questionKey) && r.criteria.length > 0);
      if (rows.length) {
        await tx.rubric.createMany({
          data: rows.map((r) => ({
            templateId: id,
            questionKey: r.questionKey,
            criteria: json(r.criteria),
            modelAnswer: r.modelAnswer,
            maxScore: 4,
            capabilityKey: r.capabilityKey,
          })),
        });
      }
    }
  });
  return { issues };
}

export async function publishDocumentTemplate(id: string): Promise<void> {
  const loaded = await loadDocumentTemplate(id);
  const t = loaded.template;
  if (loaded.modules.length === 0) throw new ServiceError(409, "Add at least one module before publishing.");
  if (loaded.issues.length) {
    throw Object.assign(new ServiceError(409, "Fix the listed problems before publishing."), { issues: loaded.issues });
  }
  await db.exerciseTemplate.update({
    where: { id },
    data: { status: "published", ...(t.status === "published" ? {} : { version: { increment: 1 } }) },
  });
}

export async function setArchived(id: string, archived: boolean): Promise<string> {
  await loadRaw(id);
  const status = archived ? "archived" : "draft";
  await db.exerciseTemplate.update({ where: { id }, data: { status } });
  return status;
}

export async function duplicateDocumentTemplate(id: string, userId: string | null): Promise<string> {
  const t = await loadRaw(id);
  // A copy carries the secret content: a player in a run of this template may not make one.
  if (userId && !(await canReadTemplateSecrets(userId, id))) {
    throw new ServiceError(403, "You are playing in an exercise that uses this template.");
  }
  return db.$transaction(async (tx) => {
    const copy = await tx.exerciseTemplate.create({
      data: {
        mode: "document",
        title: `Copy of ${t.title}`.slice(0, 160),
        summary: t.summary,
        scope: "local",
        status: "draft",
        config: json(stripGeneration(t.config)),
        objectives: json(t.objectives),
        branching: t.branching,
        sourceId: t.id,
        createdById: userId,
      },
      select: { id: true },
    });
    if (t.injects.length) {
      await tx.templateInject.createMany({
        data: t.injects.map((i) => ({
          templateId: copy.id,
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
        data: t.branches.map((b) => ({ templateId: copy.id, fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: json(b.condition), priority: b.priority })),
      });
    }
    if (t.rubrics.length) {
      await tx.rubric.createMany({
        data: t.rubrics.map((r) => ({
          templateId: copy.id,
          questionKey: r.questionKey,
          criteria: json(r.criteria),
          modelAnswer: r.modelAnswer,
          maxScore: r.maxScore,
          capabilityKey: r.capabilityKey,
        })),
      });
    }
    return copy.id;
  });
}

export async function deleteDocumentTemplate(id: string): Promise<string> {
  const t = await loadRaw(id);
  const used = await db.exercise.count({ where: { templateId: id } });
  if (used > 0) throw new ServiceError(409, "Exercises use this template. Archive it instead.");
  await db.exerciseTemplate.delete({ where: { id } });
  return t.title;
}
