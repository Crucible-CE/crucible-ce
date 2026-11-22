// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ExerciseView, InjectRow, ParticipantRow, ResponseRow, Viewer } from "@/lib/exercise/runtime/types";
import { documentMode } from "./index";
import type { ExerciseConfig } from "./schema";

function p(id: string, roles: ParticipantRow["roles"]): ParticipantRow {
  return { id, userId: `u-${id}`, displayName: id, title: null, teamId: null, roles, isDecisionMaker: false, isGuest: false, joinedAt: new Date(), leftAt: null, removedAt: null };
}

const inject: InjectRow = {
  id: "m1",
  seq: 1,
  status: "open",
  source: "module",
  title: "Detection and triage",
  scenarioTime: null,
  targetTeamIds: [],
  content: {
    schemaVersion: 1,
    scenarioUpdate: "The SOC sees mass file renames on two servers.",
    keyIssues: ["Who declares an incident"],
    docSectionRefs: ["s2"],
    questions: [{ key: "q1", text: "Who declares the incident and how?", category: "decision_making", capabilityKeys: [], objectiveKeys: [], docSectionRefs: ["s2"] }],
  },
  secret: { schemaVersion: 1, expectedActions: ["Incident commander declares within 15 minutes"] },
  templateInjectId: "tm1",
  budgetMs: null,
  openedAt: new Date(),
  closesAt: null,
  closedAt: null,
  closeTrigger: null,
};

function cfg(scribeMode: boolean): ExerciseConfig {
  return { schemaVersion: 1, scribeMode, moduleMinutes: null };
}

const people = [p("player1", ["player"]), p("scribe1", ["scribe"]), p("obs", ["observer"]), p("fac", ["lead_facilitator"])];

function view(config: ExerciseConfig, responses: ResponseRow[] = []): ExerciseView<ExerciseConfig> {
  return {
    exercise: { id: "ex", mode: "document", title: "x", status: "live", stateVersion: 1, config, secret: {}, templateId: "t", sourceDocumentId: "d", currentInjectId: "m1", scenarioStartAt: null, timeboxMin: null, injectBudget: null, advancePolicy: "facilitator", startedAt: new Date(), pausedAt: null, pausedMsTotal: 0, endedAt: null, endReason: null, isPractice: false },
    config,
    teams: [],
    participants: people,
    injects: [inject],
    score: null,
    template: null,
    document: { id: "d", kind: "playbook", title: "IR Playbook", text: "", sha256: "x", sections: [{ id: "s2", heading: "Declaring an incident", level: 2, start: 0, end: 10 }] },
    responses,
    grades: [{ id: "g1", responseId: "r1", source: "human", attempt: 1, score: 3, rating: "met", rationale: "ok", createdAt: new Date() }],
    closeSummaries: {},
    feed: [],
    now: new Date(),
  } as ExerciseView<ExerciseConfig>;
}

const entry: ResponseRow = { id: "r1", injectId: "m1", participantId: "player1", teamId: null, kind: "entry", payload: { type: "discussion", text: "The IC declares.", questionKey: "q1", byRoles: ["player"] }, status: "submitted", createdAt: new Date() };

