// Crisis Sim mode. Shared narrative per inject, one 4-option question per team,
// individual votes, hidden per-path quality, paths that move both ways.
//
// Crisis Sim mechanics:
//   Scoring    each team's average vote quality (abstains count 0) counts once
//              per inject; the inject delta is the sum of team averages,
//              rounded to one decimal. Every vote is a recommendation.
//   Decision   the team's decision is its decision maker's vote; without one,
//              the team majority; a tie is no decision (no clock effects, no
//              follow-ups).
//   Reveal     after close players see their own team's split (revealSplit);
//              the intended best option and rationale wait for the debrief
//              unless revealBest is on.
//   Clocks     inject clockTriggers start when the inject opens (applied at its
//              scenario time); options only meet clocks, except sec_8k and
//              ransom payment clocks.

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
  ParticipantRow,
  PlanInput,
  RequiredResponders,
  ResponseInput,
  ResponseRow,
  ScoreRow,
  ValidatedResponse,
  Viewer,
} from "@/lib/exercise/runtime/types";
import { ResponseError } from "@/lib/exercise/runtime/types";
import { computeClockDeadline } from "@/lib/exercise/content/regulatory-clocks";
import { timeboxReached } from "@/lib/exercise/modes/shared/timebox";
import { baseProjection, injectHeader, teamTargeted, visibleInjects } from "@/lib/exercise/modes/shared/project-base";
import {
  DEFAULT_THRESHOLDS,
  PATH_LABELS,
  QUALITY_SCORES,
  deliverableInputSchema,
  exerciseConfigSchema,
  injectContentSchema,
  injectSecretSchema,
  pathFor,
  round1,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  templateConfigSchema,
  voteInputSchema,
  type ExerciseConfig,
  type InjectContent,
  type InjectSecret,
  type PathKey,
  type Quality,
  type VotePayload,
} from "./schema";
import { bestOptionIds } from "./validate";

type Snap = ExerciseSnapshot<ExerciseConfig>;

function cfg(s: { config: unknown }): ExerciseConfig {
  return exerciseConfigSchema.parse(s.config ?? {});
}

function currentPath(s: Snap): PathKey {
  return (s.score?.path as PathKey | null) ?? cfg(s).initialPath;
}

function readContent(i: InjectRow): InjectContent | null {
  const r = injectContentSchema.safeParse(i.content);
  return r.success ? r.data : null;
}

function readSecret(i: InjectRow): InjectSecret | null {
  const r = injectSecretSchema.safeParse(i.secret);
  return r.success ? r.data : null;
}

function teamName(s: Pick<Snap, "teams">, teamId: string | null): string | null {
  return teamId ? (s.teams.find((t) => t.id === teamId)?.name ?? null) : null;
}

/** Players who must vote: active, player role, on a targeted team. */
export function requiredVoters(s: Snap, inject: InjectRow): ParticipantRow[] {
  return s.participants.filter(
    (p) => !p.removedAt && p.roles.includes("player") && p.teamId !== null && teamTargeted(inject, p.teamId),
  );
}

/** The team's decision maker, if one is set. */
export function decisionMakerOf(participants: ParticipantRow[], teamId: string | null): ParticipantRow | null {
  if (!teamId) return null;
  return participants.find((p) => !p.removedAt && p.teamId === teamId && p.isDecisionMaker) ?? null;
}

/** Template injects already delivered (contingency injects do not count). */
function deliveredTemplateCount(s: Snap): number {
  return s.injects.filter((i) => i.templateInjectId && (i.status === "open" || i.status === "closed" || i.status === "held")).length;
}

export type DecisionSource = "owner" | "majority" | "tie" | "none";
export interface TeamDecision {
  optionId: string | null;
  source: DecisionSource;
}

/**
 * The team's decision. The decision maker's vote decides; without a decision
 * maker or a vote from them, the majority; a tie or no votes is no decision.
 */
export function decideTeam(votes: Array<{ participantId: string; optionId: string | null }>, deciderId: string | null): TeamDecision {
  const cast = votes.filter((v): v is { participantId: string; optionId: string } => Boolean(v.optionId));
  const own = deciderId ? cast.find((v) => v.participantId === deciderId) : undefined;
  if (own) return { optionId: own.optionId, source: "owner" };
  if (cast.length === 0) return { optionId: null, source: "none" };
  const counts = new Map<string, number>();
  for (const v of cast) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return { optionId: null, source: "tie" };
  return { optionId: ranked[0][0], source: "majority" };
}

function voteOf(r: ResponseRow): VotePayload {
  return (r.payload ?? {}) as VotePayload;
}

