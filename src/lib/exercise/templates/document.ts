// Playbook Exercise templates authored by hand from a source document.
//
// createDocumentTemplate makes a draft template linked to the document. The
// author then writes modules, questions, expected actions and rubric criteria
// in the editor with the document beside them. "sections" starts one module
// per main section (title, section reference, one empty question); "blank"
// starts with no modules.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { readSections } from "@/lib/exercise/documents/documents";
import type { DocSection } from "@/lib/exercise/ingest/sections";
import { templateConfigSchema } from "@/lib/exercise/modes/document/schema";
import { MAX_MODULES } from "@/lib/exercise/modes/document/validate";

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export const createDocumentTemplateSchema = z
  .object({
    title: z.string().trim().min(3, "Enter a title.").max(160),
    objectives: z
      .array(
        z.object({
          text: z.string().trim().min(3, "Write every objective.").max(500),
          capabilityKeys: z.array(z.string().max(40)).max(6).default([]),
        }),
      )
      .max(8)
      .default([]),
    teams: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
    moduleMinutes: z.number().int().min(5).max(120).nullable().default(null),
    paced: z.enum(["facilitator", "timer"]).default("facilitator"),
    /** sections: one module per top-level section. blank: no modules yet. */
    start: z.enum(["sections", "blank"]).default("sections"),
  })
  .refine((v) => v.paced !== "timer" || v.moduleMinutes !== null, {
    message: "Set the minutes per module for a timed exercise.",
    path: ["moduleMinutes"],
  });
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;

/**
 * The sections modules start from, in document order: the highest heading
 * level that has at least two sections (a lone title heading is skipped).
 */
export function starterSections(sections: DocSection[], max = MAX_MODULES): DocSection[] {
  const named = sections.filter((s) => s.heading.trim());
  if (named.length === 0) return [];
  const levels = [...new Set(named.map((s) => s.level))].sort((x, y) => x - y);
  const level = levels.find((l) => named.filter((s) => s.level === l).length >= 2) ?? levels[0];
  return named.filter((s) => s.level === level).slice(0, max);
}

/** Starter modules for the editor: title and section reference, one empty question each. */
export function starterModules(sections: DocSection[], moduleMinutes: number | null) {
  return starterSections(sections).map((s, i) => ({
    nodeId: `m${i + 1}`,
    seq: i + 1,
    title: s.heading.trim().slice(0, 160),
    scenarioOffsetMin: i * 30,
    plannedDelayMin: moduleMinutes,
    content: {
      schemaVersion: 1 as const,
      scenarioUpdate: "",
      keyIssues: [] as string[],
      docSectionRefs: [s.id],
      questions: [{ key: `q${i + 1}`, text: "", category: "decision_making" as const, capabilityKeys: [], objectiveKeys: [], docSectionRefs: [s.id] }],
    },
    secret: { schemaVersion: 1 as const, expectedActions: [] as string[] },
  }));
}

/** Create a draft Playbook Exercise template from a document. Returns the template id. */
export async function createDocumentTemplate(documentId: string, input: CreateDocumentTemplateInput, userId: string | null): Promise<string> {
  const doc = await db.sourceDocument.findUnique({ where: { id: documentId }, select: { id: true, sha256: true, sections: true } });
  if (!doc) throw new ServiceError(404, "Document not found.");
  const config = templateConfigSchema.parse({
    sourceDocumentId: doc.id,
    sourceDocumentSha: doc.sha256,
    teams: input.teams,
    moduleMinutes: input.moduleMinutes,
    paced: input.paced,
  });
  const objectives = input.objectives.map((o, i) => ({ key: `o${i + 1}`, text: o.text, capabilityKeys: o.capabilityKeys }));
  const modules = input.start === "sections" ? starterModules(readSections(doc.sections), input.moduleMinutes) : [];

  return db.$transaction(async (tx) => {
    const t = await tx.exerciseTemplate.create({
      data: {
        mode: "document",
        title: input.title,
        scope: "local",
        status: "draft",
        config: json(config),
        objectives: json(objectives),
        branching: "linear",
        createdById: userId,
      },
      select: { id: true },
    });
    if (modules.length) {
      await tx.templateInject.createMany({
        data: modules.map((m) => ({
          templateId: t.id,
          nodeId: m.nodeId,
          seq: m.seq,
          title: m.title,
          scenarioOffsetMin: m.scenarioOffsetMin,
          plannedDelayMin: m.plannedDelayMin,
          targetTeams: [],
          objectiveKeys: [],
          expectedActions: json(m.secret.expectedActions),
          content: json(m.content),
          secret: json(m.secret),
          position: json({ x: 0, y: (m.seq - 1) * 160 }),
        })),
      });
    }
    return t.id;
  });
}
