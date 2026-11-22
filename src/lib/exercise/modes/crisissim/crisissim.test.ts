// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CloseSnapshot, ExerciseView, InjectRow, ParticipantRow, PlanInput, ResponseRow, TemplateData, Viewer } from "@/lib/exercise/runtime/types";
import { crisisSimMode, decideTeam } from "./index";
import { exerciseConfigSchema, pathFor, type ExerciseConfig } from "./schema";

const T1 = "team-legal";
const T2 = "team-comms";

function participant(id: string, teamId: string | null, roles: ParticipantRow["roles"] = ["player"], isDecisionMaker = false): ParticipantRow {
  return {
    id,
    userId: `u-${id}`,
    displayName: id,
    title: null,
    teamId,
    roles,
    isDecisionMaker,
    isGuest: false,
    joinedAt: new Date(),
    leftAt: null,
    removedAt: null,
  };
}

const content = {
  schemaVersion: 1,
  path: "optimal",
  narrativeMd: "Ransomware note found on the file server at 02:10.",
  followUps: [
    { team: "Legal", text: "Counsel was engaged." },
    { team: "Comms", text: "A holding statement went out." },
  ],
  artifacts: [{ id: "a1", kind: "email", title: "Reporter", content: "Comment?" }],
  questions: [
    {
      team: "Legal",
      teamId: T1,
      stem: "Do we notify the regulator now?",
      options: [
        { id: "a", text: "Notify now" },
        { id: "b", text: "Wait for forensics" },
        { id: "c", text: "Ask outside counsel" },
      ],
      decisionOwner: "General counsel",
      type: "materiality",
      capabilityKeys: [],
    },
    {
      team: "Comms",
      teamId: T2,
      stem: "Do we issue a holding statement?",
      options: [
        { id: "a", text: "Yes, now" },
        { id: "b", text: "No" },
        { id: "c", text: "Draft only" },
      ],
      type: "standard",
      capabilityKeys: [],
    },
  ],
};

const secret = {
  schemaVersion: 1,
  quality: {
    Legal: {
      a: { optimal: "great", degrading: "good", critical: "neutral" },
      b: { optimal: "bad", degrading: "bad", critical: "bad" },
      c: { optimal: "good", degrading: "great", critical: "good" },
    },
    Comms: {
      a: { optimal: "good", degrading: "good", critical: "great" },
      b: { optimal: "bad", degrading: "bad", critical: "bad" },
      c: { optimal: "great", degrading: "neutral", critical: "neutral" },
    },
  },
  followUps: { Legal: { a: "Legal notified.", b: "Legal waited.", c: "Counsel engaged." } },
  clockEffects: { Legal: { a: [{ key: "sec_8k", action: "trigger" }] } },
  rationales: { Legal: { a: "Prompt notice is required.", b: "Waiting misses the deadline." } },
  clockTriggers: ["insurer_notice"],
  deliverableCriteria: [],
};

const inject: InjectRow = {
  id: "inj-1",
  seq: 1,
  status: "closed",
  source: "template",
  title: "Discovery",
  scenarioTime: new Date("2026-03-07T02:10:00Z"),
  targetTeamIds: [],
  content,
  secret,
  templateInjectId: "ti-1",
  budgetMs: 600_000,
  openedAt: new Date(),
  closesAt: new Date(),
  closedAt: new Date(),
  closeTrigger: "timer",
};

function vote(id: string, participantId: string, teamId: string, optionId: string): ResponseRow {
  return { id, injectId: inject.id, participantId, teamId, kind: "vote", payload: { optionId, pathAtVote: "optimal" }, status: "submitted", createdAt: new Date() };
}

const config: ExerciseConfig = {
  schemaVersion: 1,
  pathThresholds: { optimal: 4, degrading: -3 },
  targetDurationMin: 60,
  holdAfterClose: false,
  revealSplit: true,
  revealBest: false,
  individualMetrics: false,
  initialPath: "optimal",
};

const baseParticipants = () => [participant("p1", T1), participant("p2", T1), participant("p3", T2), participant("f1", null, ["lead_facilitator"])];

