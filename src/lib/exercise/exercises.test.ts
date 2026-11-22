// @vitest-environment node
// Pure helpers of the exercise lifecycle: feed redaction, time labels, MSEL CSV.
import { describe, expect, it, vi } from "vitest";
import { feedFor, publicPlan, type RawEvent } from "@/lib/exercise/runtime/view";
import type { ExerciseSnapshot, InjectRow, Viewer } from "@/lib/exercise/runtime/types";
import { attackTagsOf, csvCell, expectedActionLines, mselCsv, questionsOf, scheduleOffsets } from "./msel";
import { elapsedMs, formatTimer, nextAnchorDate, scenarioLabel, scenarioOffset, zonedWallTime } from "./time";
import { guestCap } from "./join";
import { isExcuse } from "./participants";
import { readPlan, templateInjectsForObjective } from "./schemas";

// join.ts and participants.ts reach next-auth through @/auth/guest; it cannot load under vitest.
vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const at = new Date("2026-10-20T12:00:00Z");

function inject(id: string, targetTeamIds: string[] = []): InjectRow {
  return {
    id,
    seq: 1,
    status: "open",
    source: "template",
    title: `Inject ${id}`,
    scenarioTime: null,
    targetTeamIds,
    content: {},
    secret: { quality: "hidden" },
    templateInjectId: null,
    budgetMs: null,
    openedAt: at,
    closesAt: null,
    closedAt: null,
    closeTrigger: null,
  };
}

const snapshot = {
  exercise: { mode: "crisissim" },
  injects: [inject("i1"), inject("i2", ["teamB"])],
} as unknown as ExerciseSnapshot;

const events: RawEvent[] = [
  { id: "e1", type: "startex", at, injectId: null, data: { at: at.toISOString() } },
  { id: "e2", type: "inject_released", at, injectId: "i1", data: { seq: 1 } },
  { id: "e3", type: "inject_released", at, injectId: "i2", data: { seq: 2 } },
  { id: "e4", type: "broadcast", at, injectId: null, data: { message: "Everyone", teamId: null } },
  { id: "e5", type: "broadcast", at, injectId: null, data: { message: "Team A only", teamId: "teamA" } },
  { id: "e6", type: "broadcast", at, injectId: null, data: { message: "Team B only", teamId: "teamB" } },
  { id: "e7", type: "path_shift", at, injectId: "i1", data: { from: "optimal", to: "degrading", scoreBefore: 0, scoreAfter: -1, delta: -1 } },
  { id: "e8", type: "decision", at, injectId: "i1", data: { distribution: { a: 2 } } },
  { id: "e9", type: "inject_closed", at, injectId: "i1", data: { summary: { best: { A: "a" } } } },
];

const player = (teamId: string | null): Viewer => ({
  participant: { id: "p", userId: null, displayName: "P", title: null, teamId, roles: ["player"], isDecisionMaker: false, isGuest: true, joinedAt: null, leftAt: null, removedAt: null },
  isControl: false,
  isDriver: false,
});

describe("feedFor", () => {
  it("gives control every event unchanged", () => {
    const feed = feedFor(events, snapshot, { participant: null, isControl: true, isDriver: true });
    expect(feed.map((f) => f.id)).toEqual(events.map((e) => e.id));
    expect(feed.find((f) => f.type === "path_shift")?.data.scoreAfter).toBe(-1);
  });

  it("filters a player's feed by type and team and drops scores", () => {
    const feed = feedFor(events, snapshot, player("teamA"));
    expect(feed.map((f) => f.id)).toEqual(["e1", "e2", "e4", "e5", "e7"]);
    expect(feed.find((f) => f.type === "path_shift")?.data).toEqual({ to: "Under strain" });
    expect(JSON.stringify(feed)).not.toMatch(/score|delta|distribution|best/);
  });

  it("shows team B its own broadcast and inject", () => {
    const feed = feedFor(events, snapshot, player("teamB"));
    expect(feed.filter((f) => f.type === "broadcast").map((f) => f.data.message)).toEqual(["Everyone", "Team B only"]);
    expect(feed.filter((f) => f.type === "inject_released").map((f) => f.data.injectId)).toEqual(["i1", "i2"]);
  });

  it("gives a player without a team only the shared broadcasts", () => {
    const feed = feedFor(events, snapshot, player(null));
    expect(feed.filter((f) => f.type === "broadcast").map((f) => f.data.message)).toEqual(["Everyone"]);
  });
});

describe("time labels", () => {
  it("formats scenario offsets and labels in the instance zone", () => {
    const start = new Date("2026-10-17T00:00:00Z");
    expect(scenarioOffset(new Date("2026-10-17T06:10:00Z"), start)).toBe("T+6h 10m");
    expect(scenarioOffset(new Date("2026-10-18T07:00:00Z"), start)).toBe("T+1d 7h 0m");
    expect(scenarioLabel("2026-10-17T06:10:00Z", start, "UTC")).toBe("T+6h 10m, Sat 06:10 UTC");
    expect(scenarioLabel(null, start, "UTC")).toBeNull();
  });

  it("subtracts pauses from elapsed time", () => {
    const now = Date.parse("2026-10-20T13:00:00Z");
    const ex = { startedAt: "2026-10-20T12:00:00Z", pausedAt: "2026-10-20T12:50:00Z", pausedMsTotal: 5 * 60_000 };
    expect(elapsedMs(ex, now)).toBe(45 * 60_000);
    expect(formatTimer(45 * 60_000)).toBe("45:00");
    expect(formatTimer(3_725_000)).toBe("1:02:05");
  });
});

