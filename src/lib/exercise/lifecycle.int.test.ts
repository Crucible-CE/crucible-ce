// @vitest-environment node
// Exercise lifecycle against Postgres (ce_test): create, start, respond,
// close races, pause, advance races, access, redaction, ENDEX.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { resolvePrincipal } from "@/lib/exercise/auth/guest";
import {
  advanceExercise,
  closeIfResponsesComplete,
  closeInject,
  endExercise,
  pauseExercise,
  resumeExercise,
  startExercise,
  submitResponse,
} from "@/lib/exercise/runtime/engine";
import { ResponseError } from "@/lib/exercise/runtime/types";
import { toParticipantRow } from "@/lib/exercise/runtime/snapshot";
import { AccessError, projectFor, type Principal } from "@/lib/exercise/runtime/view";
import { createExercise } from "./create";
import { seedCapabilities } from "./seed-capabilities";
import { createCrisisTemplateFixture, FIXTURE_TEAMS } from "./test-fixture";
import { joinByCode } from "./join";
import { updateExercise } from "./lobby";
import { runControl } from "./control";
import { buildMsel, mselCsv } from "./msel";
import { updateParticipant } from "./participants";
import { formatDayTime } from "./time";
import { POST as respondRoute } from "@/app/api/play/[id]/respond/route";

// Trust one proxy hop so X-Forwarded-For gives each test its own client IP.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = "1";
});

// next-auth cannot load under vitest; these paths never need a session.
vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// The respond route resolves its caller here; tests set the guest directly.
vi.mock("@/lib/exercise/auth/guest", async (orig) => ({ ...(await orig<typeof import("@/lib/exercise/auth/guest")>()), resolvePrincipal: vi.fn() }));

type Policy = "facilitator" | "votes_in" | "timer";

async function makeUser(role: "admin" | "facilitator" | "member" = "facilitator"): Promise<SessionUser> {
  return await createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name: "Fran Facilitator", role: role });
}

async function setup(opts: { policy: Policy; perTeam: number; plannedDelayMin?: number | null }) {
  const user = await makeUser();
  const templateId = await createCrisisTemplateFixture(db, { createdById: user.id, plannedDelayMin: opts.plannedDelayMin });
  // Hold after close is on by default; these tests drive the auto-advance path.
  const { id } = await createExercise(
    { mode: "crisissim", title: "Lifecycle test", templateId, advancePolicy: opts.policy, config: { holdAfterClose: false } },
    user,
  );
  const teams = await db.team.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" } });
  const players = [];
  for (const team of teams) {
    for (let i = 0; i < opts.perTeam; i++) {
      players.push(
        await db.participant.create({
          data: { exerciseId: id, displayName: `${team.name} player ${i + 1}`, isGuest: true, roles: ["player"], teamId: team.id },
        }),
      );
    }
  }
  return { user, templateId, exerciseId: id, teams, players: players.map(toParticipantRow) };
}

async function openInject(exerciseId: string) {
  return db.inject.findFirst({ where: { exerciseId, status: "open" }, orderBy: { seq: "desc" } });
}

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const vote = (exerciseId: string, injectId: string, participant: ReturnType<typeof toParticipantRow>, optionId = "a") =>
  submitResponse({ exerciseId, injectId, participant, kind: "vote", raw: { optionId } });