function snap(responses: ResponseRow[], cumulative = 0, path = "optimal", participants = baseParticipants()): CloseSnapshot<ExerciseConfig> {
  return {
    exercise: {
      id: "ex-1",
      mode: "crisissim",
      title: "Test",
      status: "live",
      stateVersion: 1,
      config,
      secret: {},
      templateId: "t-1",
      sourceDocumentId: null,
      currentInjectId: inject.id,
      scenarioStartAt: null,
      timeboxMin: null,
      injectBudget: null,
      advancePolicy: "votes_in",
      startedAt: new Date(),
      pausedAt: null,
      pausedMsTotal: 0,
      endedAt: null,
      endReason: null,
      isPractice: false,
    },
    config,
    teams: [
      { id: T1, name: "Legal", seq: 1 },
      { id: T2, name: "Comms", seq: 2 },
    ],
    participants,
    injects: [inject],
    score: { path, cumulative, teamScores: {} },
    template: null,
    document: null,
    inject,
    responses,
    trigger: "timer",
    now: new Date(),
  };
}

describe("pathFor", () => {
  it("uses spec boundaries: optimal at threshold, critical strictly below degrading", () => {
    const t = { optimal: 4, degrading: -3 };
    expect(pathFor(4, t)).toBe("optimal");
    expect(pathFor(3, t)).toBe("degrading");
    expect(pathFor(-3, t)).toBe("degrading");
    expect(pathFor(-4, t)).toBe("critical");
    expect(pathFor(-3.1, t)).toBe("critical");
  });
});

describe("exercise config", () => {
  it("holds after close by default and keeps the intended option for the debrief", () => {
    const c = exerciseConfigSchema.parse({});
    expect(c.holdAfterClose).toBe(true);
    expect(c.revealSplit).toBe(true);
    expect(c.revealBest).toBe(false);
  });

  it("reads the old revealAfterClose as revealSplit", () => {
    expect(exerciseConfigSchema.parse({ revealAfterClose: false }).revealSplit).toBe(false);
    expect(exerciseConfigSchema.parse({ revealAfterClose: false, revealSplit: true }).revealSplit).toBe(true);
  });
});

describe("decideTeam", () => {
  it("lets the decision owner decide over the majority", () => {
    const votes = [
      { participantId: "p1", optionId: "a" },
      { participantId: "p2", optionId: "a" },
      { participantId: "dm", optionId: "c" },
    ];
    expect(decideTeam(votes, "dm")).toEqual({ optionId: "c", source: "owner" });
  });

  it("falls back to the majority when the owner did not vote or there is none", () => {
    const votes = [
      { participantId: "p1", optionId: "a" },
      { participantId: "p2", optionId: "a" },
      { participantId: "p3", optionId: "b" },
    ];
    expect(decideTeam(votes, "dm")).toEqual({ optionId: "a", source: "majority" });
    expect(decideTeam(votes, null)).toEqual({ optionId: "a", source: "majority" });
  });

  it("treats a tie as no decision, and no votes as none", () => {
    expect(decideTeam([{ participantId: "p1", optionId: "a" }, { participantId: "p2", optionId: "b" }], null)).toEqual({ optionId: null, source: "tie" });
    expect(decideTeam([], null)).toEqual({ optionId: null, source: "none" });
  });
});