/** Decisions per team for a set of vote rows (open or closed). */
function decisionsFor(
  s: Pick<Snap, "teams" | "participants">,
  content: InjectContent | null,
  votes: ResponseRow[],
): Record<string, TeamDecision> {
  const out: Record<string, TeamDecision> = {};
  for (const q of content?.questions ?? []) {
    const teamVotes = votes
      .filter((v) => teamName(s, v.teamId) === q.team && !voteOf(v).abstain)
      .map((v) => ({ participantId: v.participantId, optionId: voteOf(v).optionId ?? null }));
    const dm = decisionMakerOf(s.participants, q.teamId);
    out[q.team] = decideTeam(teamVotes, dm?.id ?? null);
  }
  return out;
}

/** Intended best option per team at a path. */
function bestFor(content: InjectContent | null, secret: InjectSecret | null, path: PathKey): Record<string, string | null> {
  const best: Record<string, string | null> = {};
  for (const q of content?.questions ?? []) {
    best[q.team] = bestOptionIds(q.options, secret?.quality?.[q.team] ?? {}, path)[0] ?? null;
  }
  return best;
}

export const crisisSimMode: ExerciseMode<ExerciseConfig> = {
  key: "crisissim",
  label: "Crisis Sim",
  version: 2,
  caps: { teams: true, teamVariants: true, advance: ["votes_in", "timer", "facilitator"], controllerHold: false },
  configSchema: exerciseConfigSchema,
  injectContentSchema,
  injectSecretSchema,
  defaultAdvancePolicy: "votes_in",

  initialScore(s): ScoreRow {
    return { path: cfg(s).initialPath, cumulative: 0, teamScores: {} };
  },

  async planInject(input: PlanInput<ExerciseConfig>): Promise<InjectDraft | null> {
    const s = input.snapshot;
    const t = s.template;
    if (!t) throw new Error("Crisis Sim needs a template.");
    const nextIndex = deliveredTemplateCount(s);
    const ti = t.injects[nextIndex];
    if (!ti) return null;
    if (s.exercise.injectBudget && nextIndex >= s.exercise.injectBudget) return null;

    const content = templateInjectContentSchema.parse(ti.content);
    const secret = templateInjectSecretSchema.parse(ti.secret);
    const path = currentPath(s);
    const variant = content.variants[path];

    // Follow-up lines from the previous inject's team decisions. A tie or no
    // decision has no follow-up.
    const followUps: Array<{ team: string; text: string }> = [];
    const prev = [...s.injects].reverse().find((i) => i.status === "closed" && i.templateInjectId);
    const summary = input.lastClose?.summary ?? {};
    const decided = (summary.decisions ?? null) as Record<string, TeamDecision> | null;
    const byTeam: Record<string, string | null> = decided
      ? Object.fromEntries(Object.entries(decided).map(([team, d]) => [team, d?.optionId ?? null]))
      : ((summary.majority ?? {}) as Record<string, string | null>);
    if (prev) {
      const prevSecret = readSecret(prev);
      for (const [team, optionId] of Object.entries(byTeam)) {
        const line = optionId ? prevSecret?.followUps?.[team]?.[optionId] : undefined;
        if (line) followUps.push({ team, text: line });
      }
    }

    const teamIdByName = new Map(s.teams.map((tm) => [tm.name, tm.id]));
    const targetTeamIds = ti.targetTeams.map((n) => teamIdByName.get(n)).filter((x): x is string => Boolean(x));
    const questions = content.questions
      .filter((q) => ti.targetTeams.length === 0 || ti.targetTeams.includes(q.team))
      .map((q) => ({ ...q, teamId: teamIdByName.get(q.team) ?? null }));

    const c = cfg(s);
    const injectCount = s.exercise.injectBudget ? Math.min(s.exercise.injectBudget, t.injects.length) : t.injects.length;
    const budgetMs = ti.plannedDelayMin
      ? ti.plannedDelayMin * 60_000
      : Math.round((c.targetDurationMin * 60_000) / Math.max(1, injectCount));
    const scenarioTime = s.exercise.scenarioStartAt
      ? new Date(s.exercise.scenarioStartAt.getTime() + ti.scenarioOffsetMin * 60_000)
      : null;

    const injectContent: InjectContent = {
      schemaVersion: 1,
      path,
      narrativeMd: variant.narrativeMd,
      consequenceText: variant.consequenceText,
      followUps,
      artifacts: variant.artifacts,
      questions,
      deliverable: content.deliverable
        ? { ...content.deliverable, teamId: teamIdByName.get(content.deliverable.team) ?? null }
        : undefined,
    };
    const injectSecret: InjectSecret = {
      schemaVersion: 1,
      quality: secret.quality,
      followUps: secret.followUps,
      clockEffects: secret.clockEffects,
      deliverableCriteria: secret.deliverableCriteria,
      rationales: secret.rationales,
      clockTriggers: [...new Set([...secret.clockTriggers, ...(secret.clockTriggersByPath[path] ?? [])])],
      attackTechniques: secret.attackTechniques,
    };
    return {
      title: ti.title,
      source: "template",
      scenarioTime,
      targetTeamIds,
      content: injectContent,
      secret: injectSecret,
      templateInjectId: ti.id,
      budgetMs,
    };
  },

  validateResponse(input: ResponseInput<ExerciseConfig>): ValidatedResponse {
    const { snapshot: s, inject, participant: p, kind, raw, existing } = input;
    if (!p.roles.includes("player") || !p.teamId) throw new ResponseError(403, "Only players on a team can respond.");
    if (!teamTargeted(inject, p.teamId)) throw new ResponseError(403, "Your team is not part of this update.");
    const content = readContent(inject);
    if (!content) throw new ResponseError(500, "Update content is invalid.");

    if (kind === "vote") {
      const v = voteInputSchema.safeParse(raw);
      if (!v.success) throw new ResponseError(400, "Pick one option.");
      const q = content.questions.find((x) => x.teamId === p.teamId);
      if (!q) throw new ResponseError(400, "There is no question for your team.");
      if (!q.options.some((o) => o.id === v.data.optionId)) throw new ResponseError(400, "That option does not exist.");
      const mine = existing.find((r) => r.kind === "vote" && r.participantId === p.id);
      const payload: VotePayload = { optionId: v.data.optionId, comment: v.data.comment, pathAtVote: currentPath(s) };
      return { kind: "vote", teamId: p.teamId, payload: payload as unknown as Record<string, unknown>, replaceId: mine?.id ?? null };
    }

    if (kind === "deliverable") {
      if (!content.deliverable || content.deliverable.teamId !== p.teamId) {
        throw new ResponseError(400, "There is no written task for your team.");
      }
      const d = deliverableInputSchema.safeParse(raw);
      if (!d.success) throw new ResponseError(400, "Write the response before submitting.");
      // One deliverable per team per inject (partial unique index); later submissions replace it.
      const teamRow = existing.find((r) => r.kind === "deliverable" && r.teamId === p.teamId);
      return { kind: "deliverable", teamId: p.teamId, payload: { text: d.data.text, kind: content.deliverable.kind }, replaceId: teamRow?.id ?? null };
    }

    throw new ResponseError(400, "This response type is not used in Crisis Sim.");
  },

  requiredResponders(s, inject): RequiredResponders {
    return { by: "participant", ids: requiredVoters(s as Snap, inject).map((p) => p.id) };
  },

  scoreClose(s: CloseSnapshot<ExerciseConfig>): CloseOutcome {
    const c = cfg(s);
    const thresholds = c.pathThresholds ?? DEFAULT_THRESHOLDS;
    const pathAtClose = currentPath(s);
    const content = readContent(s.inject);
    const secret = readSecret(s.inject);
    const quality = secret?.quality ?? {};

    const votes = s.responses.filter((r) => r.kind === "vote" && !voteOf(r).abstain);
    const voted = new Set(votes.map((v) => v.participantId));
    const required = requiredVoters(s, s.inject);
    const abstainers = required.filter((p) => !voted.has(p.id));

    const responseUpdates: CloseOutcome["responseUpdates"] = [];
    const distribution: Record<string, Record<string, number>> = {};
    // Per team: sum of vote deltas and voter count (abstainers count as 0).
    const teamTotals: Record<string, { sum: number; n: number }> = {};

    for (const v of votes) {
      const payload = voteOf(v);
      const team = teamName(s, v.teamId) ?? "unknown";
      let q: Quality = "neutral";
      if (payload.optionId) {
        const rating = quality[team]?.[payload.optionId]?.[pathAtClose];
        if (rating) q = rating;
        distribution[team] ??= {};
        distribution[team][payload.optionId] = (distribution[team][payload.optionId] ?? 0) + 1;
      }
      const d = QUALITY_SCORES[q];
      teamTotals[team] ??= { sum: 0, n: 0 };
      teamTotals[team].sum += d;
      teamTotals[team].n += 1;
      const decider = decisionMakerOf(s.participants, v.teamId)?.id === v.participantId;
      responseUpdates.push({ responseId: v.id, payloadPatch: { quality: q, delta: d, pathAtClose, ...(decider ? { decider: true } : {}) } });
    }
    for (const p of abstainers) {
      const team = teamName(s, p.teamId) ?? "unknown";
      teamTotals[team] ??= { sum: 0, n: 0 };
      teamTotals[team].n += 1;
    }

    const abstains = abstainers.map((p) => ({
      participantId: p.id,
      teamId: p.teamId,
      payload: { optionId: null, abstain: true, pathAtVote: pathAtClose, quality: "neutral", delta: 0 } as Record<string, unknown>,
    }));

    const teamAverages: Record<string, number> = {};
    for (const [team, t] of Object.entries(teamTotals)) teamAverages[team] = t.n > 0 ? t.sum / t.n : 0;
    const delta = round1(Object.values(teamAverages).reduce((a, b) => a + b, 0));
    const before = s.score?.cumulative ?? 0;
    const after = round1(before + delta);
    const newPath = pathFor(after, thresholds);
    const shifted = newPath !== pathAtClose;

    const decisions = decisionsFor(s, content, votes);
    const majority: Record<string, string | null> = Object.fromEntries(Object.entries(decisions).map(([team, d]) => [team, d.optionId]));
    const best = bestFor(content, secret, pathAtClose);

    // Inject triggers first (they start when the inject opened), then the effects of team decisions.
    const clockUpdates: NonNullable<CloseOutcome["clockUpdates"]> = [];
    for (const key of secret?.clockTriggers ?? []) clockUpdates.push({ key, action: "trigger" });
    for (const [team, d] of Object.entries(decisions)) {
      if (!d.optionId) continue;
      for (const eff of secret?.clockEffects?.[team]?.[d.optionId] ?? []) clockUpdates.push(eff);
    }

    const prevTeams = (s.score?.teamScores ?? {}) as Record<string, { cumulative?: number }>;
    const teamScores: Record<string, unknown> = { ...prevTeams };
    for (const [team, avg] of Object.entries(teamAverages)) {
      teamScores[team] = { cumulative: round1((prevTeams[team]?.cumulative ?? 0) + avg), last: round1(avg) };
    }

    const events: CloseOutcome["events"] = [];
    for (const q of content?.questions ?? []) {
      const d = decisions[q.team];
      const text = q.options.find((o) => o.id === d.optionId)?.text ?? null;
      events.push({
        type: q.type === "materiality" ? "materiality_decision" : "decision",
        data: {
          team: q.team,
          questionType: q.type,
          stem: q.stem,
          decisionOwner: q.decisionOwner ?? null,
          // The team decision (decision maker, else majority; null on a tie).
          majorityOptionId: d.optionId,
          majorityText: text,
          decision: text,
          decisionSource: d.source,
          recommendation: distribution[q.team] ?? {},
          distribution: distribution[q.team] ?? {},
          noVotes: abstainers.filter((p) => teamName(s, p.teamId) === q.team).length,
          clockEffects: d.optionId ? (secret?.clockEffects?.[q.team]?.[d.optionId] ?? []) : [],
          scenarioTime: s.inject.scenarioTime?.toISOString() ?? null,
        },
      });
    }
    if (shifted) {
      events.push({ type: "path_shift", data: { from: pathAtClose, to: newPath, scoreBefore: before, scoreAfter: after, delta } });
    }

    return {
      score: { path: newPath, cumulative: after, teamScores },
      abstains,
      responseUpdates,
      events,
      clockUpdates,
      summary: {
        pathAtClose,
        newPath,
        pathShifted: shifted,
        voteCount: votes.length,
        abstainCount: abstainers.length,
        distribution,
        decisions,
        // Alias of the team decisions, read by branch conditions and older code.
        majority,
        best,
        // Control-only fields. project() never passes the summary through whole.
        teamAverages: Object.fromEntries(Object.entries(teamAverages).map(([k, v]) => [k, round1(v)])),
        scoreBefore: before,
        scoreAfter: after,
        delta,
        clockUpdates,
      },
    };
  },

  jobsAfterClose(s: CloseSnapshot<ExerciseConfig>): JobSpec[] {
    const deliverables = s.responses.filter((r) => r.kind === "deliverable");
    return deliverables.map((r) => ({
      kind: "grade_response",
      key: `grade:${r.id}:1`,
      payload: { responseId: r.id, exerciseId: s.exercise.id, attempt: 1 },
    }));
  },

  checkEnd(s, now): EndReason | null {
    const ex = s.exercise;
    if (timeboxReached(ex, now)) return "timebox";
    const anyActive = s.injects.some((i) => i.status === "open" || i.status === "held" || i.status === "pending");
    if (anyActive) return null;
    const delivered = deliveredTemplateCount(s as Snap);
    if (ex.injectBudget && delivered >= ex.injectBudget) return "budget";
    if (s.template && delivered >= s.template.injects.length) return "template_exhausted";
    return null;
  },

  project(view: ExerciseView<ExerciseConfig>, viewer: Viewer) {
    const c = cfg(view);
    const base = baseProjection(view, viewer);
    const me = viewer.participant;
    const path = currentPath(view);
    const myTeam = teamName(view, me?.teamId ?? null);
    const ended = view.exercise.status === "ended";

    const injects = visibleInjects(view, viewer).map((i) => {
      const content = readContent(i);
      const isOpen = i.status === "open";
      const forMe = viewer.isControl || teamTargeted(i, me?.teamId ?? null);
      const myQuestion = me?.teamId ? content?.questions.find((q) => q.teamId === me.teamId) : undefined;
      const votes = view.responses.filter((r) => r.injectId === i.id && r.kind === "vote");
      const myVote = me ? votes.find((r) => r.participantId === me.id) : undefined;
      const deliverables = view.responses.filter((r) => r.injectId === i.id && r.kind === "deliverable");
      const myDeliverable = me?.teamId ? deliverables.find((r) => r.teamId === me.teamId) : undefined;
      const required = requiredVoters(view, i);
      const closeEvent = view.closeSummaries[i.id];
      const iDecide = Boolean(me?.isDecisionMaker && myQuestion && me.teamId === myQuestion.teamId);
      // Vote progress: control counts every team; a player counts only their own team.
      const ownTeam = (teamId: string | null) => viewer.isControl || (Boolean(me?.teamId) && teamId === me?.teamId);
      const progressVoted = votes.filter((v) => !voteOf(v).abstain && ownTeam(v.teamId)).length;
      const progressRequired = required.filter((p) => ownTeam(p.teamId)).length;

      // Players get nothing of an update that does not target their team.
      const out: Record<string, unknown> = {
        ...injectHeader(i),
        forMyTeam: forMe,
        playedOnPath: content?.path ?? null,
        narrativeMd: forMe ? (content?.narrativeMd ?? "") : "",
        consequenceText: forMe ? (content?.consequenceText ?? null) : null,
        outcomes: !forMe ? [] : viewer.isControl ? (content?.followUps ?? []) : (content?.followUps ?? []).filter((f) => f.team === myTeam),
        artifacts: forMe ? (content?.artifacts ?? []) : [],
        question: viewer.isControl || !forMe ? null : myQuestion ? { ...stripQuestion(myQuestion), iDecide } : null,
        questions: viewer.isControl ? (content?.questions ?? []).map(stripQuestion) : undefined,
        deliverable:
          content?.deliverable && (viewer.isControl || (forMe && content.deliverable.teamId === me?.teamId)) ? content.deliverable : null,
        myDeliverable: myDeliverable
          ? { text: String((myDeliverable.payload as { text?: unknown }).text ?? ""), submittedAt: myDeliverable.createdAt }
          : null,
        myVote: myVote ? { optionId: voteOf(myVote).optionId, comment: voteOf(myVote).comment ?? null, decider: iDecide } : null,
        progress: { voted: progressVoted, required: progressRequired },
      };

      if (i.status === "closed" && closeEvent) {
        const distribution = (closeEvent.distribution ?? {}) as Record<string, Record<string, number>>;
        const best = (closeEvent.best ?? {}) as Record<string, string | null>;
        const decisions = summaryDecisions(closeEvent);
        if (viewer.isControl) {
          out.reveal = { distribution, best, decisions };
        } else if (myTeam && forMe) {
          // Players see only their own team: split and decision when revealSplit,
          // the intended best only when revealBest or after ENDEX.
          const r: Record<string, unknown> = {};
          if (c.revealSplit || ended) {
            r.distribution = { [myTeam]: distribution[myTeam] ?? {} };
            r.decisions = { [myTeam]: decisions[myTeam] ?? { optionId: null, source: "none" } };
          }
          if (c.revealBest || ended) r.best = { [myTeam]: best[myTeam] ?? null };
          if (Object.keys(r).length) out.reveal = r;
        }
      }

      if (viewer.isControl) {
        const secret = readSecret(i);
        const deciders = new Set(
          (content?.questions ?? []).map((q) => decisionMakerOf(view.participants, q.teamId)?.id).filter((x): x is string => Boolean(x)),
        );
        out.control = {
          quality: secret?.quality ?? {},
          clockEffects: secret?.clockEffects ?? {},
          clockTriggers: secret?.clockTriggers ?? [],
          rationales: secret?.rationales ?? {},
          deliverableCriteria: secret?.deliverableCriteria ?? [],
          required: required.map((p) => p.id),
          votes: votes.map((v) => ({
            participantId: v.participantId,
            teamId: v.teamId,
            optionId: voteOf(v).optionId,
            comment: voteOf(v).comment ?? null,
            abstain: Boolean(voteOf(v).abstain),
            decider: deciders.has(v.participantId),
            quality: voteOf(v).quality ?? null,
          })),
          // Live decision while open: the decision maker's vote, else the majority.
          decisions: isOpen ? decisionsFor(view, content, votes) : summaryDecisions(closeEvent ?? {}),
          waitingOn: isOpen ? required.filter((p) => !votes.some((v) => v.participantId === p.id)).map((p) => p.id) : [],
          deliverables: deliverables.map((r) => ({
            responseId: r.id,
            teamId: r.teamId,
            text: String((r.payload as { text?: unknown }).text ?? ""),
            submittedAt: r.createdAt,
            grade: effectiveGrade(view, r.id),
          })),
          summary: closeEvent
            ? {
                scoreBefore: (closeEvent.scoreBefore as number | undefined) ?? null,
                scoreAfter: (closeEvent.scoreAfter as number | undefined) ?? null,
                delta: (closeEvent.delta as number | undefined) ?? null,
                teamAverages: (closeEvent.teamAverages as Record<string, number> | undefined) ?? {},
              }
            : null,
        };
      }
      return out;
    });

    const clocks = withOpenTriggers(view, deriveClocks(view));

    return {
      ...base,
      /** IANA zone for every timestamp. The runtime view may set it from Instance.timezone; UTC otherwise. */
      timezone: viewTimezone(view),
      path: { key: path, label: PATH_LABELS[path] },
      score: viewer.isControl
        ? { cumulative: view.score?.cumulative ?? 0, teamScores: view.score?.teamScores ?? {}, thresholds: c.pathThresholds }
        : undefined,
      config: {
        holdAfterClose: c.holdAfterClose,
        revealSplit: c.revealSplit,
        revealBest: c.revealBest,
        targetDurationMin: c.targetDurationMin,
        ...(viewer.isControl ? { individualMetrics: c.individualMetrics, initialPath: c.initialPath } : {}),
      },
      clocks,
      injects,
      current: view.exercise.currentInjectId,
      debrief: ended ? buildDebrief(view, viewer, c, clocks) : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

function viewTimezone(view: ExerciseView<ExerciseConfig>): string {
  const tz = (view as { timezone?: unknown }).timezone;
  return typeof tz === "string" && tz ? tz : "UTC";
}

/** Team decisions from a close summary, with a fallback for summaries written before decisions existed. */
function summaryDecisions(summary: Record<string, unknown>): Record<string, TeamDecision> {
  const d = summary.decisions as Record<string, TeamDecision> | undefined;
  if (d && typeof d === "object") return d;
  const m = (summary.majority ?? {}) as Record<string, string | null>;
  return Object.fromEntries(Object.entries(m).map(([team, id]) => [team, { optionId: id, source: id ? "majority" : "none" } as TeamDecision]));
}

/** The latest evaluator grade. */
function effectiveGrade(view: ExerciseView<ExerciseConfig>, responseId: string) {
  const grades = view.grades.filter((g) => g.responseId === responseId);
  const pick = [...grades].reverse().find((g) => g.source === "human");
  return pick ? { source: pick.source, score: pick.score, rating: pick.rating, rationale: pick.rationale } : null;
}

export interface ClockView {
  key: string;
  label: string;
  status: "pending" | "running" | "met" | "missed";
  triggeredAt: string | null;
  deadlineAt: string | null;
  metAt: string | null;
}

interface ClockRowLike {
  key: string;
  label: string;
  triggeredAt: Date | null;
  deadlineAt: Date | null;
  metAt: Date | null;
  status: string;
}

function clockDurations(view: ExerciseView<ExerciseConfig>): Map<string, { durationHours?: number; businessDays?: number }> {
  const tc = templateConfigSchema.safeParse(view.template?.config ?? {});
  return new Map((tc.success ? tc.data.regulatoryClocks : []).map((c) => [c.key, { durationHours: c.durationHours, businessDays: c.businessDays }]));
}

/**
 * Regulatory clock state. Uses RegulatoryClock rows when the runtime puts them
 * on the view; otherwise derives them from the template's clock list and the
 * clock updates recorded at each close, at the inject's scenario time.
 */
export function deriveClocks(view: ExerciseView<ExerciseConfig>): ClockView[] {
  const rows = (view as ExerciseView<ExerciseConfig> & { clocks?: ClockRowLike[] }).clocks;
  if (Array.isArray(rows)) {
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      status: (["pending", "running", "met", "missed"].includes(r.status) ? r.status : "pending") as ClockView["status"],
      triggeredAt: r.triggeredAt?.toISOString() ?? null,
      deadlineAt: r.deadlineAt?.toISOString() ?? null,
      metAt: r.metAt?.toISOString() ?? null,
    }));
  }
  const tc = templateConfigSchema.safeParse(view.template?.config ?? {});
  if (!tc.success) return [];
  const state = new Map<string, ClockView & { hours?: number; days?: number }>();
  for (const c of tc.data.regulatoryClocks) {
    state.set(c.key, {
      key: c.key,
      label: c.label,
      status: "pending",
      triggeredAt: null,
      deadlineAt: null,
      metAt: null,
      hours: c.durationHours,
      days: c.businessDays,
    });
  }
  const closed = view.injects.filter((i) => i.status === "closed").sort((a, b) => a.seq - b.seq);
  for (const inj of closed) {
    const updates = (view.closeSummaries[inj.id]?.clockUpdates ?? []) as Array<{ key: string; action: "trigger" | "met" }>;
    const at = inj.scenarioTime ?? inj.closedAt;
    if (!at) continue;
    for (const u of updates) {
      const clock = state.get(u.key);
      if (!clock) continue;
      if (u.action === "trigger" && !clock.triggeredAt) {
        clock.triggeredAt = at.toISOString();
        const deadline =
          clock.days || clock.hours ? computeClockDeadline({ businessDays: clock.days, durationHours: clock.hours }, at) : null;
        clock.deadlineAt = deadline?.toISOString() ?? null;
        clock.status = "running";
      } else if (u.action === "met" && !clock.metAt && clock.triggeredAt) {
        clock.metAt = at.toISOString();
        const onTime = !clock.deadlineAt || at.getTime() <= new Date(clock.deadlineAt).getTime();
        clock.status = onTime ? "met" : "missed";
      }
    }
  }
  // A running clock whose deadline passed in scenario time is missed.
  const lastTime = closed.at(-1)?.scenarioTime;
  return [...state.values()].map(({ hours: _h, days: _d, ...c }) => {
    if (c.status === "running" && c.deadlineAt && lastTime && lastTime.getTime() > new Date(c.deadlineAt).getTime()) {
      return { ...c, status: "missed" as const };
    }
    return c;
  });
}

