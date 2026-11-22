// Portable templates: one JSON format for every mode.
//
//   {format: "crucible-template", version: 1, mode,
//    template {mode, title, summary, branching, config, objectives},
//    injects [{nodeId, seq, title, scenarioOffsetMin, plannedDelayMin, targetTeams,
//              expectedActions, objectiveKeys, content, secret, position}],
//    branches [{fromNodeId, toNodeId, condition, priority}],
//    rubrics [{questionKey, criteria, modelAnswer, maxScore, capabilityKey}],
//    sourceDocument {title, sha256} | null}
//
// Exports carry hidden scoring and expected actions, so only callers who
// manage templates and may read this template's secrets can export.
// Imports always create a new local draft; database ids are never carried.
// Document TTX exports name the source document (title and sha256, never its
// text); an import links a local document with the same hash or warns.
// Files written before Studio (template.mode only, no seq or position) still
// import, and so do files with the older format name in LEGACY_PORTABLE_FORMATS.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/exercise/auth/rbac";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { ServiceError } from "@/lib/exercise/errors";
import {
  expectedActionsSchema,
  templateConfigSchema as crisisConfigSchema,
  templateInjectContentSchema as crisisContentSchema,
  templateInjectSecretSchema as crisisSecretSchema,
  templateObjectivesSchema as crisisObjectivesSchema,
} from "@/lib/exercise/modes/crisissim/schema";
import { validateTemplate as validateCrisisSim, type ValidationIssue } from "@/lib/exercise/modes/crisissim/validate";
import { rubricCriteriaSchema, RUBRIC_MAX_SCORE } from "@/lib/exercise/modes/document/schema";
import { MODES, type Mode } from "@/lib/exercise/runtime/types";
import { GRAPH_SCHEMAS, injectColumns, isStudioMode, type DocumentGraph, type StudioMode } from "@/lib/exercise/studio/schema";
import { validateStudio } from "@/lib/exercise/studio/validate";
import type { StudioIssue } from "@/lib/exercise/studio/graph";

export const PORTABLE_FORMAT = "crucible-template";
/** Older format names that still import. */
export const LEGACY_PORTABLE_FORMATS = ["crucible-ttx-template"] as const;
export const PORTABLE_VERSION = 1;
const MAX_IMPORT_INJECTS = 60;

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Template config without generation state from older installs and local ids. */
export function portableConfig(mode: string, config: unknown): Record<string, unknown> {
  const { generation: _g, ...rest } = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  if (mode === "document") return { ...rest, sourceDocumentId: null };
  return rest;
}

export interface PortableInject {
  nodeId: string;
  seq: number;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  targetTeams: string[];
  expectedActions: unknown;
  objectiveKeys: string[];
  content: unknown;
  secret: unknown;
  position: unknown;
}

export interface PortableTemplate {
  format: typeof PORTABLE_FORMAT;
  version: typeof PORTABLE_VERSION;
  exportedAt: string;
  mode: string;
  template: {
    mode: string;
    title: string;
    summary: string | null;
    branching: string;
    config: Record<string, unknown>;
    objectives: unknown;
  };
  injects: PortableInject[];
  branches: Array<{ fromNodeId: string; toNodeId: string; condition: unknown; priority: number }>;
  rubrics: Array<{ questionKey: string; criteria: unknown; modelAnswer: string | null; maxScore: number; capabilityKey: string | null }>;
  sourceDocument: { title: string | null; sha256: string } | null;
}

export interface ExportableTemplate {
  mode: string;
  title: string;
  summary: string | null;
  branching: string;
  config: unknown;
  objectives: unknown;
  injects: Array<{
    nodeId: string;
    seq: number;
    title: string;
    scenarioOffsetMin: number;
    plannedDelayMin: number | null;
    targetTeams: string[];
    expectedActions: unknown;
    objectiveKeys: string[];
    content: unknown;
    secret: unknown;
    position: unknown;
  }>;
  branches: Array<{ fromNodeId: string; toNodeId: string; condition: unknown; priority: number }>;
  rubrics: Array<{ questionKey: string; criteria: unknown; modelAnswer: string | null; maxScore: number; capabilityKey: string | null }>;
}