describe("crisisSim scoreClose", () => {
  it("counts each team's average once and abstains as zero", () => {
    // Legal: great (+2) and good (+1), average 1.5. Comms: p3 has no vote, average 0.
    const out = crisisSimMode.scoreClose(snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "c")]));
    expect(out.summary.delta).toBe(1.5);
    expect(out.score?.cumulative).toBe(1.5);
    expect(out.score?.path).toBe("degrading");
    expect(out.score?.teamScores).toEqual({ Legal: { cumulative: 1.5, last: 1.5 }, Comms: { cumulative: 0, last: 0 } });
    expect(out.abstains.map((a) => a.participantId)).toEqual(["p3"]);
    expect(out.responseUpdates).toEqual([
      { responseId: "v1", payloadPatch: { quality: "great", delta: 2, pathAtClose: "optimal" } },
      { responseId: "v2", payloadPatch: { quality: "good", delta: 1, pathAtClose: "optimal" } },
    ]);
    expect(out.events.some((e) => e.type === "path_shift")).toBe(true);
  });

  it("weighs teams equally whatever their size and rounds to one decimal", () => {
    const people = [participant("p1", T1), participant("p2", T1), participant("p4", T1), participant("p3", T2)];
    // Legal: +2, +2, -2 = 0.67 average. Comms: +2. Delta 2.67 rounds to 2.7.
    const out = crisisSimMode.scoreClose(
      snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "a"), vote("v4", "p4", T1, "b"), vote("v3", "p3", T2, "c")], 0, "optimal", people),
    );
    expect(out.summary.delta).toBe(2.7);
    expect(out.score?.cumulative).toBe(2.7);
    const again = crisisSimMode.scoreClose({
      ...snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "a"), vote("v4", "p4", T1, "b"), vote("v3", "p3", T2, "c")], 2.7, "degrading", people),
    });
    // At degrading: Legal a good +1 twice, b bad -2: average 0. Comms c neutral 0.
    expect(again.score?.cumulative).toBe(2.7);
  });

  it("does not require facilitators to vote", () => {
    const out = crisisSimMode.scoreClose(snap([]));
    expect(out.abstains.map((a) => a.participantId).sort()).toEqual(["p1", "p2", "p3"]);
    expect(out.score?.cumulative).toBe(0);
  });

  it("starts the inject's clocks at close time, then applies the team decision", () => {
    const out = crisisSimMode.scoreClose(snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "a")]));
    expect(out.clockUpdates).toEqual([
      { key: "insurer_notice", action: "trigger" },
      { key: "sec_8k", action: "trigger" },
    ]);
  });

  it("uses the decision owner's vote for clocks and the decision log, all votes for scoring", () => {
    const people = [participant("p1", T1), participant("p2", T1), participant("dm", T1, ["player"], true), participant("p3", T2)];
    const out = crisisSimMode.scoreClose(
      snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "a"), vote("vd", "dm", T1, "c"), vote("v3", "p3", T2, "a")], 0, "optimal", people),
    );
    expect((out.summary.decisions as Record<string, unknown>).Legal).toEqual({ optionId: "c", source: "owner" });
    expect((out.summary.majority as Record<string, unknown>).Legal).toBe("c");
    // The owner chose c, which starts no clock.
    expect(out.clockUpdates).toEqual([{ key: "insurer_notice", action: "trigger" }]);
    const log = out.events.find((e) => e.type === "materiality_decision")!;
    expect(log.data).toMatchObject({ team: "Legal", majorityOptionId: "c", decision: "Ask outside counsel", decisionSource: "owner", recommendation: { a: 2, c: 1 } });
    // Scoring uses all three Legal votes: (2 + 2 + 1) / 3, plus Comms good +1.
    expect(out.summary.delta).toBe(2.7);
    expect(out.responseUpdates.find((u) => u.responseId === "vd")?.payloadPatch.decider).toBe(true);
  });

  it("logs a tie as no decision with no clock effects", () => {
    const out = crisisSimMode.scoreClose(snap([vote("v1", "p1", T1, "a"), vote("v2", "p2", T1, "c")]));
    expect((out.summary.decisions as Record<string, unknown>).Legal).toEqual({ optionId: null, source: "tie" });
    expect(out.clockUpdates).toEqual([{ key: "insurer_notice", action: "trigger" }]);
    const log = out.events.find((e) => e.type === "materiality_decision")!;
    expect(log.data).toMatchObject({ majorityOptionId: null, decision: null, decisionSource: "tie" });
  });

  it("reports the intended best option per team", () => {
    const out = crisisSimMode.scoreClose(snap([]));
    expect(out.summary.best).toEqual({ Legal: "a", Comms: "c" });
  });

  it("uses the path at close for quality, not the vote-time path", () => {
    const out = crisisSimMode.scoreClose(snap([vote("v1", "p1", T1, "c")], -5, "critical"));
    expect(out.responseUpdates[0].payloadPatch.quality).toBe("good");
  });
});

