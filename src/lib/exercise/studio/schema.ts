// Scenario Studio graph schemas. One graph = template settings, nodes
// (TemplateInject rows) and edges (TemplateBranch rows). Pure and safe to
// import on the client.
//
// Strategic TTX and Document TTX are edited here. Crisis Sim keeps its own
// linear editor and branches inside each inject through path variants.

import { z } from "zod";
import { branchConditionSchema } from "@/lib/exercise/modes/shared/branching";
import {
  injectSecretSchema as strategicSecretSchema,
  templateConfigSchema as strategicConfigSchema,
  templateInjectContentSchema as strategicContentSchema,
  templateObjectivesSchema as strategicObjectivesSchema,
} from "@/lib/exercise/modes/strategic/schema";
import {
  moduleContentSchema,
  moduleSecretSchema,
  templateConfigSchema as documentConfigSchema,
  templateObjectivesSchema as documentObjectivesSchema,
} from "@/lib/exercise/modes/document/schema";

export const STUDIO_MODES = ["strategic", "document"] as const;
export type StudioMode = (typeof STUDIO_MODES)[number];

export function isStudioMode(mode: string): mode is StudioMode {
  return (STUDIO_MODES as readonly string[]).includes(mode);
}

export const STUDIO_MODE_LABELS: Record<StudioMode, string> = {
  strategic: "Strategic TTX",
  document: "Playbook Exercise",
};

export const NODE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
export const MAX_NODES: Record<StudioMode, number> = { strategic: 40, document: 12 };
export const MAX_BRANCHES = 200;
export const MAX_OFFSET_MIN = 60 * 24 * 365;

/** Canvas position. `end` marks a node that is meant to finish a branched run. */
export const positionSchema = z
  .object({
    x: z.number().finite().default(0),
    y: z.number().finite().default(0),
    end: z.boolean().optional(),
  })
  .catch({ x: 0, y: 0 });

export const studioBranchSchema = z.object({
  fromNodeId: z.string().regex(NODE_ID_RE),
  toNodeId: z.string().regex(NODE_ID_RE),
  condition: branchConditionSchema,
  priority: z.number().int().min(0).max(1000),
});

const nodeBase = {
  nodeId: z.string().regex(NODE_ID_RE, "Node ids use letters, numbers, dash and underscore."),
  seq: z.number().int().min(1).max(1000),
  title: z.string().trim().min(1).max(160),
  scenarioOffsetMin: z.number().int().min(0).max(MAX_OFFSET_MIN),
  position: positionSchema,
};

export const strategicInjectSchema = z.object({
  ...nodeBase,
  plannedDelayMin: z.number().int().min(1).max(240).nullable(),
  objectiveKeys: z.array(z.string().min(1).max(80)).max(12).default([]),
  content: strategicContentSchema,
  secret: strategicSecretSchema,
});
export type StrategicInject = z.infer<typeof strategicInjectSchema>;

export const documentInjectSchema = z.object({
  ...nodeBase,
  plannedDelayMin: z.number().int().min(5).max(120).nullable(),
  content: moduleContentSchema,
  secret: moduleSecretSchema,
});
export type DocumentInject = z.infer<typeof documentInjectSchema>;

const templateBase = {
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(800).nullable().default(null),
  branching: z.enum(["linear", "branched"]).default("linear"),
};

export const strategicTemplateSchema = z.object({
  ...templateBase,
  config: strategicConfigSchema,
  objectives: strategicObjectivesSchema.default([]),
});

export const documentTemplateSchema = z.object({
  ...templateBase,
  config: documentConfigSchema,
  objectives: documentObjectivesSchema.default([]),
});

export const strategicGraphSchema = z.object({
  template: strategicTemplateSchema,
  injects: z.array(strategicInjectSchema).max(MAX_NODES.strategic),
  branches: z.array(studioBranchSchema).max(MAX_BRANCHES).default([]),
});
export type StrategicGraph = z.infer<typeof strategicGraphSchema>;

export const documentGraphSchema = z.object({
  template: documentTemplateSchema,
  injects: z.array(documentInjectSchema).max(MAX_NODES.document),
  branches: z.array(studioBranchSchema).max(MAX_BRANCHES).default([]),
});
export type DocumentGraph = z.infer<typeof documentGraphSchema>;

export type StudioGraph = StrategicGraph | DocumentGraph;

export const GRAPH_SCHEMAS = {
  strategic: strategicGraphSchema,
  document: documentGraphSchema,
} as const;

export const INJECT_SCHEMAS = {
  strategic: strategicInjectSchema,
  document: documentInjectSchema,
} as const;

export const TEMPLATE_SCHEMAS = {
  strategic: strategicTemplateSchema,
  document: documentTemplateSchema,
} as const;

/** PUT /api/studio/templates/[id]. The graph is parsed per mode after the template is loaded. */
export const putBodySchema = z.object({
  expectedUpdatedAt: z.string().min(1).max(40),
  graph: z.object({
    template: z.unknown(),
    injects: z.array(z.unknown()).max(60),
    branches: z.array(z.unknown()).max(MAX_BRANCHES).default([]),
  }),
});

/** Columns written for a node, derived from the parsed graph. */
export function injectColumns(mode: StudioMode, inj: StrategicInject | DocumentInject) {
  if (mode === "strategic") {
    const s = inj as StrategicInject;
    return {
      targetTeams: s.content.teamVariants.map((v) => v.team),
      objectiveKeys: s.objectiveKeys,
      expectedActions: s.secret.expectedActions as unknown,
    };
  }
  const d = inj as DocumentInject;
  return {
    targetTeams: [] as string[],
    objectiveKeys: [...new Set(d.content.questions.flatMap((q) => q.objectiveKeys))],
    expectedActions: d.secret.expectedActions as unknown,
  };
}

/** Strategic config for a new empty template. */
export function newStrategicConfig() {
  return strategicConfigSchema.parse({ teams: ["Team 1", "Team 2"], targetDurationMin: 90 });
}

/** Document config for a new empty template (no source document). */
export function newDocumentConfig() {
  return documentConfigSchema.parse({});
}