/** Build the export file. Pure. */
export function toPortable(t: ExportableTemplate, sourceDocument: { title: string | null; sha256: string } | null = null): PortableTemplate {
  return {
    format: PORTABLE_FORMAT,
    version: PORTABLE_VERSION,
    exportedAt: new Date().toISOString(),
    mode: t.mode,
    template: {
      mode: t.mode,
      title: t.title,
      summary: t.summary,
      branching: t.branching,
      config: portableConfig(t.mode, t.config),
      objectives: t.objectives,
    },
    injects: [...t.injects]
      .sort((a, b) => a.seq - b.seq)
      .map((i) => ({
        nodeId: i.nodeId,
        seq: i.seq,
        title: i.title,
        scenarioOffsetMin: i.scenarioOffsetMin,
        plannedDelayMin: i.plannedDelayMin,
        targetTeams: i.targetTeams,
        expectedActions: i.expectedActions,
        objectiveKeys: i.objectiveKeys,
        content: i.content,
        secret: i.secret,
        position: i.position,
      })),
    branches: [...t.branches]
      .sort((a, b) => a.fromNodeId.localeCompare(b.fromNodeId) || a.priority - b.priority)
      .map((b) => ({ fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: b.condition, priority: b.priority })),
    rubrics: t.mode === "document" ? t.rubrics.map((r) => ({ questionKey: r.questionKey, criteria: r.criteria, modelAnswer: r.modelAnswer, maxScore: r.maxScore, capabilityKey: r.capabilityKey })) : [],
    sourceDocument: t.mode === "document" ? sourceDocument : null,
  };
}

// ---------------------------------------------------------------------------
// Import parsing (pure)
// ---------------------------------------------------------------------------