describe("crisisSim planInject", () => {
  function templateInject(over: Record<string, unknown> = {}) {
    const variant = (p: string) => ({ narrativeMd: `On the ${p} path things happen.`, artifacts: [] });
    return {
      id: "ti-2",
      nodeId: "n2",
      seq: 2,
      title: "Next",
      scenarioOffsetMin: 60,
      plannedDelayMin: 7,
      targetTeams: [],
      expectedActions: [],
      objectiveKeys: [],
      content: {
        schemaVersion: 1,
        variants: { optimal: variant("optimal"), degrading: variant("degrading"), critical: variant("critical") },
        questions: [{ team: "Legal", stem: "What does Legal do next?", options: content.questions[0].options }],
      },
      secret: {
        schemaVersion: 1,
        quality: { Legal: secret.quality.Legal },
        clockTriggers: ["gdpr_72h"],
        clockTriggersByPath: { degrading: ["state_ag"] },
        ...over,
      },
    };
  }

  it("follows the team decision, skips a tie, and resolves path clock triggers", async () => {
    const s = snap([], 0, "degrading");
    const template: TemplateData = { id: "t-1", mode: "crisissim", config: {}, branching: "linear", injects: [{ ...templateInject(), seq: 1, id: "ti-1" }, templateInject()], branches: [] };
    const input: PlanInput<ExerciseConfig> = {
      snapshot: { ...s, template },
      seq: 2,
      lastClose: { injectId: inject.id, summary: { decisions: { Legal: { optionId: "c", source: "owner" }, Comms: { optionId: null, source: "tie" } } } },
      history: [],
    };
    const draft = await crisisSimMode.planInject(input);
    expect(draft?.budgetMs).toBe(7 * 60_000);
    const c = draft!.content as { followUps: Array<{ team: string; text: string }> };
    expect(c.followUps).toEqual([{ team: "Legal", text: "Counsel engaged." }]);
    const sec = draft!.secret as { clockTriggers: string[]; rationales: unknown };
    expect(sec.clockTriggers.sort()).toEqual(["gdpr_72h", "state_ag"]);
  });
});

