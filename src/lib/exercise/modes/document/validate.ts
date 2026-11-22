// Checks for a Playbook Exercise template, on every editor save and at
// publish. Pure.

import { containsQuoteIn, normalizeForMatch } from "./match";
import type { ModuleContent, ModuleSecret, RubricCriterion, TemplateObjective } from "./schema";

export const MIN_MODULES = 1;
export const MAX_MODULES = 12;
export const QUESTION_KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

export interface DocTemplateDraft {
  modules: Array<{ title: string; content: ModuleContent; secret: ModuleSecret }>;
  objectives: TemplateObjective[];
  rubrics: Array<{ questionKey: string; criteria: RubricCriterion[] }>;
  /** Section ids of the source document, or null when the document is gone. */
  sectionIds: string[] | null;
  /** Source document text, to check source excerpts. Null skips the check. */
  documentText?: string | null;
}

export interface TemplateIssue {
  /** Zero-based module index, or null for the whole template. */
  module: number | null;
  message: string;
}

export function validateDocumentTemplate(d: DocTemplateDraft): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const add = (module: number | null, message: string) => issues.push({ module, message });

  if (d.modules.length < MIN_MODULES) add(null, "Add at least one module.");
  if (d.modules.length > MAX_MODULES) add(null, `Use ${MAX_MODULES} modules or fewer.`);

  const sections = d.sectionIds ? new Set(d.sectionIds) : null;
  const objectives = new Set(d.objectives.map((o) => o.key));
  const objectiveKeys = new Set<string>();
  for (const o of d.objectives) {
    if (objectiveKeys.has(o.key)) add(null, `Objective key ${o.key} is used twice.`);
    objectiveKeys.add(o.key);
  }
  const normalizedDoc = d.documentText ? normalizeForMatch(d.documentText) : null;

  const seen = new Map<string, number>();
  for (const [i, m] of d.modules.entries()) {
    const n = i + 1;
    if (!m.title.trim()) add(i, `Module ${n} needs a title.`);
    if (m.content.scenarioUpdate.trim().length < 10) add(i, `Module ${n} needs a scenario update of at least 10 characters.`);
    if (m.content.questions.length === 0) add(i, `Module ${n} needs at least one question.`);
    if (m.content.questions.some((q) => q.text.trim().length < 5)) add(i, `Every question in module ${n} needs at least 5 characters.`);
    if (sections) {
      for (const ref of m.content.docSectionRefs) {
        if (!sections.has(ref)) add(i, `Module ${n} cites a section that is not in the document.`);
      }
    }
    if (normalizedDoc && m.content.sourceExcerpt && !containsQuoteIn(normalizedDoc, m.content.sourceExcerpt)) {
      add(i, `The source excerpt in module ${n} is not in the document. Copy it word for word or clear it.`);
    }
    for (const q of m.content.questions) {
      if (!QUESTION_KEY_RE.test(q.key)) add(i, `Question key ${q.key} in module ${n} has characters that are not allowed.`);
      const prior = seen.get(q.key);
      if (prior !== undefined) add(i, `Question key ${q.key} is used in module ${prior + 1} and module ${n}.`);
      else seen.set(q.key, i);
      for (const k of q.objectiveKeys) {
        if (!objectives.has(k)) add(i, `A question in module ${n} links an objective that does not exist.`);
      }
      if (sections) {
        for (const ref of q.docSectionRefs) {
          if (!sections.has(ref)) add(i, `A question in module ${n} cites a section that is not in the document.`);
        }
      }
    }
  }

  const rubricKeys = new Set<string>();
  for (const r of d.rubrics) {
    if (!seen.has(r.questionKey)) add(null, `A rubric belongs to question ${r.questionKey}, which no module has.`);
    if (rubricKeys.has(r.questionKey)) add(null, `Question ${r.questionKey} has two rubrics.`);
    rubricKeys.add(r.questionKey);
    if (r.criteria.length === 0) add(seen.get(r.questionKey) ?? null, `Question ${r.questionKey} needs at least one criterion.`);
  }
  for (const [key, i] of seen) {
    if (!rubricKeys.has(key)) add(i, `Question ${key} in module ${i + 1} has no rubric.`);
  }
  return dedupe(issues);
}

function dedupe(issues: TemplateIssue[]): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const keys = new Set<string>();
  for (const i of issues) {
    const k = `${i.module}:${i.message}`;
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(i);
  }
  return out;
}