const portableEnvelopeSchema = z.object({
  format: z.enum([PORTABLE_FORMAT, ...LEGACY_PORTABLE_FORMATS]),
  version: z.literal(PORTABLE_VERSION),
  exportedAt: z.string().optional(),
  mode: z.string().optional(),
  template: z.object({
    mode: z.string().optional(),
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().max(800).nullable().optional(),
    branching: z.enum(["linear", "branched"]).default("linear"),
    config: z.unknown(),
    objectives: z.unknown(),
  }),
  injects: z.array(z.unknown()).min(1).max(MAX_IMPORT_INJECTS),
  branches: z.array(z.unknown()).max(400).default([]),
  rubrics: z.array(z.unknown()).max(200).default([]),
  sourceDocument: z
    .object({ title: z.string().max(300).nullable().default(null), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
    .nullable()
    .optional(),
});

const portableRubricSchema = z.object({
  questionKey: z.string().min(1).max(40),
  criteria: rubricCriteriaSchema,
  modelAnswer: z.string().trim().max(3000).nullable().default(null),
  maxScore: z.number().int().min(1).max(10).default(RUBRIC_MAX_SCORE),
  capabilityKey: z.string().max(40).nullable().default(null),
});

const crisisInjectSchema = z.object({
  title: z.string().trim().min(1).max(160),
  scenarioOffsetMin: z.number().int().min(0).max(60 * 24 * 365),
  plannedDelayMin: z.number().int().min(1).max(120).nullable(),
  targetTeams: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  objectiveKeys: z.array(z.string().max(40)).max(12).default([]),
  expectedActions: expectedActionsSchema,
  content: crisisContentSchema,
  secret: crisisSecretSchema,
});

export interface ParsedRow {
  nodeId: string;
  seq: number;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  targetTeams: string[];
  objectiveKeys: string[];
  expectedActions: unknown;
  content: unknown;
  secret: unknown;
  position: unknown;
}

export interface ParsedImport {
  mode: Mode;
  title: string;
  summary: string | null;
  branching: "linear" | "branched";
  config: Record<string, unknown>;
  objectives: unknown;
  injects: ParsedRow[];
  branches: Array<{ fromNodeId: string; toNodeId: string; condition: unknown; priority: number }>;
  rubrics: Array<z.infer<typeof portableRubricSchema>>;
  sourceDocument: { title: string | null; sha256: string } | null;
  /** Problems to fix before publishing. The draft is still created. */
  issues: Array<ValidationIssue | StudioIssue>;
  warnings: string[];
}

export type ParseResult = { ok: true; value: ParsedImport } | { ok: false; error: string; details?: unknown };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

/** Fill nodeId, seq and position for files written before Studio. */
function normalizeNodes(injects: unknown[]): Obj[] {
  return injects.map((raw, i) => {
    const o = obj(raw);
    const pos = obj(o.position);
    return {
      ...o,
      nodeId: typeof o.nodeId === "string" && o.nodeId ? o.nodeId : `n${i + 1}`,
      seq: typeof o.seq === "number" ? o.seq : i + 1,
      position: { x: typeof pos.x === "number" ? pos.x : 0, y: typeof pos.y === "number" ? pos.y : i * 160, ...(pos.end === true ? { end: true } : {}) },
    };
  });
}

/** Validate an import file for its mode. Pure. */
export function parsePortable(raw: unknown): ParseResult {
  const env = portableEnvelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, error: "This is not a template export file." };
  const file = env.data;
  const mode = file.mode ?? file.template.mode;
  if (!mode || !(MODES as readonly string[]).includes(mode)) return { ok: false, error: "The file is for an exercise type this install does not have." };
  if (file.mode && file.template.mode && file.mode !== file.template.mode) return { ok: false, error: "The file names two different exercise types." };
  const nodes = normalizeNodes(file.injects).sort((a, b) => (a.seq as number) - (b.seq as number));
  const warnings: string[] = [];

  if (mode === "crisissim") {
    const config = crisisConfigSchema.safeParse(portableConfig(mode, file.template.config));
    const objectives = crisisObjectivesSchema.safeParse(file.template.objectives ?? []);
    const injects = z.array(crisisInjectSchema).min(1).max(30).safeParse(nodes);
    if (!config.success || !objectives.success || !injects.success) {
      return {
        ok: false,
        error: "The file has invalid template content.",
        details: (!config.success ? config.error : !objectives.success ? objectives.error : injects.error!).flatten(),
      };
    }
    if (file.branches.length) warnings.push("Crisis Sim does not use template branches. They were left out.");
    const rows: ParsedRow[] = injects.data.map((inj, i) => ({
      ...inj,
      nodeId: `n${i + 1}`,
      seq: i + 1,
      position: { x: 0, y: i * 160 },
    }));
    return {
      ok: true,
      value: {
        mode,
        title: file.template.title,
        summary: file.template.summary ?? null,
        branching: "linear",
        config: config.data as Record<string, unknown>,
        objectives: objectives.data,
        injects: rows,
        branches: [],
        rubrics: [],
        sourceDocument: null,
        issues: validateCrisisSim({ config: config.data, injects: injects.data, objectives: objectives.data }),
        warnings,
      },
    };
  }

  if (!isStudioMode(mode)) return { ok: false, error: "The file is for an exercise type this install does not have." };
  const graphRaw = {
    template: {
      title: file.template.title,
      summary: file.template.summary ?? null,
      branching: file.template.branching,
      config: portableConfig(mode, file.template.config),
      objectives: file.template.objectives ?? [],
    },
    injects: nodes,
    branches: file.branches,
  };
  const parsed = GRAPH_SCHEMAS[mode].safeParse(graphRaw);
  if (!parsed.success) {
    const { issues } = validateStudio(mode, graphRaw);
    return { ok: false, error: "The file has invalid template content.", details: { issues: issues.filter((i) => i.severity === "error") } };
  }
  const { issues } = validateStudio(mode, graphRaw);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) return { ok: false, error: "The file has an invalid branch graph.", details: { issues: errors } };

  let rubrics: ParsedImport["rubrics"] = [];
  if (mode === "document") {
    const r = z.array(portableRubricSchema).safeParse(file.rubrics);
    if (!r.success) return { ok: false, error: "The file has invalid rubrics.", details: r.error.flatten() };
    const keys = new Set((parsed.data as DocumentGraph).injects.flatMap((m) => m.content.questions.map((q) => q.key)));
    rubrics = r.data.filter((x) => keys.has(x.questionKey));
    if (rubrics.length < r.data.length) warnings.push("Rubrics for questions that are not in the file were left out.");
  } else if (file.rubrics.length) {
    warnings.push("Rubrics are only used by Playbook Exercise. They were left out.");
  }

  const g = parsed.data;
  const rows: ParsedRow[] = g.injects.map((inj, i) => ({
    nodeId: inj.nodeId,
    seq: i + 1,
    title: inj.title,
    scenarioOffsetMin: inj.scenarioOffsetMin,
    plannedDelayMin: inj.plannedDelayMin,
    ...injectColumns(mode, inj),
    content: inj.content,
    secret: inj.secret,
    position: inj.position,
  }));
  return {
    ok: true,
    value: {
      mode,
      title: g.template.title,
      summary: g.template.summary,
      branching: g.template.branching,
      config: g.template.config as Record<string, unknown>,
      objectives: g.template.objectives,
      injects: rows,
      branches: g.branches,
      rubrics,
      sourceDocument: mode === "document" ? (file.sourceDocument ?? null) : null,
      issues: issues.filter((i) => i.severity !== "info"),
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/** Who may export: template managers who are not playing in a live run of it. */
export async function assertCanExport(user: Pick<SessionUser, "id" | "role">, templateId: string): Promise<void> {
  if (!hasPermission(user, "templates.manage")) throw new ServiceError(403, "You do not have access to this.");
  // Loaded on use so the pure parts of this module import without the auth stack.
  const { canReadTemplateSecrets } = await import("@/lib/exercise/access");
  if (!(await canReadTemplateSecrets(user.id, templateId))) {
    throw new ServiceError(403, "You are playing in an exercise that uses this template. Its content is hidden until that exercise ends.");
  }
}

export async function exportTemplate(templateId: string): Promise<PortableTemplate> {
  const t = await db.exerciseTemplate.findUnique({
    where: { id: templateId },
    include: { injects: { orderBy: { seq: "asc" } }, branches: true, rubrics: { orderBy: { questionKey: "asc" } } },
  });
  if (!t) throw new ServiceError(404, "Template not found.");
  if (t.status === "generating" || t.status === "failed") throw new ServiceError(409, "Only a finished template can be exported.");
  let sourceDocument: PortableTemplate["sourceDocument"] = null;
  if (t.mode === "document") {
    const cfg = obj(t.config);
    const docId = typeof cfg.sourceDocumentId === "string" ? cfg.sourceDocumentId : null;
    const doc = docId ? await db.sourceDocument.findUnique({ where: { id: docId }, select: { title: true, sha256: true } }) : null;
    const sha = doc?.sha256 ?? (typeof cfg.sourceDocumentSha === "string" ? cfg.sourceDocumentSha : null);
    if (sha) sourceDocument = { title: doc?.title ?? null, sha256: sha };
  }
  return toPortable(t, sourceDocument);
}

/** Export for a user. Throws ServiceError(403) when the caller may not read the secrets. */
export async function exportTemplateFor(user: Pick<SessionUser, "id" | "role">, templateId: string): Promise<PortableTemplate> {
  await assertCanExport(user, templateId);
  return exportTemplate(templateId);
}

export interface ImportResult {
  id: string;
  mode: Mode;
  issues: ParsedImport["issues"];
  warnings: string[];
}

/** Create a local draft from an export file. Never overwrites a template. */
export async function importTemplate(raw: unknown, userId: string | null): Promise<ImportResult> {
  const r = parsePortable(raw);
  if (!r.ok) throw Object.assign(new ServiceError(400, r.error), { details: r.details });
  const p = r.value;
  const warnings = [...p.warnings];
  let config = p.config;

  if (p.mode === "document") {
    const sha = p.sourceDocument?.sha256 ?? (typeof config.sourceDocumentSha === "string" ? config.sourceDocumentSha : null);
    const doc = sha ? await db.sourceDocument.findFirst({ where: { sha256: sha }, orderBy: { createdAt: "desc" }, select: { id: true, sha256: true } }) : null;
    config = { ...config, sourceDocumentId: doc?.id ?? null, sourceDocumentSha: sha };
    if (sha && !doc) {
      const name = p.sourceDocument?.title ? `"${p.sourceDocument.title}"` : "The source document";
      warnings.push(`${name} is not in the document library. Upload it to link its sections.`);
    }
  }

  const id = await db.$transaction(async (tx) => {
    const row = await tx.exerciseTemplate.create({
      data: {
        mode: p.mode,
        title: p.title,
        summary: p.summary,
        scope: "local",
        status: "draft",
        config: json(config),
        objectives: json(p.objectives),
        branching: p.branching,
        createdById: userId,
      },
      select: { id: true },
    });
    await tx.templateInject.createMany({
      data: p.injects.map((inj) => ({
        templateId: row.id,
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
    if (p.branches.length) {
      await tx.templateBranch.createMany({
        data: p.branches.map((b) => ({ templateId: row.id, fromNodeId: b.fromNodeId, toNodeId: b.toNodeId, condition: json(b.condition), priority: b.priority })),
      });
    }
    if (p.rubrics.length) {
      await tx.rubric.createMany({
        data: p.rubrics.map((x) => ({
          templateId: row.id,
          questionKey: x.questionKey,
          criteria: json(x.criteria),
          modelAnswer: x.modelAnswer,
          maxScore: x.maxScore,
          capabilityKey: x.capabilityKey,
        })),
      });
    }
    return row.id;
  });
  return { id, mode: p.mode, issues: p.issues, warnings };
}

export function portableFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "template";
  return `${slug}.template.json`;
}

export type { StudioMode };
