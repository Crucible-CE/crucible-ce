// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ExerciseView, InjectRow, ParticipantRow, ResponseRow, Viewer } from "@/lib/exercise/runtime/types";
import { ResponseError } from "@/lib/exercise/runtime/types";
import { strategicMode, activeTeamIds } from "./index";
import type { ExerciseConfig } from "./schema";

const EXEC = "t-exec";
const LEGAL = "t-legal";
const IT = "t-it";

function p(id: string, teamId: string | null, roles: ParticipantRow["roles"], dm = false): ParticipantRow {
  return { id, userId: `u-${id}`, displayName: id, title: null, teamId, roles, isDecisionMaker: dm, isGuest: false, joinedAt: new Date(), leftAt: null, removedAt: null };
}

const inject: InjectRow = {
  id: "i1",
  seq: 1,
  status: "open",
  source: "template",
  title: "Board call",
  scenarioTime: null,
  targetTeamIds: [EXEC, LEGAL, IT],
  content: {
    schemaVersion: 1,
    narrativeMd: "A reporter emails the CEO about leaked customer data.",
    phase: "opening",
    artifacts: [],
    contingency: false,
    teamVariants: [
      { team: "Executive", teamId: EXEC, status: "active", narrativeMd: "The board chair wants a call in 30 minutes.", questions: [{ key: "q1", text: "What do you tell the board?" }] },
      { team: "Legal", teamId: LEGAL, status: "active", narrativeMd: "Outside counsel asks whether this is material.", questions: [{ key: "q1", text: "Is this material?" }] },
      { team: "IT", teamId: IT, status: "standby", narrativeMd: "Keep collecting logs.", questions: [] },
    ],
  },
  secret: { schemaVersion: 1, expectedActions: { Legal: ["Open a materiality assessment"] }, mitreTags: ["T1567"], capabilityKeys: [] },
  templateInjectId: null,
  budgetMs: null,
  openedAt: new Date(),
  closesAt: null,
  closedAt: null,
  closeTrigger: null,
};

const config: ExerciseConfig = {
  schemaVersion: 1,
  holdAfterClose: false,
  source: "template",
  scenario: { title: "", domain: "cyber", crisisType: "", threatActorKey: null, replayKey: null, industryKey: null, orgProfileMd: "", contextMd: "", complexity: "intermediate", objectives: [], stakeholders: [], impactFocus: [], pressures: [] },
  injectMinutes: null,
  winCondition: "none",
};

const participants = [p("ceo", EXEC, ["player"], true), p("cfo", EXEC, ["player"]), p("gc", LEGAL, ["player"]), p("it1", IT, ["player"]), p("fac", null, ["lead_facilitator"])];

function view(responses: ResponseRow[] = []): ExerciseView<ExerciseConfig> {
  return {
    exercise: {
      id: "ex",
      mode: "strategic",
      title: "x",
      status: "live",
      stateVersion: 1,
      config,
      secret: {},
      templateId: null,
      sourceDocumentId: null,
      currentInjectId: "i1",
      scenarioStartAt: null,
      timeboxMin: null,
      injectBudget: null,
      advancePolicy: "all_teams",
      startedAt: new Date(),
      pausedAt: null,
      pausedMsTotal: 0,
      endedAt: null,
      endReason: null,
      isPractice: false,
    },
    config,
    teams: [
      { id: EXEC, name: "Executive", seq: 1 },
      { id: LEGAL, name: "Legal", seq: 2 },
      { id: IT, name: "IT", seq: 3 },
    ],
    participants,
    injects: [inject],
    score: null,
    template: null,
    document: null,
    responses,
    grades: [],
    closeSummaries: {},
    feed: [],
    now: new Date(),
  } as ExerciseView<ExerciseConfig>;
}

describe("strategic", () => {
  it("requires only active teams", () => {
    expect(activeTeamIds(view(), inject).sort()).toEqual([EXEC, LEGAL].sort());
  });

  it("lets only the decision maker answer when the team has one", () => {
    const base = { snapshot: view(), inject, kind: "answer" as const, raw: { text: "Brief the board now." }, existing: [] };
    expect(() => strategicMode.validateResponse({ ...base, participant: participants[1] })).toThrow(ResponseError);
    expect(strategicMode.validateResponse({ ...base, participant: participants[0] }).teamId).toBe(EXEC);
  });

  it("rejects answers from standby teams", () => {
    const base = { snapshot: view(), inject, kind: "answer" as const, raw: { text: "x" }, existing: [] };
    expect(() => strategicMode.validateResponse({ ...base, participant: participants[3] })).toThrow(/standby/);
  });

  it("shows players only their own variant and never expected actions", () => {
    const player: Viewer = { participant: participants[2], isControl: false, isDriver: false };
    const out = strategicMode.project(view(), player);
    const text = JSON.stringify(out);
    expect(text).toContain("Outside counsel");
    expect(text).not.toContain("board chair wants");
    expect(text).not.toContain("materiality assessment");
    expect(text).not.toContain("T1567");
  });

  it("gives control every variant and the expected actions", () => {
    const control: Viewer = { participant: participants[4], isControl: true, isDriver: true };
    const text = JSON.stringify(strategicMode.project(view(), control));
    expect(text).toContain("board chair wants");
    expect(text).toContain("materiality assessment");
  });

  it("lists missing teams at close and queues no jobs: evaluators rate by hand", () => {
    const ans: ResponseRow = { id: "r1", injectId: "i1", participantId: "ceo", teamId: EXEC, kind: "answer", payload: { text: "x" }, status: "submitted", createdAt: new Date() };
    const snap = { ...view([ans]), inject, responses: [ans], trigger: "all_teams" as const, now: new Date() };
    const out = strategicMode.scoreClose(snap);
    expect(out.summary.missingTeams).toEqual(["Legal"]);
    expect(strategicMode.jobsAfterClose(snap, out)).toEqual([]);
  });
});

