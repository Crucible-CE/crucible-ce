// Strategic TTX mode. See schema.ts for the model.

import type {
  CloseOutcome,
  CloseSnapshot,
  EndReason,
  ExerciseMode,
  ExerciseSnapshot,
  ExerciseView,
  InjectDraft,
  JobSpec,
  ParticipantRow,
  PlanInput,
  RequiredResponders,
  ResponseInput,
  ValidatedResponse,
  Viewer,
} from "@/lib/exercise/runtime/types";
import { ResponseError } from "@/lib/exercise/runtime/types";
import { timeboxReached } from "@/lib/exercise/modes/shared/timebox";
import { baseProjection, injectHeader, teamTargeted, visibleInjects } from "@/lib/exercise/modes/shared/project-base";
import { nextTemplateInject } from "@/lib/exercise/modes/shared/branching";
import {
  answerInputSchema,
  exerciseConfigSchema,
  injectContentSchema,
  injectSecretSchema,
  templateInjectContentSchema,
  type AnswerPayload,
  type ExerciseConfig,
  type InjectContent,
} from "./schema";
import { activeTeamIds, effectiveGrade, readContent } from "./rules";

export { activeTeamIds, effectiveGrade, readContent };

function cfg(s: { config: unknown }): ExerciseConfig {
  return exerciseConfigSchema.parse(s.config ?? {});
}