describe("MSEL CSV", () => {
  it("quotes cells and neutralizes formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
  });

  it("reads expected actions from strings and objects", () => {
    expect(expectedActionLines(["Isolate", { team: "Exec", text: "Brief board" }, { Tech: ["Pull logs"] }])).toEqual([
      "Isolate",
      "Exec: Brief board",
      "Tech: Pull logs",
    ]);
  });

  it("writes a header and one line per row", () => {
    const csv = mselCsv(
      [
        {
          kind: "planned",
          injectId: null,
          templateInjectId: "t",
          seq: 1,
          title: "One",
          status: "planned",
          scenarioTime: null,
          scenarioOffsetMin: 0,
          deliveredAt: null,
          closedAt: null,
          closeTrigger: null,
          targetTeams: ["All teams"],
          objectives: [],
          expectedActions: [],
          controllerNotes: null,
          scheduledOffsetMin: 5,
          scheduledAt: null,
          decisions: [{ team: "Exec", question: "Pay?", owner: "CEO", best: "No" }],
          techniques: ["T1486"],
        },
      ],
      "UTC",
    );
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Close trigger"');
    expect(lines[1]).toContain('"STARTEX + 5 min"');
    expect(lines[1]).toContain('"Exec (CEO). Pay?"');
    expect(lines[1]).toContain('"Exec. No"');
    expect(lines[0]).toContain('"ATT&CK techniques"');
    expect(lines[1]).toContain('"T1486 Data Encrypted for Impact"');
  });

  it("reads ATT&CK tags from either mode and drops unknown IDs", () => {
    expect(attackTagsOf({ attackTechniques: ["t1486", "T9999", "T1486"] })).toEqual(["T1486"]);
    expect(attackTagsOf({ mitreTags: ["T1078.004"] })).toEqual(["T1078.004"]);
    expect(attackTagsOf(null)).toEqual([]);
  });

  it("schedules injects from planned minutes, else an even split of the time box", () => {
    const offsets = scheduleOffsets(
      [
        { id: "a", plannedDelayMin: 10 },
        { id: "b", plannedDelayMin: null },
        { id: "c", plannedDelayMin: 5 },
      ],
      60,
    );
    expect([...offsets.values()]).toEqual([0, 10, 30]);
    expect([...scheduleOffsets([{ id: "a", plannedDelayMin: null }, { id: "b", plannedDelayMin: 5 }], null).values()]).toEqual([0, null]);
  });

  it("reads decision questions from any content shape", () => {
    expect(questionsOf({ questions: [{ team: "Exec", stem: "Pay?", decisionOwner: "CEO", options: [{ id: "a", text: "No" }] }] })).toEqual([
      { team: "Exec", question: "Pay?", owner: "CEO", options: [{ id: "a", text: "No" }] },
    ]);
    expect(questionsOf({ module: {} })).toEqual([]);
  });
});

describe("scenario anchor", () => {
  it("finds the next matching weekday and wall time in the zone", () => {
    // Tuesday 2026-10-20 12:00 UTC. Friday 17:30 in New York (EDT, UTC-4) is 21:30 UTC.
    expect(nextAnchorDate(at, { weekday: 5, time: "17:30" }, "America/New_York")?.toISOString()).toBe("2026-10-23T21:30:00.000Z");
    // Same weekday, time already passed: next week.
    expect(nextAnchorDate(at, { weekday: 2, time: "09:00" }, "UTC")?.toISOString()).toBe("2026-10-27T09:00:00.000Z");
    expect(nextAnchorDate(at, { weekday: 2, time: "13:00" }, "UTC")?.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(nextAnchorDate(at, { weekday: 9, time: "13:00" }, "UTC")).toBeNull();
    expect(nextAnchorDate(at, { weekday: 1, time: "25:00" }, "UTC")).toBeNull();
  });

  it("handles a daylight saving change", () => {
    // 2026-11-02 is after the US fall back: 09:00 EST is 14:00 UTC.
    expect(zonedWallTime(2026, 11, 2, 9, 0, "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("plan and roster helpers", () => {
  it("player brief carries only public plan fields", () => {
    const p = publicPlan(
      { sponsor: "CFO", hazard: "Ransomware", scope: "IT", stopWord: "REDWOOD", objectiveKeys: { x: "y" } },
      { executiveBriefMd: "Brief", teams: ["A"] },
    );
    expect(p).toEqual({ executiveBriefMd: "Brief", scope: "IT", groundRules: "", assumptions: "", stopWord: "REDWOOD", noFaultStatement: "" });
  });

  it("lobby links replace template key links", () => {
    const tInjects = [
      { id: "t1", objectiveKeys: ["contain"] },
      { id: "t2", objectiveKeys: [] },
    ];
    const plan = readPlan({ objectiveKeys: { o1: "contain" }, objectiveTemplateInjects: { o2: ["t2"] } });
    expect(templateInjectsForObjective(plan, "o1", tInjects)).toEqual(["t1"]);
    expect(templateInjectsForObjective(plan, "o2", tInjects)).toEqual(["t2"]);
    expect(templateInjectsForObjective(plan, "o3", tInjects)).toEqual([]);
  });

  it("excuse means player out, observer in", () => {
    expect(isExcuse(["player"], ["observer"])).toBe(true);
    expect(isExcuse(["player"], ["scribe"])).toBe(false);
    expect(isExcuse(["observer"], ["observer"])).toBe(false);
  });

  it("guest cap reads the env and falls back to 60", () => {
    expect(guestCap({})).toBe(60);
    expect(guestCap({ GUEST_CAP_PER_EXERCISE: "12" })).toBe(12);
    expect(guestCap({ GUEST_CAP_PER_EXERCISE: "zero" })).toBe(60);
  });
});