describe.skipIf(!hasTestDb)("exercise lifecycle (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    // Let any fire-and-forget advance from the previous test settle.
    await new Promise((r) => setTimeout(r, 100));
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent", "RateLimitBucket");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200));
    await db.$disconnect();
  });

  it("creates a draft with teams, objectives, clocks and the creator as lead facilitator", async () => {
    const { exerciseId, user } = await setup({ policy: "votes_in", perTeam: 0 });
    const ex = await db.exercise.findUniqueOrThrow({
      where: { id: exerciseId },
      include: { teams: true, objectives: { orderBy: { seq: "asc" } }, clocks: true, participants: true },
    });
    expect(ex.status).toBe("draft");
    expect(ex.advancePolicy).toBe("votes_in");
    expect(ex.teams.map((t) => t.name).sort()).toEqual([...FIXTURE_TEAMS].sort());
    expect(ex.objectives.map((o) => o.text)).toHaveLength(2);
    expect(ex.objectives.every((o) => o.capabilityIds.length === 1)).toBe(true);
    expect(ex.objectives.every((o) => o.injectIds.length === 0)).toBe(true);
    expect(ex.clocks.map((c) => c.key)).toEqual(["sec_8k"]);
    expect(ex.participants).toHaveLength(1);
    expect(ex.participants[0]).toMatchObject({ userId: user.id, roles: ["lead_facilitator"] });
    expect(ex.joinCode).toMatch(/^[A-Z2-9]{8}$/);
  });

  it("start opens the first inject; votes by every required player close it and open the second", async () => {
    const { exerciseId, players } = await setup({ policy: "votes_in", perTeam: 1 });
    await startExercise(exerciseId, {});
    const first = await openInject(exerciseId);
    expect(first?.seq).toBe(1);
    expect(first?.closesAt).not.toBeNull();

    await vote(exerciseId, first!.id, players[0]!);
    expect((await db.inject.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe("open");
    await vote(exerciseId, first!.id, players[1]!);

    const closed = await db.inject.findUniqueOrThrow({ where: { id: first!.id } });
    expect(closed.status).toBe("closed");
    expect(closed.closeTrigger).toBe("votes_in");
    const second = await waitFor(async () => {
      const i = await openInject(exerciseId);
      return i && i.seq === 2 ? i : null;
    });
    expect(second.title).toBe("Reporter calls");
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    expect(ex.currentInjectId).toBe(second.id);
    // The clock effect of the Executive majority (option a) started the SEC clock.
    const clock = await db.regulatoryClock.findFirstOrThrow({ where: { exerciseId } });
    expect(clock.status).toBe("running");
  });

  it("10 votes racing a facilitator close: each vote is scored or rejected with 409, one close", async () => {
    // Several rounds with staggered votes so the close lands in the middle of the burst.
    let accepted = 0;
    let rejected = 0;
    for (const closeDelay of [0, 10, 25, 40]) {
      const { exerciseId, players } = await setup({ policy: "facilitator", perTeam: 5 });
      await startExercise(exerciseId, {});
      const inj = (await openInject(exerciseId))!;
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const results = await Promise.allSettled([
        ...players.slice(0, 10).map((p, i) => delay(i * 6).then(() => vote(exerciseId, inj.id, p))),
        delay(closeDelay).then(() => closeInject(exerciseId, inj.id, "facilitator", {}, { autoAdvance: false })),
      ]);
      const voteResults = results.slice(0, 10);
      for (const r of voteResults) {
        if (r.status === "rejected") {
          expect(r.reason).toBeInstanceOf(ResponseError);
          expect((r.reason as ResponseError).status).toBe(409);
        }
      }
      expect(results[10]!.status).toBe("fulfilled");
      expect((results[10] as PromiseFulfilledResult<{ closed: boolean }>).value.closed).toBe(true);

      const rows = await db.response.findMany({ where: { injectId: inj.id, kind: "vote" } });
      // Every required player has exactly one row: a scored vote or a scored abstain. None unscored.
      expect(rows).toHaveLength(10);
      for (const r of rows) expect((r.payload as Record<string, unknown>).quality).toBeDefined();
      const ok = voteResults.filter((r) => r.status === "fulfilled").length;
      expect(rows.filter((r) => !(r.payload as Record<string, unknown>).abstain)).toHaveLength(ok);
      expect(await db.exerciseEvent.count({ where: { exerciseId, type: "inject_closed" } })).toBe(1);
      accepted += ok;
      rejected += 10 - ok;
    }
    // The rounds must actually race: some votes land before the close and some after.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("timer close racing a facilitator close closes once", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const inj = await openInject(exerciseId);
    const [a, b] = await Promise.all([
      closeInject(exerciseId, inj!.id, "timer", {}, { autoAdvance: false }),
      closeInject(exerciseId, inj!.id, "facilitator", {}, { autoAdvance: false }),
    ]);
    expect([a.closed, b.closed].filter(Boolean)).toHaveLength(1);
    expect(await db.exerciseEvent.count({ where: { exerciseId, type: "inject_closed" } })).toBe(1);
  });

  it("a vote after close is rejected with 409", async () => {
    const { exerciseId, players } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const inj = await openInject(exerciseId);
    await closeInject(exerciseId, inj!.id, "facilitator", {}, { autoAdvance: false });
    await expect(vote(exerciseId, inj!.id, players[0]!)).rejects.toMatchObject({ status: 409 });
  });

  it("pause and resume shift closesAt by the paused time", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const before = (await openInject(exerciseId))!;
    await pauseExercise(exerciseId, {});
    await db.exercise.update({ where: { id: exerciseId }, data: { pausedAt: new Date(Date.now() - 60_000) } });
    await resumeExercise(exerciseId, {});
    const after = await db.inject.findUniqueOrThrow({ where: { id: before.id } });
    const shift = after.closesAt!.getTime() - before.closesAt!.getTime();
    expect(shift).toBeGreaterThanOrEqual(60_000);
    expect(shift).toBeLessThan(65_000);
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    expect(ex.pausedMsTotal).toBeGreaterThanOrEqual(60_000);
    expect(ex.status).toBe("live");
  });

  it("two concurrent advances publish exactly one inject", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const first = (await openInject(exerciseId))!;
    await closeInject(exerciseId, first.id, "facilitator", {}, { autoAdvance: false });
    const results = await Promise.all([advanceExercise(exerciseId, {}), advanceExercise(exerciseId, {})]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const injects = await db.inject.findMany({ where: { exerciseId }, orderBy: { seq: "asc" } });
    expect(injects.map((i) => i.status)).toEqual(["closed", "open"]);
    expect(new Set(injects.map((i) => i.templateInjectId)).size).toBe(2);
  });

  it("a guest cannot project another exercise; player projections never carry hidden scoring", async () => {
    const a = await setup({ policy: "facilitator", perTeam: 2 });
    const b = await setup({ policy: "facilitator", perTeam: 1 });
    const guestA: Principal = { kind: "guest", exerciseId: a.exerciseId, participantId: a.players[0]!.id };
    await expect(projectFor(b.exerciseId, guestA)).rejects.toBeInstanceOf(AccessError);
    await expect(projectFor(b.exerciseId, { ...guestA, exerciseId: b.exerciseId })).rejects.toMatchObject({ status: 403 });

    await startExercise(a.exerciseId, {});
    const inj = (await openInject(a.exerciseId))!;
    await vote(a.exerciseId, inj.id, a.players[0]!, "a");
    await vote(a.exerciseId, inj.id, a.players[2]!, "c");
    await closeInject(a.exerciseId, inj.id, "facilitator", {}, { autoAdvance: false });
    // Team-scoped broadcasts: one for each team, one for everyone.
    const [t1, t2] = a.teams;
    await runControl({ exerciseId: a.exerciseId, actor: {}, req: new Request("http://x") }, { action: "broadcast", message: "All hands", teamId: null });
    await runControl({ exerciseId: a.exerciseId, actor: {}, req: new Request("http://x") }, { action: "broadcast", message: "Only team one", teamId: t1!.id });
    await runControl({ exerciseId: a.exerciseId, actor: {}, req: new Request("http://x") }, { action: "broadcast", message: "Only team two", teamId: t2!.id });

    const state = await projectFor(a.exerciseId, guestA);
    const json = JSON.stringify(state);
    expect(json).not.toContain("quality");
    expect(json).not.toContain("clockEffects");
    expect(json).not.toContain("scoreBefore");
    expect(json).not.toContain("cumulative");
    const feed = state.feed as Array<{ type: string; data: Record<string, unknown> }>;
    const messages = feed.filter((f) => f.type === "broadcast").map((f) => f.data.message);
    expect(messages).toEqual(["All hands", "Only team one"]);
    const shift = feed.find((f) => f.type === "path_shift");
    expect(shift?.data).toEqual({ to: expect.any(String) });
    expect(feed.some((f) => f.type === "decision" || f.type === "inject_closed")).toBe(false);

    // Control sees everything, including scores.
    const control = await projectFor(a.exerciseId, { kind: "user", userId: a.user.id, accountRole: "facilitator" });
    const controlFeed = control.feed as Array<{ type: string }>;
    expect(controlFeed.filter((f) => f.type === "broadcast")).toHaveLength(3);
    expect(JSON.stringify(control)).toContain("quality");
  });

  it("endExercise closes the open inject with trigger endex and deletes pending and held injects", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const open = (await openInject(exerciseId))!;
    await db.inject.create({ data: { exerciseId, seq: 50, status: "pending", title: "Preparing" } });
    await db.inject.create({ data: { exerciseId, seq: 51, status: "held", title: "Held one" } });
    expect(await endExercise(exerciseId, "facilitator", {})).toBe(true);
    const closed = await db.inject.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed).toMatchObject({ status: "closed", closeTrigger: "endex" });
    expect(await db.inject.count({ where: { exerciseId, status: { in: ["pending", "held"] } } })).toBe(0);
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    expect(ex).toMatchObject({ status: "ended", endReason: "facilitator" });
    expect(await endExercise(exerciseId, "facilitator", {})).toBe(false);
  });

  it("guest join: code rules, unique names, team checks, lock after repeated failures", async () => {
    const { exerciseId, teams } = await setup({ policy: "votes_in", perTeam: 0 });
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    const req = () => new Request("http://localhost/api/join", { headers: { "x-forwarded-for": "203.0.113.9" } });
    const join = (displayName: string, teamId: string | null = teams[0]!.id, code = ex.joinCode!) =>
      joinByCode(req(), { code, displayName, teamId }, null);

    // Join by code is off and the exercise is a draft.
    await expect(join("Ana")).rejects.toMatchObject({ status: 404 });
    await updateExercise(exerciseId, { guestJoin: true });
    await expect(join("Ana")).rejects.toMatchObject({ status: 404 });
    await runControl({ exerciseId, actor: {}, req: req() }, { action: "open_lobby" });

    const ok = await join("Ana");
    expect(ok).toMatchObject({ kind: "guest", exerciseId });
    const p = await db.participant.findFirstOrThrow({ where: { exerciseId, displayName: "Ana" } });
    expect(p).toMatchObject({ isGuest: true, roles: ["player"], teamId: teams[0]!.id });

    await expect(join("ana")).rejects.toMatchObject({ status: 409 });
    await expect(join("Ben", "not-a-team")).rejects.toMatchObject({ status: 400 });
    await expect(join("Facilitator")).rejects.toMatchObject({ status: 400 });
    // Lowercase with a dash still matches.
    const dashed = `${ex.joinCode!.slice(0, 4).toLowerCase()}-${ex.joinCode!.slice(4).toLowerCase()}`;
    await expect(join("Cy", teams[1]!.id, dashed)).resolves.toMatchObject({ kind: "guest" });

    await db.exercise.update({ where: { id: exerciseId }, data: { joinCodeFailures: 20 } });
    await expect(join("Dee")).rejects.toMatchObject({ status: 403 });
  });

  it("MSEL lists delivered and planned injects with linked objectives and exports CSV", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await runControl({ exerciseId, actor: {}, req: new Request("http://x") }, { action: "start" });
    const msel = await buildMsel(exerciseId);
    expect(msel.rows.map((r) => [r.seq, r.status])).toEqual([
      [1, "open"],
      [2, "planned"],
    ]);
    expect(msel.rows[0]!.objectives.map((o) => o.text)).toEqual(["Decide on containment within the first hour."]);
    expect(msel.rows[0]!.expectedActions).toContain("Isolate affected hosts");
    const objective = await db.objective.findFirstOrThrow({ where: { exerciseId, seq: 1 } });
    expect(objective.injectIds).toEqual([msel.rows[0]!.injectId]);
    const csv = mselCsv(msel.rows, "UTC");
    expect(csv.split("\r\n")[0]).toContain('"Expected actions"');
    expect(csv).toContain("Reporter calls");
    // Scheduled from STARTEX by planned minutes (5 per inject in the fixture).
    expect(msel.rows.map((r) => r.scheduledOffsetMin)).toEqual([0, 5]);
    expect(msel.rows[0]!.scheduledAt).not.toBeNull();
    // Decision questions and owners per team; the best option shows after close.
    expect(msel.rows[0]!.decisions.map((d) => [d.team, d.owner, d.best])).toEqual([
      ["Executive", "Chief executive", null],
      ["Technical", "IT lead", null],
    ]);
    await closeInject(exerciseId, msel.rows[0]!.injectId!, "facilitator", {}, { autoAdvance: false });
    const after = await buildMsel(exerciseId);
    expect(after.rows[0]!.closeTrigger).toBe("facilitator");
    expect(after.rows[0]!.decisions[0]!.best).toBe("Isolate the affected systems now.");
  });

  it("new exercises take the scenario start from the template anchor and the time box from its run time", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 0 });
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    expect(ex.scenarioStartAt).not.toBeNull();
    const instance = await db.exerciseSettings.findFirst({ select: { timezone: true } });
    const tz = instance?.timezone ?? "UTC";
    expect(ex.scenarioStartAt!.getTime()).toBeGreaterThan(Date.now());
    // Friday 17:30 in the instance time zone.
    expect(formatDayTime(ex.scenarioStartAt!, tz)).toMatch(/^Fri 17:30/);
    expect(ex.timeboxMin).toBe(45);
  });

  it("STARTEX is refused when the exercise has clocks and no scenario start", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    await updateExercise(exerciseId, { scenarioStartAt: null });
    const ctx = { exerciseId, actor: {}, req: new Request("http://x") };
    await expect(runControl(ctx, { action: "start" })).rejects.toMatchObject({ status: 409 });
    expect((await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } })).status).toBe("draft");
    await updateExercise(exerciseId, { scenarioStartAt: new Date().toISOString() });
    await expect(runControl(ctx, { action: "start" })).resolves.toMatchObject({ ok: true });
  });

  it("clock control: trigger, then met at a later scenario time; met before trigger is refused", async () => {
    const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
    const ctx = { exerciseId, actor: {}, req: new Request("http://x") };
    const clock = (action: "trigger" | "met" | "reset", key = "sec_8k") => runControl(ctx, { action: "clock", clock: { key, action } });

    // Not running yet.
    await expect(clock("trigger")).rejects.toMatchObject({ status: 409 });
    await runControl(ctx, { action: "start" });
    const first = (await openInject(exerciseId))!;

    await expect(clock("met")).rejects.toMatchObject({ status: 409 });
    await expect(clock("trigger", "nope")).rejects.toMatchObject({ status: 404 });
    await clock("trigger");
    let row = await db.regulatoryClock.findFirstOrThrow({ where: { exerciseId } });
    expect(row.status).toBe("running");
    expect(row.triggeredAt?.toISOString()).toBe(first.scenarioTime!.toISOString());
    expect(row.deadlineAt!.getTime()).toBeGreaterThan(row.triggeredAt!.getTime());
    await expect(clock("trigger")).rejects.toMatchObject({ status: 409 });

    // Next inject is six scenario hours later.
    await closeInject(exerciseId, first.id, "facilitator", {}, { autoAdvance: false });
    const res = await advanceExercise(exerciseId, {});
    expect(res.ok).toBe(true);
    const second = (await openInject(exerciseId))!;
    expect(second.scenarioTime!.getTime()).toBeGreaterThan(first.scenarioTime!.getTime());
    await clock("met");
    row = await db.regulatoryClock.findFirstOrThrow({ where: { exerciseId } });
    expect(row.status).toBe("met");
    expect(row.metAt?.toISOString()).toBe(second.scenarioTime!.toISOString());
    await expect(clock("met")).rejects.toMatchObject({ status: 409 });

    await clock("reset");
    row = await db.regulatoryClock.findFirstOrThrow({ where: { exerciseId } });
    expect(row).toMatchObject({ status: "pending", triggeredAt: null, deadlineAt: null, metAt: null });
    expect(await db.exerciseEvent.count({ where: { exerciseId, type: { in: ["clock_triggered", "clock_met", "clock_reset"] } } })).toBe(3);
  });

  it("excusing a player removes them from the required voters, so votes_in closes", async () => {
    const { exerciseId, players } = await setup({ policy: "votes_in", perTeam: 1 });
    await startExercise(exerciseId, {});
    const inj = (await openInject(exerciseId))!;
    await vote(exerciseId, inj.id, players[0]!);
    expect((await db.inject.findUniqueOrThrow({ where: { id: inj.id } })).status).toBe("open");

    const change = await updateParticipant(exerciseId, { participantId: players[1]!.id, roles: ["observer"] });
    expect(change.after.roles).toEqual(["observer"]);
    expect(await db.exerciseEvent.count({ where: { exerciseId, type: "participant_excused" } })).toBe(1);
    expect(await closeIfResponsesComplete(exerciseId)).toBe(true);

    const closed = await db.inject.findUniqueOrThrow({ where: { id: inj.id } });
    expect(closed).toMatchObject({ status: "closed", closeTrigger: "votes_in" });
    // The excused player got no abstain row.
    expect(await db.response.count({ where: { injectId: inj.id, participantId: players[1]!.id } })).toBe(0);
  });

  it("ENDEX racing an advance leaves no open, held or pending inject", async () => {
    for (let round = 0; round < 4; round++) {
      const { exerciseId } = await setup({ policy: "facilitator", perTeam: 1 });
      await startExercise(exerciseId, {});
      const first = (await openInject(exerciseId))!;
      await closeInject(exerciseId, first.id, "facilitator", {}, { autoAdvance: false });
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await Promise.allSettled([advanceExercise(exerciseId, {}), delay(round * 3).then(() => endExercise(exerciseId, "facilitator", {}))]);
      // Let a losing advance finish its cleanup.
      await delay(50);
      const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
      expect(ex.status).toBe("ended");
      expect(await db.inject.count({ where: { exerciseId, status: { in: ["open", "held", "pending"] } } })).toBe(0);
    }
  });

  // CE rate limits run on Redis; without REDIS_URL they fail open.
  it.skipIf(!process.env.REDIS_URL)("join failures: only wrong codes count; name and team errors do not", async () => {
    const { exerciseId, teams } = await setup({ policy: "votes_in", perTeam: 0 });
    await updateExercise(exerciseId, { guestJoin: true });
    await runControl({ exerciseId, actor: {}, req: new Request("http://x") }, { action: "open_lobby" });
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    const req = (ip: string) => new Request("http://localhost/api/join", { headers: { "x-forwarded-for": ip } });
    const join = (ip: string, displayName: string, code = ex.joinCode!, teamId: string | null = teams[0]!.id) =>
      joinByCode(req(ip), { code, displayName, teamId }, null);

    await join("198.51.100.1", "Ana");
    // Twenty validation errors from one IP: taken name, bad name, missing team.
    for (let i = 0; i < 20; i++) {
      const attempt = i % 3 === 0 ? join("198.51.100.1", "Ana") : i % 3 === 1 ? join("198.51.100.1", "Facilitator") : join("198.51.100.1", `Zed ${i}`, ex.joinCode!, null);
      await expect(attempt).rejects.toMatchObject({ status: expect.any(Number) });
    }
    expect((await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } })).joinCodeFailures).toBe(0);
    await expect(join("198.51.100.1", "Ben")).resolves.toMatchObject({ kind: "guest" });

    // Wrong codes use up the per-IP failure budget; the next try is refused even with the right code.
    const wrong = ex.joinCode!.startsWith("A") ? `B${ex.joinCode!.slice(1)}` : `A${ex.joinCode!.slice(1)}`;
    for (let i = 0; i < 15; i++) await expect(join("198.51.100.2", `Cy ${i}`, wrong)).rejects.toMatchObject({ status: 404 });
    await expect(join("198.51.100.2", "Cy")).rejects.toMatchObject({ status: 429 });
    expect((await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } })).joinCodeFailures).toBe(0);
  });

  // CE rate limits run on Redis; without REDIS_URL they fail open.
  it.skipIf(!process.env.REDIS_URL)("caps guests per exercise and per IP", async () => {
    const { exerciseId, teams } = await setup({ policy: "votes_in", perTeam: 0 });
    await updateExercise(exerciseId, { guestJoin: true });
    await runControl({ exerciseId, actor: {}, req: new Request("http://x") }, { action: "open_lobby" });
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    const join = (ip: string, displayName: string) =>
      joinByCode(new Request("http://localhost/api/join", { headers: { "x-forwarded-for": ip } }), { code: ex.joinCode!, displayName, teamId: teams[0]!.id }, null);

    for (let i = 0; i < 10; i++) await join("192.0.2.50", `Guest ${i}`);
    await expect(join("192.0.2.50", "Guest 10")).rejects.toMatchObject({ status: 429 });

    vi.stubEnv("GUEST_CAP_PER_EXERCISE", "11");
    try {
      await join("192.0.2.51", "Guest 11");
      await expect(join("192.0.2.52", "Guest 12")).rejects.toMatchObject({ status: 409 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // CE rate limits run on Redis; without REDIS_URL they fail open.
  it.skipIf(!process.env.REDIS_URL)("respond is limited to 30 per participant per minute", async () => {
    const { exerciseId, players } = await setup({ policy: "facilitator", perTeam: 1 });
    await startExercise(exerciseId, {});
    const inj = (await openInject(exerciseId))!;
    vi.mocked(resolvePrincipal).mockResolvedValue({ kind: "guest", exerciseId, participantId: players[0]!.id });
    const post = (optionId: string) =>
      respondRoute(
        new Request(`http://localhost/api/play/${exerciseId}/respond`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ injectId: inj.id, kind: "vote", data: { optionId } }),
        }),
        { params: Promise.resolve({ id: exerciseId }) },
      );
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post(i % 2 ? "a" : "b")).status);
    expect(statuses.slice(0, 30).every((s) => s === 201)).toBe(true);
    expect(statuses[30]).toBe(429);
    // Another participant has their own budget.
    vi.mocked(resolvePrincipal).mockResolvedValue({ kind: "guest", exerciseId, participantId: players[1]!.id });
    expect((await post("a")).status).toBe(201);
  });
});