export const strategicMode: ExerciseMode<ExerciseConfig> = {
  key: "strategic",
  label: "Strategic TTX",
  version: 1,
  caps: { teams: true, teamVariants: true, advance: ["facilitator", "all_teams", "timer"], controllerHold: true },
  configSchema: exerciseConfigSchema,
  injectContentSchema,
  injectSecretSchema,
  defaultAdvancePolicy: "facilitator",

  initialScore() {
    return { path: null, cumulative: 0, teamScores: {} };
  },

  async planInject(input: PlanInput<ExerciseConfig>): Promise<InjectDraft | null> {
    const s = input.snapshot;
    const c = cfg(s);
    if (!s.template) return null;
    const teamIdByName = new Map(s.teams.map((t) => [t.name, t.id]));
    const budgetMs = s.exercise.advancePolicy === "timer" && c.injectMinutes ? c.injectMinutes * 60_000 : null;

    // Scripted injects from the template (scripted MSEL, linear or branched).
    const ti = nextTemplateInject(s, branchClose(input));
    if (!ti) return null;
    const content = templateInjectContentSchema.parse(ti.content);
    const secret = injectSecretSchema.parse(ti.secret ?? {});
    const variants = content.teamVariants.map((v) => ({ ...v, teamId: teamIdByName.get(v.team) ?? null }));
    const targetTeamIds = variants.length
      ? variants.map((v) => v.teamId).filter((x): x is string => Boolean(x))
      : ti.targetTeams.map((n) => teamIdByName.get(n)).filter((x): x is string => Boolean(x));
    return {
      title: ti.title,
      source: "template",
      scenarioTime: s.exercise.scenarioStartAt ? new Date(s.exercise.scenarioStartAt.getTime() + ti.scenarioOffsetMin * 60_000) : null,
      targetTeamIds,
      content: { ...content, teamVariants: variants, contingency: false } satisfies InjectContent,
      secret,
      templateInjectId: ti.id,
      budgetMs: ti.plannedDelayMin ? ti.plannedDelayMin * 60_000 : budgetMs,
    };
  },

  validateResponse(input: ResponseInput<ExerciseConfig>): ValidatedResponse {
    const { snapshot: s, inject, participant: p, kind, raw, existing } = input;
    if (kind !== "answer") throw new ResponseError(400, "Strategic TTX takes team answers only.");
    if (!p.teamId) throw new ResponseError(403, "Join a team to answer.");
    if (!activeTeamIds(s, inject).includes(p.teamId)) throw new ResponseError(403, "Your team is on standby for this inject.");
    const teamHasDecisionMaker = s.participants.some((x) => x.teamId === p.teamId && x.isDecisionMaker && !x.removedAt);
    const allowed = teamHasDecisionMaker
      ? p.isDecisionMaker || p.roles.includes("scribe")
      : p.roles.includes("player") || p.roles.includes("scribe");
    if (!allowed) throw new ResponseError(403, "Your team's decision maker or scribe submits the answer.");
    const parsed = answerInputSchema.safeParse(raw);
    if (!parsed.success) throw new ResponseError(400, "Write the team's answer before submitting.");
    const prev = existing.find((r) => r.kind === "answer" && r.teamId === p.teamId);
    const payload: AnswerPayload = { ...parsed.data, byParticipantId: p.id, byRoles: p.roles };
    return { kind: "answer", teamId: p.teamId, payload: payload as unknown as Record<string, unknown>, replaceId: prev?.id ?? null };
  },

  requiredResponders(s, inject): RequiredResponders {
    return { by: "team", ids: activeTeamIds(s, inject) };
  },

  scoreClose(s: CloseSnapshot<ExerciseConfig>): CloseOutcome {
    const required = activeTeamIds(s, s.inject);
    const answers = s.responses.filter((r) => r.kind === "answer");
    const answered = new Set(answers.map((a) => a.teamId).filter(Boolean) as string[]);
    const name = new Map(s.teams.map((t) => [t.id, t.name]));
    const missing = required.filter((id) => !answered.has(id));
    return {
      score: null,
      abstains: [],
      responseUpdates: [],
      events: missing.length ? [{ type: "teams_no_answer", data: { teams: missing.map((id) => name.get(id) ?? id) } }] : [],
      summary: {
        answeredTeams: [...answered].map((id) => name.get(id) ?? id),
        missingTeams: missing.map((id) => name.get(id) ?? id),
      },
      clockUpdates: injectSecretSchema.safeParse(s.inject.secret ?? {}).data?.clockUpdates ?? [],
    };
  },

  // Evaluators grade answers by hand. No follow-up jobs.
  jobsAfterClose(): JobSpec[] {
    return [];
  },

  checkEnd(s: ExerciseSnapshot<ExerciseConfig>, now: Date): EndReason | null {
    const ex = s.exercise;
    if (timeboxReached(ex, now)) return "timebox";
    return null;
  },

  project(view: ExerciseView<ExerciseConfig>, viewer: Viewer) {
    const c = cfg(view);
    const base = baseProjection(view, viewer);
    const me = viewer.participant;
    const myTeam = me?.teamId ?? null;
    const name = new Map(view.teams.map((t) => [t.id, t.name]));
    const display = new Map(view.participants.map((p) => [p.id, p.displayName]));
    const teamHasDm = (teamId: string) => view.participants.some((x) => x.teamId === teamId && x.isDecisionMaker && !x.removedAt);
    const maySubmit = (p: ParticipantRow, teamId: string) =>
      teamHasDm(teamId) ? p.isDecisionMaker || p.roles.includes("scribe") : p.roles.includes("player") || p.roles.includes("scribe");

    const injects = visibleInjects(view, viewer)
      // A contingency inject sent to some teams stays hidden from the others.
      .filter((i) => viewer.isControl || !readContent(i)?.contingency || teamTargeted(i, myTeam))
      .map((i) => {
        const content = readContent(i);
        const variants = content?.teamVariants ?? [];
        const answers = view.responses.filter((r) => r.injectId === i.id && r.kind === "answer");
        const myAnswer = myTeam ? answers.find((a) => a.teamId === myTeam) : undefined;
        const active = activeTeamIds(view, i);

        const out: Record<string, unknown> = {
          ...injectHeader(i),
          phase: content?.phase ?? "main",
          contingency: content?.contingency ?? false,
          narrativeMd: content?.narrativeMd ?? "",
          artifacts: content?.artifacts ?? [],
          // Players see only their own team's variant. Control sees all.
          myVariant: !viewer.isControl && myTeam ? (variants.find((v) => v.teamId === myTeam) ?? null) : null,
          variants: viewer.isControl ? variants : undefined,
          myAnswer: myAnswer
            ? {
                text: (myAnswer.payload as AnswerPayload).text,
                byQuestion: (myAnswer.payload as AnswerPayload).byQuestion ?? null,
                updatedAt: myAnswer.createdAt,
                by: display.get(myAnswer.participantId) ?? null,
              }
            : null,
          canAnswer: i.status === "open" && Boolean(me && myTeam && active.includes(myTeam) && maySubmit(me, myTeam)),
          progress: { answered: answers.filter((a) => a.teamId && active.includes(a.teamId)).length, required: active.length },
        };

        if (viewer.isControl) {
          const secret = injectSecretSchema.safeParse(i.secret ?? {}).data;
          out.control = {
            expectedActions: secret?.expectedActions ?? {},
            gradingNotes: secret?.gradingNotes ?? null,
            mitreTags: secret?.mitreTags ?? [],
            capabilityKeys: secret?.capabilityKeys ?? [],
            activeTeamIds: active,
            answers: answers.map((a) => {
              const grades = view.grades.filter((g) => g.responseId === a.id);
              const eff = effectiveGrade(grades);
              return {
                responseId: a.id,
                teamId: a.teamId,
                team: a.teamId ? (name.get(a.teamId) ?? null) : null,
                text: (a.payload as AnswerPayload).text,
                byQuestion: (a.payload as AnswerPayload).byQuestion ?? null,
                by: display.get(a.participantId) ?? null,
                updatedAt: a.createdAt,
                grades,
                effective: eff ? { source: eff.source, score: eff.score, rating: eff.rating, rationale: eff.rationale } : null,
              };
            }),
            waitingOn: i.status === "open" ? active.filter((id) => !answers.some((a) => a.teamId === id)).map((id) => name.get(id) ?? id) : [],
          };
        }
        return out;
      });

    // Who on the viewer's team may submit, so the others know whom to brief.
    const submitters =
      myTeam && !viewer.isControl
        ? view.participants.filter((p) => !p.removedAt && p.teamId === myTeam && maySubmit(p, myTeam)).map((p) => p.displayName)
        : [];

    return {
      ...base,
      config: {
        source: c.source,
        winCondition: c.winCondition,
        injectMinutes: c.injectMinutes,
        scenarioTitle: c.scenario.title,
        domain: c.scenario.domain,
        crisisType: viewer.isControl ? c.scenario.crisisType : null,
      },
      injects,
      current: view.exercise.currentInjectId,
      submitters,
    };
  },
};

/**
 * The close summary branch conditions read. When a contingency inject closed
 * after the last template inject, the runtime's lastClose is the contingency;
 * rebuild the template inject's outcomes from history instead.
 */
export function branchClose(input: Pick<PlanInput, "snapshot" | "lastClose" | "history">): PlanInput["lastClose"] {
  const lastTemplate = [...input.snapshot.injects]
    .filter((i) => i.templateInjectId && i.status !== "pending")
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
  if (!lastTemplate || input.lastClose?.injectId === lastTemplate.id) return input.lastClose;
  const h = input.history.find((x) => x.injectId === lastTemplate.id);
  if (!h) return input.lastClose;
  const summary: Record<string, unknown> = {};
  const scores = h.responses.map((r) => r.score).filter((x): x is number => typeof x === "number");
  if (scores.length) summary.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const outcomes: Record<string, string> = {};
  for (const r of h.responses) if (r.teamName && r.rating) outcomes[r.teamName] = r.rating;
  if (Object.keys(outcomes).length) summary.outcomes = outcomes;
  return { injectId: lastTemplate.id, summary };
}

