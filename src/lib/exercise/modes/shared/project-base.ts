// Fields every mode projection shares. Never includes secret columns.
//
// plan        the player brief (public plan fields and the executive brief)
// objectives  [{id, seq, text}]; everyone may read them
// clocks      regulatory clocks; a mode may replace this key with its own
//             view of the same shape
// injectTotal planned number of injects (template count, capped by the
//             inject budget), or null when unknown

import type { ExerciseView, InjectRow, Viewer } from "@/lib/exercise/runtime/types";

export function baseProjection(view: ExerciseView, viewer: Viewer) {
  const ex = view.exercise;
  const me = viewer.participant;
  return {
    exercise: {
      id: ex.id,
      mode: ex.mode,
      title: ex.title,
      status: ex.status,
      stateVersion: ex.stateVersion,
      advancePolicy: ex.advancePolicy,
      startedAt: ex.startedAt,
      pausedAt: ex.pausedAt,
      pausedMsTotal: ex.pausedMsTotal,
      endedAt: ex.endedAt,
      endReason: ex.endReason,
      timeboxMin: ex.timeboxMin,
      scenarioStartAt: ex.scenarioStartAt,
      isPractice: ex.isPractice,
    },
    now: view.now,
    teams: view.teams.map((t) => ({ id: t.id, name: t.name })),
    me: me
      ? {
          participantId: me.id,
          displayName: me.displayName,
          teamId: me.teamId,
          roles: me.roles,
          isDecisionMaker: me.isDecisionMaker,
          isGuest: me.isGuest,
        }
      : null,
    viewer: { isControl: viewer.isControl, isDriver: viewer.isDriver },
    roster: view.participants
      .filter((p) => !p.removedAt)
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        title: p.title,
        teamId: p.teamId,
        roles: p.roles,
        isGuest: p.isGuest,
        isDecisionMaker: p.isDecisionMaker,
        online: Boolean(p.joinedAt && !p.leftAt),
      })),
    /** Already filtered and redacted for this viewer by the runtime (src/runtime/view.ts). */
    feed: (view.feed ?? []).map((f) => ({ id: f.id, type: f.type, at: f.at, data: f.data })),
    /** Header of the current inject for the shell's clocks; null when this viewer may not see it. */
    currentInject: currentHeader(view, viewer),
    plan: view.plan ?? null,
    objectives: (view.objectives ?? []).map((o) => ({ id: o.id, seq: o.seq, text: o.text })),
    clocks: (view.clocks ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      status: c.status,
      triggeredAt: c.triggeredAt?.toISOString() ?? null,
      deadlineAt: c.deadlineAt?.toISOString() ?? null,
      metAt: c.metAt?.toISOString() ?? null,
    })),
    injectTotal: injectTotal(view),
  };
}

function injectTotal(view: ExerciseView): number | null {
  // A branched template skips nodes, so its node count is not the run length.
  if (view.template?.branching === "branched") return view.exercise.injectBudget ?? null;
  const planned = view.template?.injects.length ?? null;
  const budget = view.exercise.injectBudget;
  if (planned === null || planned === 0) return budget ?? null;
  return budget ? Math.min(budget, planned) : planned;
}

function currentHeader(view: ExerciseView, viewer: Viewer) {
  const id = view.exercise.currentInjectId;
  const inj = id ? view.injects.find((i) => i.id === id) : undefined;
  if (!inj) return null;
  if (!visibleInjects(view, viewer).includes(inj)) return null;
  if (!viewer.isControl && !teamTargeted(inj, viewer.participant?.teamId ?? null)) return null;
  return injectHeader(inj);
}

/** Injects a viewer may see: open and closed ones; held ones only for control. */
export function visibleInjects(view: ExerciseView, viewer: Viewer): InjectRow[] {
  return view.injects.filter(
    (i) => i.status === "open" || i.status === "closed" || (viewer.isControl && i.status === "held"),
  );
}

export function injectHeader(i: InjectRow) {
  return {
    id: i.id,
    seq: i.seq,
    status: i.status,
    source: i.source,
    title: i.title,
    scenarioTime: i.scenarioTime,
    targetTeamIds: i.targetTeamIds,
    openedAt: i.openedAt,
    closesAt: i.closesAt,
    closedAt: i.closedAt,
  };
}

/** True when a viewer's team is targeted (or the inject targets everyone). */
export function teamTargeted(i: InjectRow, teamId: string | null): boolean {
  return i.targetTeamIds.length === 0 || (teamId !== null && i.targetTeamIds.includes(teamId));
}
