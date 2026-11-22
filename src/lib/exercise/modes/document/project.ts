// Document TTX projection: what one viewer may see. Pure.
//
// Everyone in the exercise: modules (scenario update, key issues, questions),
// every entry with its status, and the debrief counts.
// Control only: rationale, source excerpt, expected actions, evaluator grades,
// unanswered questions and the grade summary.
// Never in any projection: rubric criteria and model answers (they are not in
// the view at all).

import type { ExerciseView, GradeRow, InjectRow, Viewer } from "@/lib/exercise/runtime/types";
import { baseProjection, injectHeader, visibleInjects } from "@/lib/exercise/modes/shared/project-base";
import {
  ENTRY_TYPES,
  GRADED_ENTRY_TYPES,
  moduleContentSchema,
  moduleSecretSchema,
  type EntryPayload,
  type ExerciseConfig,
  type ModuleContent,
} from "./schema";

function readContent(i: InjectRow): ModuleContent | null {
  const r = moduleContentSchema.safeParse(i.content);
  return r.success ? r.data : null;
}

/** Latest grade per response. Every grade is an evaluator's. */
export function effectiveGradeMap(grades: GradeRow[]): Map<string, GradeRow> {
  const out = new Map<string, GradeRow>();
  const sorted = [...grades].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const g of sorted) out.set(g.responseId, g);
  return out;
}

function gradeOut(g: GradeRow | null) {
  if (!g) return null;
  return { id: g.id, source: g.source, attempt: g.attempt, score: g.score, rating: g.rating, rationale: g.rationale, at: g.createdAt };
}

export function projectDocument(view: ExerciseView<ExerciseConfig>, viewer: Viewer, c: ExerciseConfig) {
  const base = baseProjection(view, viewer);
  const me = viewer.participant;
  const control = viewer.isControl;
  const canPost =
    Boolean(me) &&
    (c.scribeMode
      ? Boolean(me?.roles.includes("scribe") || control)
      : Boolean(me && (me.roles.includes("player") || me.roles.includes("scribe") || control)));
  const nameById = new Map(view.participants.map((p) => [p.id, p.displayName]));
  const effective = control ? effectiveGradeMap(view.grades) : new Map<string, GradeRow>();

  const injects = visibleInjects(view, viewer).map((i) => {
    const content = readContent(i);
    const questions = content?.questions ?? [];
    const entries = view.responses
      .filter((r) => r.injectId === i.id && r.kind === "entry")
      .map((r) => {
        const p = r.payload as EntryPayload;
        const row = {
          id: r.id,
          type: p.type,
          text: p.text,
          questionKey: p.questionKey ?? null,
          severity: p.severity ?? null,
          docSectionRef: p.docSectionRef ?? null,
          speakerRole: p.speakerRole ?? null,
          status: r.status,
          by: nameById.get(r.participantId) ?? "Participant",
          mine: me ? r.participantId === me.id : false,
          createdAt: r.createdAt,
        };
        if (!control) return row;
        return {
          ...row,
          graded: Boolean(p.questionKey) && GRADED_ENTRY_TYPES.includes(p.type),
          grade: gradeOut(effective.get(r.id) ?? null),
        };
      });
    const answered = new Set(entries.filter((e) => e.questionKey && e.status !== "denied").map((e) => e.questionKey as string));
    return {
      ...injectHeader(i),
      scenarioUpdate: content?.scenarioUpdate ?? "",
      keyIssues: content?.keyIssues ?? [],
      docSectionRefs: content?.docSectionRefs ?? [],
      questions: questions.map((q) => ({ key: q.key, text: q.text, category: q.category, docSectionRefs: q.docSectionRefs, answered: answered.has(q.key) })),
      entries,
      ...(control
        ? {
            control: {
              rationale: content?.rationale ?? null,
              sourceExcerpt: content?.sourceExcerpt ?? null,
              expectedActions: moduleSecretSchema.safeParse(i.secret).data?.expectedActions ?? [],
              unanswered: questions.filter((q) => !answered.has(q.key)).map((q) => q.key),
              capabilityKeys: Object.fromEntries(questions.map((q) => [q.key, q.capabilityKeys])),
              objectiveKeys: Object.fromEntries(questions.map((q) => [q.key, q.objectiveKeys])),
            },
          }
        : {}),
    };
  });

  const sections = view.document?.sections ?? [];
  return {
    ...base,
    config: { scribeMode: c.scribeMode, moduleMinutes: c.moduleMinutes },
    canPost,
    canModerate: control,
    canGrade: control,
    document: view.document
      ? { id: view.document.id, title: view.document.title, kind: view.document.kind, sections: sections.map((s) => ({ id: s.id, heading: s.heading, level: s.level })) }
      : null,
    modulesTotal: view.template?.injects.length ?? null,
    injects,
    current: view.exercise.currentInjectId,
    debrief: buildDebrief(injects, control),
  };
}

type ProjectedInject = {
  id: string;
  seq: number;
  title: string;
  status: string;
  questions: Array<{ key: string; text: string; answered: boolean }>;
  entries: Array<{
    id: string;
    type: string;
    status: string;
    questionKey: string | null;
    severity: string | null;
    docSectionRef: string | null;
    text: string;
    grade?: { score: number | null; rating: string | null } | null;
  }>;
};

/** Per module counts; grade summaries for control. */
export function buildDebrief(injects: ProjectedInject[], control: boolean) {
  const modules = injects
    .filter((i) => i.status === "closed" || i.status === "open")
    .map((i) => {
      const live = i.entries.filter((e) => e.status !== "denied");
      const byType = Object.fromEntries(ENTRY_TYPES.map((t) => [t, live.filter((e) => e.type === t).length]));
      return {
        injectId: i.id,
        seq: i.seq,
        title: i.title,
        byType,
        answered: i.questions.filter((q) => q.answered).map((q) => q.key),
        unanswered: i.questions.filter((q) => !q.answered).map((q) => q.key),
        gaps: live
          .filter((e) => e.type === "gap")
          .map((e) => ({ id: e.id, text: e.text, severity: e.severity, docSectionRef: e.docSectionRef })),
        questions: control
          ? i.questions.map((q) => {
              const graded = live.filter((e) => e.questionKey === q.key && e.grade && typeof e.grade.score === "number");
              const scores = graded.map((e) => e.grade!.score as number);
              return {
                key: q.key,
                text: q.text,
                entries: live.filter((e) => e.questionKey === q.key).length,
                graded: graded.length,
                avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
                ratings: {
                  met: graded.filter((e) => e.grade!.rating === "met").length,
                  partially_met: graded.filter((e) => e.grade!.rating === "partially_met").length,
                  not_met: graded.filter((e) => e.grade!.rating === "not_met").length,
                },
              };
            })
          : undefined,
      };
    });
  return { modules };
}