/**
 * Clocks the open inject starts are running from the moment it opens. The
 * runtime writes them at close (at the inject's scenario time); show them now.
 */
function withOpenTriggers(view: ExerciseView<ExerciseConfig>, clocks: ClockView[]): ClockView[] {
  const open = view.injects.find((i) => i.status === "open");
  const at = open?.scenarioTime;
  const triggers = open ? (readSecret(open)?.clockTriggers ?? []) : [];
  if (!open || !at || triggers.length === 0) return clocks;
  const durations = clockDurations(view);
  return clocks.map((c) => {
    if (c.status !== "pending" || !triggers.includes(c.key)) return c;
    const d = durations.get(c.key);
    const deadline = d && (d.businessDays || d.durationHours) ? computeClockDeadline(d, at) : null;
    return { ...c, status: "running", triggeredAt: at.toISOString(), deadlineAt: deadline?.toISOString() ?? null };
  });
}

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

export interface DebriefDecision {
  injectId: string;
  seq: number;
  title: string;
  scenarioTime: string | null;
  team: string;
  questionType: string;
  stem: string;
  decisionOwner: string | null;
  source: DecisionSource;
  decision: { optionId: string; text: string; rationale: string | null } | null;
  /** Recommendation split: every option with its vote count. Never names. */
  split: Array<{ optionId: string; text: string; votes: number }>;
  noVotes: number;
  best: { optionId: string; text: string; rationale: string | null } | null;
  clockChanges: Array<{ key: string; label: string; action: "trigger" | "met" }>;
  /** Control only. */
  quality?: Quality | null;
}