describe("strategic redaction", () => {
  const held: InjectRow = {
    ...inject,
    id: "i2",
    seq: 2,
    status: "held",
    title: "Held board leak",
    content: { ...(inject.content as object), narrativeMd: "HELD-NARRATIVE the board chair leaks to a reporter." },
    secret: { schemaVersion: 1, expectedActions: { Executive: ["HELD-EXPECTED call the chair"] } },
  };
  const contingency: InjectRow = {
    ...inject,
    id: "c3",
    seq: 3,
    status: "closed",
    source: "contingency",
    title: "Regulator calls Legal",
    targetTeamIds: [LEGAL],
    content: {
      schemaVersion: 1,
      narrativeMd: "CONTINGENCY-NARRATIVE the regulator calls the general counsel.",
      phase: "main",
      artifacts: [],
      contingency: true,
      teamVariants: [{ team: "Legal", teamId: LEGAL, status: "active", narrativeMd: "Answer as a team.", questions: [{ key: "q1", text: "What do you say?" }] }],
    },
    secret: { schemaVersion: 1, expectedActions: {} },
  };
  const closed: InjectRow = { ...inject, status: "closed", closedAt: new Date() };
  const answers: ResponseRow[] = [
    { id: "r-exec", injectId: "i1", participantId: "ceo", teamId: EXEC, kind: "answer", payload: { text: "EXEC-ANSWER brief the board at noon." }, status: "submitted", createdAt: new Date() },
    { id: "r-legal", injectId: "i1", participantId: "gc", teamId: LEGAL, kind: "answer", payload: { text: "LEGAL-ANSWER start the materiality review." }, status: "submitted", createdAt: new Date() },
  ];

  function ended(): ExerciseView<ExerciseConfig> {
    const v = view(answers);
    return {
      ...v,
      exercise: { ...v.exercise, status: "ended", currentInjectId: "c3", endedAt: new Date(), endReason: "facilitator" },
      injects: [closed, held, contingency],
      grades: [
        { id: "g1", responseId: "r-legal", source: "human", attempt: 1, score: 3.5, rating: "effective", rationale: "GRADE-RATIONALE strong legal answer.", createdAt: new Date() },
        { id: "g2", responseId: "r-exec", source: "human", attempt: 1, score: 1, rating: "ineffective", rationale: "GRADE-HUMAN no owner named.", createdAt: new Date() },
      ],
    };
  }

  const execPlayer: Viewer = { participant: participants[1], isControl: false, isDriver: false };
  const legalPlayer: Viewer = { participant: participants[2], isControl: false, isDriver: false };
  const control: Viewer = { participant: participants[4], isControl: true, isDriver: true };

  it("hides other teams' variants and answers, expected actions, grades and held injects after ENDEX", () => {
    const text = JSON.stringify(strategicMode.project(ended(), execPlayer));
    expect(text).toContain("board chair wants");
    expect(text).toContain("EXEC-ANSWER");
    for (const secret of ["Outside counsel", "Keep collecting logs", "LEGAL-ANSWER", "materiality assessment", "T1567", "GRADE-RATIONALE", "GRADE-HUMAN", "ineffective", "HELD-NARRATIVE", "HELD-EXPECTED", "CONTINGENCY-NARRATIVE", "expectedActions"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("shows a contingency inject only to the teams it targets", () => {
    const legal = strategicMode.project(ended(), legalPlayer) as { injects: Array<{ id: string; myVariant: unknown }> };
    expect(legal.injects.map((i) => i.id)).toEqual(["i1", "c3"]);
    const text = JSON.stringify(legal);
    expect(text).toContain("CONTINGENCY-NARRATIVE");
    expect(text).not.toContain("EXEC-ANSWER");
  });

  it("gives control every answer with the latest evaluator grade", () => {
    const out = strategicMode.project(ended(), control) as { injects: Array<{ id: string; control?: { answers: Array<{ team: string; effective: { rating: string; source: string } | null }> } }> };
    const first = out.injects.find((i) => i.id === "i1")!;
    expect(first.control!.answers.map((a) => [a.team, a.effective?.rating, a.effective?.source])).toEqual([
      ["Executive", "ineffective", "human"],
      ["Legal", "effective", "human"],
    ]);
    expect(JSON.stringify(out)).toContain("HELD-NARRATIVE");
  });

  it("names who on the team may submit", () => {
    const out = strategicMode.project(view(), execPlayer) as { submitters: string[]; injects: Array<{ canAnswer: boolean }> };
    expect(out.submitters).toEqual(["ceo"]);
    expect(out.injects[0]!.canAnswer).toBe(false);
  });
});
