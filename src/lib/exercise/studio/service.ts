// Scenario Studio service: read, save, create, publish and duplicate
// Strategic TTX and Document TTX templates as a graph. Server only.
//
// Rules:
//   - Only template managers who may read this template's secrets get here.
//   - Saving replaces the whole graph. The caller sends the updatedAt it
//     loaded; a newer save in between returns 409 and changes nothing.
//   - A template that a non-ended exercise uses cannot change (same rule as
//     the Crisis Sim editor). Duplicate it instead.
//   - Errors block saving. Errors and warnings block publishing.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import { ServiceError } from "@/lib/exercise/errors";
import { readSections } from "@/lib/exercise/documents/documents";
import { publishDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { blocksPublish, hasErrors, type StudioIssue } from "./graph";
import {
  injectColumns,
  isStudioMode,
  newDocumentConfig,
  newStrategicConfig,
  putBodySchema,
  type DocumentGraph,
  type StudioGraph,
  type StudioMode,
} from "./schema";
import { validateStudio, type RawGraph } from "./validate";

const ACTIVE = ["draft", "lobby", "live", "paused"];

export type StudioUser = Pick<SessionUser, "id" | "role">;

/** A ServiceError that carries the issues behind it. */
export class StudioError extends ServiceError {
  constructor(
    status: number,
    message: string,
    public issues: StudioIssue[] = [],
  ) {
    super(status, message);
    this.name = "StudioError";
  }
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export async function templateInUse(templateId: string): Promise<boolean> {
  return (await db.exercise.count({ where: { templateId, status: { in: ACTIVE } } })) > 0;
}

/** Managers only, and never a player in a live run of this template. */
export async function assertStudioAccess(user: StudioUser, templateId: string | null): Promise<void> {
  if (!hasPermission(user, "templates.manage")) throw new ServiceError(403, "You do not have access to this.");
  if (templateId && !(await canReadTemplateSecrets(user.id, templateId))) {
    throw new ServiceError(403, "You are playing in an exercise that uses this template. Its content is hidden until that exercise ends.");
  }
}

async function loadFull(id: string) {
  return db.exerciseTemplate.findUnique({
    where: { id },
    include: {
      injects: { orderBy: { seq: "asc" } },
      branches: { orderBy: [{ fromNodeId: "asc" }, { priority: "asc" }] },
      rubrics: { select: { questionKey: true } },
    },
  });
}
type Full = NonNullable<Awaited<ReturnType<typeof loadFull>>>;

function requireStudioMode(mode: string): StudioMode {
  if (!isStudioMode(mode)) throw new ServiceError(400, "Crisis Sim templates open in their own editor.");
  return mode;
}

function stripGeneration(config: unknown): Record<string, unknown> {
  const { generation: _g, ...rest } = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  return rest;
}

/** The stored template as a raw graph for validation. */
function rawGraphOf(t: Full): RawGraph {
  return {
    template: { title: t.title, summary: t.summary, branching: t.branching, config: stripGeneration(t.config), objectives: t.objectives },
    injects: t.injects.map((i) => ({
      nodeId: i.nodeId,
      seq: i.seq,
      title: i.title,
      scenarioOffsetMin: i.scenarioOffsetMin,
      plannedDelayMin: i.plannedDelayMin,
      ...(t.mode === "strategic" ? { objectiveKeys: i.objectiveKeys } : {}),
      content: i.content,
      secret: i.secret,
      position: i.position,
    })),
    branches: t.branches.map((b) => ({ fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: b.condition, priority: b.priority })),
  };
}

async function documentInfo(config: unknown) {
  const c = (config ?? {}) as { sourceDocumentId?: unknown; sourceDocumentSha?: unknown };
  const id = typeof c.sourceDocumentId === "string" ? c.sourceDocumentId : null;
  const sha = typeof c.sourceDocumentSha === "string" ? c.sourceDocumentSha : null;
  if (!id) return sha ? { id: null, title: null, sha256: sha, missing: true, changed: false, sections: [] } : null;
  const d = await db.sourceDocument.findUnique({ where: { id }, select: { id: true, title: true, sha256: true, sections: true } });
  if (!d) return { id: null, title: null, sha256: sha, missing: true, changed: false, sections: [] };
  return {
    id: d.id,
    title: d.title,
    sha256: d.sha256,
    missing: false,
    changed: Boolean(sha && sha !== d.sha256),
    sections: readSections(d.sections).map((s) => ({ id: s.id, heading: s.heading })),
  };
}

export async function getStudioTemplate(id: string, user: StudioUser) {
  await assertStudioAccess(user, id);
  const t = await loadFull(id);
  if (!t) throw new ServiceError(404, "Template not found.");
  const mode = requireStudioMode(t.mode);
  const raw = rawGraphOf(t);
  // Every stored template is editable in CE (no background preparation).
  const ready = true;
  return {
    template: {
      id: t.id,
      mode,
      title: t.title,
      summary: t.summary,
      status: t.status,
      scope: t.scope,
      version: t.version,
      branching: t.branching === "branched" ? ("branched" as const) : ("linear" as const),
      config: stripGeneration(t.config),
      objectives: t.objectives,
      updatedAt: t.updatedAt.toISOString(),
    },
    injects: raw.injects,
    branches: raw.branches,
    rubricKeys: t.rubrics.map((r) => r.questionKey),
    document: mode === "document" ? await documentInfo(t.config) : null,
    inUse: await templateInUse(id),
    ready,
    issues: ready ? validateStudio(mode, raw).issues : [],
  };
}

/** Replace the whole graph. Returns the new updatedAt and the issues left. */
export async function saveStudioGraph(id: string, rawBody: unknown, user: StudioUser): Promise<{ updatedAt: string; issues: StudioIssue[] }> {
  await assertStudioAccess(user, id);
  const body = putBodySchema.safeParse(rawBody);
  if (!body.success) throw new ServiceError(400, "The save request is not valid. Reload and try again.");
  const expected = new Date(body.data.expectedUpdatedAt);
  if (Number.isNaN(expected.getTime())) throw new ServiceError(400, "The save request is not valid. Reload and try again.");

  const t = await db.exerciseTemplate.findUnique({ where: { id }, select: { mode: true, status: true, config: true, updatedAt: true } });
  if (!t) throw new ServiceError(404, "Template not found.");
  const mode = requireStudioMode(t.mode);
  if (t.status === "generating") throw new ServiceError(409, "The template is still being prepared. Wait for it to finish.");
  if (t.status === "failed") throw new ServiceError(409, "Prepare failed for this template. Try again or start a new one.");
  if (await templateInUse(id)) {
    throw new ServiceError(409, "An exercise using this template has not ended. Duplicate the template to make changes.");
  }
  if (t.updatedAt.getTime() !== expected.getTime()) {
    throw new ServiceError(409, "Someone saved this template after you opened it. Reload to see their changes.");
  }

  const { issues, graph } = validateStudio(mode, body.data.graph as RawGraph);
  if (!graph || hasErrors(issues)) throw new StudioError(400, "Fix the listed problems before saving.", issues.filter((i) => i.severity === "error"));

  // Document templates keep their source document link and prepare state.
  let config: Record<string, unknown> = graph.template.config as Record<string, unknown>;
  if (mode === "document") {
    const stored = (t.config ?? {}) as Record<string, unknown>;
    config = {
      ...config,
      sourceDocumentId: stored.sourceDocumentId ?? null,
      sourceDocumentSha: stored.sourceDocumentSha ?? null,
      ...(stored.generation ? { generation: stored.generation } : {}),
    };
  }
  const injects = [...graph.injects].sort((a, b) => a.seq - b.seq);
  const now = new Date();

  await db.$transaction(async (tx) => {
    const res = await tx.exerciseTemplate.updateMany({
      where: { id, updatedAt: expected },
      data: {
        title: graph.template.title,
        summary: graph.template.summary,
        branching: graph.template.branching,
        config: json(config),
        objectives: json(graph.template.objectives),
        updatedAt: now,
      },
    });
    if (res.count !== 1) throw new ServiceError(409, "Someone saved this template after you opened it. Reload to see their changes.");

    await tx.templateBranch.deleteMany({ where: { templateId: id } });
    await tx.templateInject.deleteMany({ where: { templateId: id, nodeId: { notIn: injects.map((i) => i.nodeId) } } });
    for (const [i, inj] of injects.entries()) {
      const data = {
        seq: i + 1,
        title: inj.title,
        scenarioOffsetMin: inj.scenarioOffsetMin,
        plannedDelayMin: inj.plannedDelayMin,
        ...injectColumns(mode, inj),
        content: json(inj.content),
        secret: json(inj.secret),
        position: json(inj.position),
      };
      const cols = { ...data, expectedActions: json(data.expectedActions) };
      await tx.templateInject.upsert({
        where: { templateId_nodeId: { templateId: id, nodeId: inj.nodeId } },
        create: { ...cols, templateId: id, nodeId: inj.nodeId },
        update: cols,
      });
    }
    if (graph.branches.length) {
      await tx.templateBranch.createMany({
        data: graph.branches.map((b) => ({ templateId: id, fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: json(b.condition), priority: b.priority })),
      });
    }
    if (mode === "document") {
      // Rubrics follow the questions that exist after the save.
      const keys = (graph as DocumentGraph).injects.flatMap((m) => m.content.questions.map((q) => q.key));
      await tx.rubric.deleteMany({ where: { templateId: id, questionKey: { notIn: keys } } });
    }
  });
  return { updatedAt: now.toISOString(), issues };
}

/** A new empty draft. */
export async function createStudioTemplate(mode: string, title: string, user: StudioUser, summary?: string): Promise<string> {
  await assertStudioAccess(user, null);
  if (!isStudioMode(mode)) throw new ServiceError(400, "Pick Strategic TTX or Playbook Exercise.");
  const clean = title.trim();
  if (clean.length < 3 || clean.length > 160) throw new ServiceError(400, "Enter a title of 3 to 160 characters.");
  const config = mode === "strategic" ? newStrategicConfig() : newDocumentConfig();
  const row = await db.exerciseTemplate.create({
    data: {
      mode,
      title: clean,
      summary: summary?.trim().slice(0, 800) || null,
      scope: "local",
      status: "draft",
      config: json(config),
      objectives: json([]),
      branching: "linear",
      createdById: user.id,
    },
    select: { id: true },
  });
  return row.id;
}

export async function publishStudioTemplate(id: string, user: StudioUser): Promise<void> {
  await assertStudioAccess(user, id);
  const t = await loadFull(id);
  if (!t) throw new ServiceError(404, "Template not found.");
  const mode = requireStudioMode(t.mode);
  if (t.status === "generating" || t.status === "failed") throw new ServiceError(409, "Only a finished template can be published.");
  if (t.injects.length === 0) throw new ServiceError(409, "Add at least one inject before publishing.");
  const { issues } = validateStudio(mode, rawGraphOf(t));
  if (blocksPublish(issues)) {
    throw new StudioError(409, "Fix the listed problems before publishing.", issues.filter((i) => i.severity !== "info"));
  }
  if (mode === "document") {
    // Rubric and section checks live with the Document TTX editor.
    try {
      await publishDocumentTemplate(id);
    } catch (e) {
      const extra = (e as { issues?: Array<{ module: number | null; message: string }> }).issues;
      if (e instanceof ServiceError && extra) {
        throw new StudioError(
          e.status,
          e.message,
          extra.map((x) => ({ severity: "warning", code: "document", message: x.message, nodeId: x.module === null ? null : (t.injects[x.module]?.nodeId ?? null) })),
        );
      }
      throw e;
    }
    return;
  }
  await db.exerciseTemplate.update({
    where: { id },
    data: { status: "published", ...(t.status === "published" ? {} : { version: { increment: 1 } }) },
  });
}

/** Copy the template with its injects, branches and rubrics into a local draft. */
export async function duplicateStudioTemplate(id: string, user: StudioUser): Promise<string> {
  await assertStudioAccess(user, id);
  const t = await db.exerciseTemplate.findUnique({ where: { id }, include: { injects: true, branches: true, rubrics: true } });
  if (!t) throw new ServiceError(404, "Template not found.");
  requireStudioMode(t.mode);
  if (t.status === "generating" || t.status === "failed") throw new ServiceError(409, "Only a finished template can be duplicated.");
  return db.$transaction(async (tx) => {
    const copy = await tx.exerciseTemplate.create({
      data: {
        mode: t.mode,
        title: `${t.title} (copy)`.slice(0, 160),
        summary: t.summary,
        scope: "local",
        status: "draft",
        config: json(stripGeneration(t.config)),
        objectives: json(t.objectives),
        branching: t.branching,
        sourceId: t.id,
        createdById: user.id,
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

export type { StudioGraph };
