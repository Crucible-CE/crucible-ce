// Document TTX mode. The facilitator walks modules built from a source
// document. Participants or scribes post entries; the facilitator confirms or
// denies them. Entries that cite a question are graded against its rubric in
// the background (jobsAfterClose). No score state: the output is the
// observation record, ratings and AFIs.

import type {
  CloseOutcome,
  CloseSnapshot,
  EndReason,
  ExerciseMode,
  ExerciseSnapshot,
  ExerciseView,
  InjectDraft,
  InjectRow,
  JobSpec,
  PlanInput,
  RequiredResponders,
  ResponseInput,
  ValidatedResponse,
  Viewer,
} from "@/lib/exercise/runtime/types";
import { CONTROL_ROLES, ResponseError } from "@/lib/exercise/runtime/types";
import { timeboxReached } from "@/lib/exercise/modes/shared/timebox";
import { projectDocument } from "./project";
import { nextTemplateInject } from "@/lib/exercise/modes/shared/branching";
import {
  entryInputSchema,
  exerciseConfigSchema,
  moduleContentSchema,
  moduleSecretSchema,
  type EntryPayload,
  type ExerciseConfig,
  type ModuleContent,
} from "./schema";

function cfg(s: { config: unknown }): ExerciseConfig {
  return exerciseConfigSchema.parse(s.config ?? {});
}

function readContent(i: InjectRow): ModuleContent | null {
  const r = moduleContentSchema.safeParse(i.content);
  return r.success ? r.data : null;
}

export const documentMode: ExerciseMode<ExerciseConfig> = {
  key: "document",
  label: "Playbook Exercise",
  version: 1,
  caps: { teams: false, teamVariants: false, advance: ["facilitator", "timer"], controllerHold: false },
  configSchema: exerciseConfigSchema,
  injectContentSchema: moduleContentSchema,
  injectSecretSchema: moduleSecretSchema,
  defaultAdvancePolicy: "facilitator",

  initialScore() {
    return null;
  },

  async planInject(input: PlanInput<ExerciseConfig>): Promise<InjectDraft | null> {
    const s = input.snapshot;
    if (!s.template) throw new Error("Prepare the document before starting.");
    const ti = nextTemplateInject(s, input.lastClose);
    if (!ti) return null;
    const content = moduleContentSchema.parse(ti.content);
    const secret = moduleSecretSchema.parse(ti.secret ?? {});
    const c = cfg(s);
    const minutes = ti.plannedDelayMin ?? c.moduleMinutes;
    return {
      title: ti.title,
      source: "module",
      scenarioTime: s.exercise.scenarioStartAt
        ? new Date(s.exercise.scenarioStartAt.getTime() + ti.scenarioOffsetMin * 60_000)
        : null,
      targetTeamIds: [],
      content,
      secret,
      templateInjectId: ti.id,
      budgetMs: s.exercise.advancePolicy === "timer" && minutes ? minutes * 60_000 : null,
    };
  },

  validateResponse(input: ResponseInput<ExerciseConfig>): ValidatedResponse {
    const { snapshot: s, inject, participant: p, kind, raw } = input;
    if (kind !== "entry") throw new ResponseError(400, "Playbook Exercise takes entries only.");
    const c = cfg(s);
    const isControl = p.roles.some((r) => CONTROL_ROLES.includes(r));
    const isScribe = p.roles.includes("scribe");
    const isPlayer = p.roles.includes("player");
    if (c.scribeMode ? !(isScribe || isControl) : !(isScribe || isControl || isPlayer)) {
      throw new ResponseError(403, c.scribeMode ? "Only scribes post entries in this exercise." : "Observers cannot post entries.");
    }
    const parsed = entryInputSchema.safeParse(raw);
    if (!parsed.success) throw new ResponseError(400, "Write the entry and pick a type.");
    const content = readContent(inject);
    if (parsed.data.questionKey && !content?.questions.some((q) => q.key === parsed.data.questionKey)) {
      throw new ResponseError(400, "That question is not in this module.");
    }
    const payload: EntryPayload = { ...parsed.data, byRoles: p.roles };
    return { kind: "entry", teamId: p.teamId, payload: payload as unknown as Record<string, unknown> };
  },

  requiredResponders(): RequiredResponders {
    return { by: "none", ids: [] };
  },

  scoreClose(s: CloseSnapshot<ExerciseConfig>): CloseOutcome {
    const entries = s.responses.filter((r) => r.kind === "entry");
    const byType: Record<string, number> = {};
    const answered = new Set<string>();
    for (const e of entries) {
      const p = e.payload as EntryPayload;
      byType[p.type] = (byType[p.type] ?? 0) + 1;
      if (p.questionKey) answered.add(p.questionKey);
    }
    const content = readContent(s.inject);
    const unanswered = (content?.questions ?? []).filter((q) => !answered.has(q.key)).map((q) => q.key);
    return {
      score: null,
      abstains: [],
      responseUpdates: [],
      events: unanswered.length ? [{ type: "questions_unanswered", data: { keys: unanswered } }] : [],
      summary: { entries: entries.length, byType, answered: [...answered], unanswered },
    };
  },

  // Evaluators grade entries by hand against the rubric. No follow-up jobs.
  jobsAfterClose(): JobSpec[] {
    return [];
  },

  checkEnd(s: ExerciseSnapshot<ExerciseConfig>, now: Date): EndReason | null {
    const ex = s.exercise;
    if (timeboxReached(ex, now)) return "timebox";
    // Modules end only when the facilitator advances past the last one (planInject returns null).
    return null;
  },

  project(view: ExerciseView<ExerciseConfig>, viewer: Viewer) {
    return projectDocument(view, viewer, cfg(view));
  },
};