describe("crisisSim project", () => {
  function view(responses: ResponseRow[], over: Partial<InjectRow> = {}): ExerciseView<ExerciseConfig> {
    const s = snap(responses);
    const openInject = { ...inject, status: "open" as const, ...over };
    return { ...s, injects: [openInject], responses, grades: [], closeSummaries: {}, now: new Date() };
  }
  const player: Viewer = { participant: participant("p1", T1), isControl: false, isDriver: false };
  const control: Viewer = { participant: participant("f1", null, ["lead_facilitator"]), isControl: true, isDriver: true };

  it("never sends hidden quality, rationales or clock effects to players", () => {
    const out = crisisSimMode.project(view([vote("v1", "p1", T1, "a"), vote("v3", "p3", T2, "b")]), player);
    const text = JSON.stringify(out);
    expect(text).not.toContain("qualityByPath");
    expect(text).not.toContain("great");
    expect(text).not.toContain("sec_8k");
    expect(text).not.toContain("cumulative");
    expect(text).not.toContain("Prompt notice is required.");
    // Players see only their team's question and follow-up.
    const injects = out.injects as Array<Record<string, unknown>>;
    expect((injects[0].question as { team: string }).team).toBe("Legal");
    expect(injects[0].questions).toBeUndefined();
    expect(injects[0].outcomes).toEqual([{ team: "Legal", text: "Counsel was engaged." }]);
    // Players never see other people's choices.
    expect(text).not.toContain('"optionId":"b"');
  });

  it("shows players their own team's vote progress and control every team's", () => {
    const votes = [vote("v1", "p1", T1, "a"), vote("v3", "p3", T2, "b")];
    const p = (crisisSimMode.project(view(votes), player).injects as Array<{ progress: unknown }>)[0];
    expect(p.progress).toEqual({ voted: 1, required: 2 });
    const comms = (crisisSimMode.project(view([vote("v3", "p3", T2, "b")]), { participant: participant("p3", T2), isControl: false, isDriver: false }).injects as Array<{ progress: unknown }>)[0];
    expect(comms.progress).toEqual({ voted: 1, required: 1 });
    const noTeam = (crisisSimMode.project(view(votes), { participant: participant("o1", null, ["observer"]), isControl: false, isDriver: false }).injects as Array<{ progress: unknown }>)[0];
    expect(noTeam.progress).toEqual({ voted: 0, required: 0 });
    const c = (crisisSimMode.project(view(votes), control).injects as Array<{ progress: unknown }>)[0];
    expect(c.progress).toEqual({ voted: 2, required: 3 });
  });

  it("withholds narrative, artifacts and follow-ups of an update that does not target the player's team", () => {
    const out = crisisSimMode.project(view([], { targetTeamIds: [T2] }), player);
    const inj = (out.injects as Array<Record<string, unknown>>)[0];
    expect(inj.forMyTeam).toBe(false);
    expect(inj.narrativeMd).toBe("");
    expect(inj.artifacts).toEqual([]);
    expect(inj.outcomes).toEqual([]);
    expect(inj.question).toBeNull();
    expect(JSON.stringify(out)).not.toContain("Ransomware note");
  });

  it("marks the decision maker's question", () => {
    const dm = participant("p1", T1, ["player"], true);
    const v = view([vote("v1", "p1", T1, "a")]);
    v.participants = [dm, ...v.participants.filter((p) => p.id !== "p1")];
    const out = crisisSimMode.project(v, { participant: dm, isControl: false, isDriver: false });
    const inj = (out.injects as Array<Record<string, unknown>>)[0];
    expect((inj.question as { iDecide: boolean }).iDecide).toBe(true);
    expect((inj.myVote as { decider: boolean }).decider).toBe(true);
  });

  it("gives control the quality table, live decisions and the score", () => {
    const out = crisisSimMode.project(view([vote("v1", "p1", T1, "a")]), control);
    const injects = out.injects as Array<Record<string, unknown>>;
    const c = injects[0].control as { quality: unknown; decisions: Record<string, unknown>; rationales: unknown };
    expect(c.quality).toBeTruthy();
    expect(c.decisions.Legal).toEqual({ optionId: "a", source: "majority" });
    expect(c.rationales).toBeTruthy();
    expect(out.score).toBeTruthy();
  });

  it("shows clocks the open update starts as running", () => {
    const v = view([], { scenarioTime: new Date("2026-03-07T02:10:00Z") });
    const withTemplate = {
      ...v,
      clocks: [{ key: "insurer_notice", label: "Insurer", status: "pending", triggeredAt: null, deadlineAt: null, metAt: null }],
      template: {
        id: "t-1",
        mode: "crisissim" as const,
        config: { teams: ["Legal", "Comms"], regulatoryClocks: [{ key: "insurer_notice", label: "Insurer", durationHours: 48 }] },
        branching: "linear" as const,
        injects: [],
        branches: [],
      },
    };
    const out = crisisSimMode.project(withTemplate, player);
    const clocks = out.clocks as Array<Record<string, unknown>>;
    expect(clocks[0]).toMatchObject({ status: "running", triggeredAt: "2026-03-07T02:10:00.000Z", deadlineAt: "2026-03-09T02:10:00.000Z" });
  });

  it("projects the timezone, UTC by default", () => {
    expect(crisisSimMode.project(view([]), player).timezone).toBe("UTC");
    expect(crisisSimMode.project({ ...view([]), timezone: "America/New_York" } as ExerciseView<ExerciseConfig>, player).timezone).toBe("America/New_York");
  });
});