function debriefDecisions(
  view: ExerciseView<ExerciseConfig>,
  viewer: Viewer,
  inj: InjectRow,
  clockLabels: Map<string, string>,
): DebriefDecision[] {
  const s = view.closeSummaries[inj.id] ?? {};
  const content = readContent(inj);
  const secret = readSecret(inj);
  const path = (s.pathAtClose as PathKey | undefined) ?? content?.path ?? "optimal";
  const decisions = summaryDecisions(s);
  const distribution = (s.distribution ?? {}) as Record<string, Record<string, number>>;
  const best = (s.best ?? bestFor(content, secret, path)) as Record<string, string | null>;
  const votes = view.responses.filter((r) => r.injectId === inj.id && r.kind === "vote");
  return (content?.questions ?? []).map((q) => {
    const d = decisions[q.team] ?? { optionId: null, source: "none" as const };
    const opt = (id: string | null) => (id ? q.options.find((o) => o.id === id) : undefined);
    const chosen = opt(d.optionId);
    const bestOpt = opt(best[q.team] ?? null);
    const rationale = (id: string) => secret?.rationales?.[q.team]?.[id] ?? null;
    const effects = d.optionId ? (secret?.clockEffects?.[q.team]?.[d.optionId] ?? []) : [];
    return {
      injectId: inj.id,
      seq: inj.seq,
      title: inj.title,
      scenarioTime: inj.scenarioTime?.toISOString() ?? null,
      team: q.team,
      questionType: q.type,
      stem: q.stem,
      decisionOwner: q.decisionOwner ?? null,
      source: d.source,
      decision: chosen ? { optionId: chosen.id, text: chosen.text, rationale: rationale(chosen.id) } : null,
      split: q.options.map((o) => ({ optionId: o.id, text: o.text, votes: distribution[q.team]?.[o.id] ?? 0 })),
      noVotes: votes.filter((v) => teamName(view, v.teamId) === q.team && voteOf(v).abstain).length,
      best: bestOpt ? { optionId: bestOpt.id, text: bestOpt.text, rationale: rationale(bestOpt.id) } : null,
      clockChanges: effects.map((e) => ({ key: e.key, label: clockLabels.get(e.key) ?? e.key, action: e.action })),
      ...(viewer.isControl ? { quality: d.optionId ? (secret?.quality?.[q.team]?.[d.optionId]?.[path] ?? null) : null } : {}),
    };
  });
}