describe("document mode", () => {
  it("blocks player entries in scribe mode but allows scribes", () => {
    const base = { snapshot: view(cfg(true)), inject, kind: "entry" as const, raw: { type: "note", text: "x" }, existing: [] };
    expect(() => documentMode.validateResponse({ ...base, participant: people[0] })).toThrow(/scribes/);
    expect(documentMode.validateResponse({ ...base, participant: people[1] }).kind).toBe("entry");
  });

  it("blocks observers", () => {
    const base = { snapshot: view(cfg(false)), inject, kind: "entry" as const, raw: { type: "note", text: "x" }, existing: [] };
    expect(() => documentMode.validateResponse({ ...base, participant: people[2] })).toThrow(/Observers/);
  });

  it("rejects a question key from another module", () => {
    const base = { snapshot: view(cfg(false)), inject, kind: "entry" as const, raw: { type: "discussion", text: "x", questionKey: "zz" }, existing: [] };
    expect(() => documentMode.validateResponse({ ...base, participant: people[0] })).toThrow(/question/);
  });

  it("hides grades and expected actions from players", () => {
    const player: Viewer = { participant: people[0], isControl: false, isDriver: false };
    const text = JSON.stringify(documentMode.project(view(cfg(false), [entry]), player));
    expect(text).toContain("The IC declares.");
    expect(text).not.toContain("within 15 minutes");
    expect(text).not.toContain('"rating"');
  });

  it("summarizes the module at close and queues no jobs: evaluators grade by hand", () => {
    const snap = { ...view(cfg(false), [entry]), inject, responses: [entry], trigger: "facilitator" as const, now: new Date() };
    const out = documentMode.scoreClose(snap);
    expect(out.summary.unanswered).toEqual([]);
    expect(documentMode.jobsAfterClose(snap, out)).toEqual([]);
  });
});

describe("document projection", () => {
  const control: Viewer = { participant: people[3], isControl: true, isDriver: true };
  const player: Viewer = { participant: people[0], isControl: false, isDriver: false };
  const human = { id: "g2", responseId: "r1", source: "human" as const, attempt: 1, score: 1, rating: "not_met", rationale: "Evaluator says no.", createdAt: new Date(Date.now() + 1000) };

  function viewWith(feed: unknown[], extraGrades: unknown[] = []) {
    const v = view(cfg(false), [entry]);
    return { ...v, feed, grades: [...v.grades, ...extraGrades] } as ExerciseView<ExerciseConfig>;
  }

  it("gives control the latest evaluator grade and the facilitator notes", () => {
    const out = documentMode.project(viewWith([], [human]), control) as {
      injects: Array<{ entries: Array<Record<string, unknown>>; control: Record<string, unknown> }>;
      debrief: { modules: Array<{ questions: Array<{ avgScore: number | null }> }> };
    };
    const e = out.injects[0].entries[0];
    expect(e.grade).toMatchObject({ source: "human", score: 1 });
    expect(out.injects[0].control.expectedActions).toEqual(["Incident commander declares within 15 minutes"]);
    expect(out.injects[0].control.unanswered).toEqual([]);
    expect(out.debrief.modules[0].questions[0].avgScore).toBe(1);
  });

  it("never gives players grades, expected actions or facilitator notes", () => {
    const text = JSON.stringify(documentMode.project(viewWith([], [human]), player));
    for (const secret of ["within 15 minutes", "Evaluator says no", '"grade"', '"control"', "rationale", "sourceExcerpt"]) {
      expect(text).not.toContain(secret);
    }
    const out = documentMode.project(viewWith([]), player) as { debrief: { modules: Array<{ answered: string[]; questions?: unknown }> } };
    expect(out.debrief.modules[0].answered).toEqual(["q1"]);
    expect(out.debrief.modules[0].questions).toBeUndefined();
  });

  it("does not count denied entries as answers", () => {
    const denied = { ...entry, status: "denied" };
    const out = documentMode.project(view(cfg(false), [denied]), control) as { injects: Array<{ questions: Array<{ answered: boolean }>; control: { unanswered: string[] } }> };
    expect(out.injects[0].questions[0].answered).toBe(false);
    expect(out.injects[0].control.unanswered).toEqual(["q1"]);
  });

  it("lets scribes post in scribe mode and leaves players read only", () => {
    const scribe: Viewer = { participant: people[1], isControl: false, isDriver: false };
    expect((documentMode.project(view(cfg(true)), scribe) as { canPost: boolean }).canPost).toBe(true);
    expect((documentMode.project(view(cfg(true)), player) as { canPost: boolean }).canPost).toBe(false);
    expect((documentMode.project(view(cfg(false)), player) as { canPost: boolean }).canPost).toBe(true);
  });
});