describe("crisisSim project: reveal, clocks, debrief", () => {
  const templateConfig = {
    schemaVersion: 1,
    teams: ["Legal", "Comms"],
    regulatoryClocks: [{ key: "sec_8k", label: "SEC Form 8-K Item 1.05", businessDays: 4 }],
  };
  const closeSummary = {
    pathAtClose: "optimal",
    newPath: "degrading",
    pathShifted: true,
    voteCount: 2,
    abstainCount: 1,
    distribution: { Legal: { a: 2 }, Comms: { b: 1 } },
    decisions: { Legal: { optionId: "a", source: "majority" }, Comms: { optionId: "b", source: "majority" } },
    majority: { Legal: "a", Comms: "b" },
    best: { Legal: "a", Comms: "c" },
    scoreBefore: 0,
    scoreAfter: 3,
    delta: 3,
    clockUpdates: [{ key: "sec_8k", action: "trigger" }],
  };

  function closedView(status: "live" | "ended", responses: ResponseRow[] = [], cfg: Partial<ExerciseConfig> = {}): ExerciseView<ExerciseConfig> {
    const s = snap(responses, 3, "degrading");
    const c = { ...config, ...cfg };
    return {
      ...s,
      config: c,
      exercise: { ...s.exercise, status, config: c },
      injects: [inject],
      template: { id: "t-1", mode: "crisissim", config: templateConfig, branching: "linear", injects: [], branches: [] },
      responses,
      grades: [],
      closeSummaries: { [inject.id]: closeSummary },
      now: new Date(),
    };
  }
  const endedView = (responses: ResponseRow[] = []) => closedView("ended", responses);
  const player: Viewer = { participant: participant("p1", T1), isControl: false, isDriver: false };
  const control: Viewer = { participant: participant("f1", null, ["lead_facilitator"]), isControl: true, isDriver: true };

  it("shows players their own team's split and decision after close, never the intended best", () => {
    const out = crisisSimMode.project(closedView("live"), player);
    const inj = (out.injects as Array<Record<string, unknown>>)[0];
    expect(inj.reveal).toEqual({ distribution: { Legal: { a: 2 } }, decisions: { Legal: { optionId: "a", source: "majority" } } });
    const text = JSON.stringify(out);
    expect(text).not.toContain('"best"');
    expect(text).not.toContain("Prompt notice is required.");
  });

  it("hides the split when revealSplit is off and shows the best only when revealBest is on", () => {
    const off = crisisSimMode.project(closedView("live", [], { revealSplit: false }), player);
    expect((off.injects as Array<Record<string, unknown>>)[0].reveal).toBeUndefined();
    const best = crisisSimMode.project(closedView("live", [], { revealBest: true }), player);
    expect(((best.injects as Array<Record<string, unknown>>)[0].reveal as { best: unknown }).best).toEqual({ Legal: "a" });
  });

  it("reveals the intended best and its rationale at the debrief", () => {
    const out = crisisSimMode.project(endedView(), player);
    const inj = (out.injects as Array<Record<string, unknown>>)[0];
    expect((inj.reveal as { best: unknown }).best).toEqual({ Legal: "a" });
    const debrief = out.debrief as { keyDecisions: Array<{ team: string; best: { rationale: string } | null; decision: { text: string } | null; source: string; split: unknown[] }> };
    const legal = debrief.keyDecisions.find((k) => k.team === "Legal")!;
    expect(legal.best?.rationale).toBe("Prompt notice is required.");
    expect(legal.decision?.text).toBe("Notify now");
    expect(legal.source).toBe("majority");
    expect(legal.split).toHaveLength(3);
  });

  it("derives clocks from close updates at scenario time", () => {
    const out = crisisSimMode.project(endedView(), player);
    const clocks = out.clocks as Array<Record<string, unknown>>;
    expect(clocks).toHaveLength(1);
    expect(clocks[0].status).toBe("running");
    expect(clocks[0].triggeredAt).toBe("2026-03-07T02:10:00.000Z");
    // Saturday 02:10 plus 4 business days is Thursday.
    expect(clocks[0].deadlineAt).toBe("2026-03-12T02:10:00.000Z");
    const debrief = out.debrief as { clocks: Array<{ outcome: string }> };
    expect(debrief.clocks[0].outcome).toBe("open");
  });

  it("keeps scores and quality out of the player debrief", () => {
    const out = crisisSimMode.project(endedView([vote("v1", "p1", T1, "a")]), player);
    const debrief = out.debrief as Record<string, unknown>;
    expect(debrief).toBeTruthy();
    const text = JSON.stringify(out);
    expect(text).not.toContain("scoreAfter");
    expect(text).not.toContain("scoreBefore");
    expect(text).not.toContain('"quality"');
    expect(text).not.toContain("great");
    expect(text).not.toContain("cumulative");
    const moves = debrief.moves as Array<{ decisions: Array<{ team: string; decision: { text: string } | null }> }>;
    expect(moves[0].decisions.find((d) => d.team === "Legal")?.decision?.text).toBe("Notify now");
    expect(debrief.noVoteCount).toBe(1);
  });

  it("gives control the score arc and quality of the moving decisions", () => {
    const out = crisisSimMode.project(endedView(), control);
    const debrief = out.debrief as {
      arc: Array<{ scoreAfter: number }>;
      moves: Array<{ decisions: Array<{ team: string; quality?: string }> }>;
      individual?: unknown;
    };
    expect(debrief.arc[0].scoreAfter).toBe(3);
    expect(debrief.moves[0].decisions.find((d) => d.team === "Legal")?.quality).toBe("great");
    expect(debrief.individual).toBeUndefined();
  });

  it("includes individual metrics for control only when enabled", () => {
    const v = endedView([{ ...vote("v1", "p1", T1, "a"), payload: { optionId: "a", quality: "great", pathAtVote: "optimal" } }]);
    const on = { ...config, individualMetrics: true };
    const withMetrics = { ...v, config: on, exercise: { ...v.exercise, config: on } };
    const out = crisisSimMode.project(withMetrics, control);
    expect((out.debrief as { individual: Array<{ great: number }> }).individual[0].great).toBe(1);
    const pout = crisisSimMode.project(withMetrics, player);
    expect((pout.debrief as { individual?: unknown }).individual).toBeUndefined();
  });

  it("shows players their own deliverable but not grades; the debrief lists it with the grade for control", () => {
    const d: ResponseRow = { id: "d1", injectId: inject.id, participantId: "p1", teamId: T1, kind: "deliverable", payload: { text: "We are investigating." }, status: "submitted", createdAt: new Date() };
    const withDeliverable = { ...inject, content: { ...content, deliverable: { team: "Legal", teamId: T1, kind: "holding_statement", prompt: "Write the holding statement." } } };
    const base = endedView([d]);
    const v = {
      ...base,
      injects: [withDeliverable],
      grades: [{ id: "g1", responseId: "d1", source: "human" as const, attempt: 1, score: 3, rating: "met", rationale: "Clear.", createdAt: new Date() }],
    };
    const pout = crisisSimMode.project(v, player);
    const pinj = (pout.injects as Array<Record<string, unknown>>)[0];
    expect((pinj.myDeliverable as { text: string }).text).toBe("We are investigating.");
    expect(JSON.stringify(pout)).not.toContain('"rationale":"Clear."');
    const cout = crisisSimMode.project(v, control);
    const cinj = (cout.injects as Array<{ control: { deliverables: Array<{ grade: { rating: string } }> } }>)[0];
    expect(cinj.control.deliverables[0].grade.rating).toBe("met");
    const deliverables = (cout.debrief as { deliverables: Array<{ text: string; grade: { rating: string } }> }).deliverables;
    expect(deliverables[0].text).toBe("We are investigating.");
    expect(deliverables[0].grade.rating).toBe("met");
  });

  it("never sends secret tables to players after ENDEX, only the intended option, its rationale and outcomes", () => {
    const out = crisisSimMode.project(endedView([vote("v1", "p1", T1, "a")]), player);
    const text = JSON.stringify(out);
    for (const secretKey of ['"quality"', '"clockEffects"', '"rationales"', '"deliverableCriteria"', '"control"', '"clockTriggers"']) {
      expect(text, secretKey).not.toContain(secretKey);
    }
    // Follow-up lines for options nobody chose and rationales of other options stay hidden.
    expect(text).not.toContain("Legal waited.");
    expect(text).not.toContain("Waiting misses the deadline.");
    expect(text).toContain("Prompt notice is required.");
  });

  it("returns no debrief while live", () => {
    const out = crisisSimMode.project(closedView("live"), player);
    expect(out.debrief).toBeNull();
  });
});