/** Key decisions: materiality, ransom, and every question whose options move a clock. */
function isKeyDecision(inj: InjectRow, team: string, type: string): boolean {
  if (type === "materiality" || type === "ransom") return true;
  const effects = readSecret(inj)?.clockEffects?.[team] ?? {};
  return Object.values(effects).some((list) => list.length > 0);
}

function buildDebrief(view: ExerciseView<ExerciseConfig>, viewer: Viewer, c: ExerciseConfig, clocks: ClockView[]) {
  const closed = view.injects.filter((i) => i.status === "closed").sort((a, b) => a.seq - b.seq);
  const clockLabels = new Map(clocks.map((k) => [k.key, k.label]));
  const arc = closed.map((i) => {
    const s = view.closeSummaries[i.id] ?? {};
    return {
      injectId: i.id,
      seq: i.seq,
      title: i.title,
      pathAtClose: (s.pathAtClose as PathKey | undefined) ?? readContent(i)?.path ?? c.initialPath,
      newPath: (s.newPath as PathKey | undefined) ?? (s.pathAtClose as PathKey | undefined) ?? c.initialPath,
      ...(viewer.isControl ? { scoreAfter: (s.scoreAfter as number | undefined) ?? null, delta: (s.delta as number | undefined) ?? null } : {}),
    };
  });

  const all = closed.map((i) => ({ inj: i, decisions: debriefDecisions(view, viewer, i, clockLabels) }));

  const keyDecisions = all.flatMap(({ inj, decisions }) => decisions.filter((d) => isKeyDecision(inj, d.team, d.questionType)));

  const moves = all
    .filter(({ inj }) => view.closeSummaries[inj.id]?.pathShifted)
    .map(({ inj, decisions }) => {
      const s = view.closeSummaries[inj.id];
      return { injectId: inj.id, seq: inj.seq, title: inj.title, from: s.pathAtClose as PathKey, to: s.newPath as PathKey, decisions };
    });

  const lastScenario = closed.at(-1)?.scenarioTime?.toISOString() ?? null;
  const clockOutcomes = clocks.map((k) => ({
    ...k,
    outcome: (k.status === "running" ? "open" : k.status === "pending" ? "not_started" : k.status) as "met" | "missed" | "open" | "not_started",
  }));

  const deliverables = closed.flatMap((i) => {
    const content = readContent(i);
    if (!content?.deliverable) return [];
    return view.responses
      .filter((r) => r.injectId === i.id && r.kind === "deliverable")
      .map((r) => ({
        injectId: i.id,
        seq: i.seq,
        title: i.title,
        team: teamName(view, r.teamId) ?? content.deliverable!.team,
        kind: content.deliverable!.kind,
        prompt: content.deliverable!.prompt,
        text: String((r.payload as { text?: unknown }).text ?? ""),
        ...(viewer.isControl ? { grade: effectiveGrade(view, r.id), criteria: readSecret(i)?.deliverableCriteria ?? [] } : {}),
      }));
  });

  let noVoteCount = 0;
  let voteCount = 0;
  for (const i of closed) {
    noVoteCount += Number(view.closeSummaries[i.id]?.abstainCount ?? 0);
    voteCount += Number(view.closeSummaries[i.id]?.voteCount ?? 0);
  }

  let individual: Array<Record<string, unknown>> | undefined;
  if (viewer.isControl && c.individualMetrics) {
    const byPerson = new Map<string, { votes: number; abstains: number; great: number; good: number; neutral: number; bad: number }>();
    for (const r of view.responses) {
      if (r.kind !== "vote") continue;
      const p = voteOf(r);
      const row = byPerson.get(r.participantId) ?? { votes: 0, abstains: 0, great: 0, good: 0, neutral: 0, bad: 0 };
      if (p.abstain) row.abstains++;
      else row.votes++;
      if (p.quality && !p.abstain) row[p.quality]++;
      byPerson.set(r.participantId, row);
    }
    individual = view.participants
      .filter((p) => byPerson.has(p.id))
      .map((p) => ({ participantId: p.id, displayName: p.displayName, teamId: p.teamId, ...byPerson.get(p.id)! }));
  }

  return {
    initialPath: c.initialPath,
    finalPath: currentPath(view),
    arc,
    keyDecisions,
    moves,
    clocks: clockOutcomes,
    lastScenarioTime: lastScenario,
    deliverables,
    noVoteCount,
    voteCount,
    thresholds: viewer.isControl ? c.pathThresholds : undefined,
    finalScore: viewer.isControl ? (view.score?.cumulative ?? 0) : undefined,
    individual,
  };
}

function stripQuestion(q: InjectContent["questions"][number]) {
  return {
    team: q.team,
    teamId: q.teamId,
    stem: q.stem,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    decisionOwner: q.decisionOwner ?? null,
    discussionPrompt: q.discussionPrompt ?? null,
    type: q.type,
  };
}

