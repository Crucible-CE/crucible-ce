// @vitest-environment node
// Strategic TTX against Postgres (ce_test): a scripted template runs, every
// active team answers, all_teams closes the inject, evaluators rate the
// answers by hand, and the dynamic win rule ends the run. Contingency injects
// publish with a CAS and refuse while an inject is open.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { advanceExercise, closeInject, startExercise, submitResponse } from "@/lib/exercise/runtime/engine";
import { toParticipantRow } from "@/lib/exercise/runtime/snapshot";
import { projectFor } from "@/lib/exercise/runtime/view";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { ServiceError } from "@/lib/exercise/errors";
import { publishContingency, CONTINGENCY_BUSY } from "./contingency";
import { addHumanGrade } from "./grades";
import { checkWinCondition } from "./win";
import { seedStrategicTemplates } from "./seed";
import { createExercise } from "@/lib/exercise/create";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const TEAMS = ["Executive", "Legal"];

const ANSWERS: Record<string, string> = {
  Executive: "We name the CISO as incident commander and set a briefing time of 07:00 for the crisis team.",
  Legal: "We record the discovery time as 06:10 today and engage outside counsel to direct the forensic work.",
};

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** A published, scripted Strategic TTX template: two teams, three linear updates. */
async function scriptedTemplate(createdById: string): Promise<string> {
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "strategic",
      title: "Identity takeover",
      status: "published",
      config: json({ schemaVersion: 1, source: "template", teams: TEAMS, targetDurationMin: 90, regulatoryClocks: [], executiveBriefMd: "" }),
      objectives: json([]),
      branching: "linear",
      createdById,
    },
    select: { id: true },
  });
  for (let n = 1; n <= 3; n++) {
    await db.templateInject.create({
      data: {
        templateId: t.id,
        nodeId: `n${n}`,
        seq: n,
        title: `Update number ${n}`,
        scenarioOffsetMin: n * 30,
        content: json({
          schemaVersion: 1,
          narrativeMd: `At 06:${10 + n} the help desk reports that administrators are locked out of the identity provider. Round ${n}.`,
          phase: n === 1 ? "opening" : "main",
          artifacts: [],
          teamVariants: [
            { team: "Executive", status: "active", narrativeMd: "The CEO asks who leads.", questions: [{ key: "q1", text: "Who leads the response?" }] },
            { team: "Legal", status: "active", narrativeMd: "Counsel asks about notice.", questions: [{ key: "q1", text: "When is this discovered for notice?" }] },
          ],
        }),
        secret: json({
          schemaVersion: 1,
          expectedActions: { Executive: ["Names an incident commander", "Sets a briefing time"], Legal: ["Records the discovery time", "Engages outside counsel"] },
        }),
        position: json({ x: 0, y: n * 160 }),
      },
    });
  }
  return t.id;
}

async function makeUser(): Promise<SessionUser> {
  return createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name: "Fran Facilitator", role: "facilitator" });
}

async function setup(opts: { policy: "all_teams" | "facilitator"; win?: boolean }) {
  const user = await makeUser();
  const templateId = await scriptedTemplate(user.id);
  const { id } = await createExercise(
    { mode: "strategic", title: "Strategic test", templateId, advancePolicy: opts.policy, config: { winCondition: opts.win ? "dynamic" : "none", holdAfterClose: false } },
    user,
  );
  const teams = await db.team.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" } });
  const players = [];
  for (const team of teams) {
    players.push(
      toParticipantRow(
        await db.participant.create({ data: { exerciseId: id, displayName: `${team.name} lead`, isGuest: true, roles: ["player"], teamId: team.id, isDecisionMaker: true } }),
      ),
    );
  }
  return { user, exerciseId: id, teams, players };
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

const openInject = (exerciseId: string, exceptId?: string) =>
  db.inject.findFirst({ where: { exerciseId, status: "open", ...(exceptId ? { id: { not: exceptId } } : {}) }, orderBy: { seq: "desc" } });

async function expect409(p: Promise<unknown>, message = CONTINGENCY_BUSY) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).status).toBe(409);
  expect((err as ServiceError).message).toBe(message);
}

const contingencyBody = (teamId: string) => ({ title: "Regulator calls", narrativeMd: "The state regulator calls the general counsel.", targetTeamIds: [teamId], questions: ["What do you tell the regulator?"], artifacts: [] });

describe.skipIf(!hasTestDb)("strategic TTX (integration)", () => {
  beforeAll(async () => {
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent");
    await seedCapabilities();
  });
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await db.$disconnect();
  });

  it("runs the scripted updates, closes on all teams, takes evaluator ratings and ends on the win rule", async () => {
    const { exerciseId, players, teams, user } = await setup({ policy: "all_teams", win: true });
    await startExercise(exerciseId, {});
    let previous: string | undefined;

    for (let round = 1; round <= 2; round++) {
      const open = await waitFor(() => openInject(exerciseId, previous));
      previous = open.id;
      expect(open.source).toBe("template");
      expect(open.title).toBe(`Update number ${round}`);
      if (round === 1) await expect409(publishContingency(exerciseId, contingencyBody(teams[1]!.id), {}));

      // A player sees only their own variant and no expected actions.
      const execView = JSON.stringify(await projectFor(exerciseId, { kind: "guest", exerciseId, participantId: players[0]!.id }));
      expect(execView).toContain("The CEO asks who leads.");
      expect(execView).not.toContain("Counsel asks about notice.");
      expect(execView).not.toContain("Names an incident commander");

      for (const [i, p] of players.entries()) {
        await submitResponse({ exerciseId, injectId: open.id, participant: p, kind: "answer", raw: { text: ANSWERS[TEAMS[i]!] } });
      }
      const closed = await db.inject.findUniqueOrThrow({ where: { id: open.id } });
      expect(closed.status).toBe("closed");
      expect(closed.closeTrigger).toBe("all_teams");
      // CE queues no grading jobs: evaluators rate by hand.
      expect(await db.job.count()).toBe(0);

      const responses = await db.response.findMany({ where: { injectId: open.id } });
      expect(responses).toHaveLength(2);
      if (round === 1) {
        // Not rated yet: the run goes on.
        expect(await checkWinCondition(exerciseId)).toBe(false);
      }
      for (const r of responses) {
        const g = await addHumanGrade(exerciseId, { responseId: r.id, score: 3.5, rating: "effective", rationale: "Owner and time named." }, user.id);
        expect(g.attempt).toBe(1);
      }
      const control = (await projectFor(exerciseId, { kind: "user", userId: user.id, accountRole: "facilitator" })) as {
        injects: Array<{ id: string; control?: { answers: Array<{ responseId: string; effective: { source: string; rating: string } | null }> } }>;
      };
      const answers = control.injects.find((i) => i.id === open.id)!.control!.answers;
      expect(answers.map((a) => a.effective)).toEqual([
        expect.objectContaining({ source: "human", rating: "effective" }),
        expect.objectContaining({ source: "human", rating: "effective" }),
      ]);
      // Players never see ratings.
      const playerView = JSON.stringify(await projectFor(exerciseId, { kind: "guest", exerciseId, participantId: players[0]!.id }));
      expect(playerView).not.toContain("Owner and time named.");
      const ended = await checkWinCondition(exerciseId);
      expect(ended).toBe(round === 2);
    }

    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
    expect(ex.status).toBe("ended");
    expect(ex.endReason).toBe("win_condition");
  });

  it("publishes a contingency inject with a CAS and keeps it out of the main sequence", async () => {
    const { exerciseId, teams, players } = await setup({ policy: "facilitator" });
    await startExercise(exerciseId, {});
    const first = await waitFor(() => openInject(exerciseId));
    await closeInject(exerciseId, first.id, "facilitator", {}, { autoAdvance: false });

    // Two at once: one wins, the other gets 409.
    const results = await Promise.allSettled([
      publishContingency(exerciseId, contingencyBody(teams[1]!.id), {}),
      publishContingency(exerciseId, { ...contingencyBody(teams[1]!.id), title: "Second" }, {}),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as ServiceError).status).toBe(409);

    const injectId = (ok[0] as PromiseFulfilledResult<{ injectId: string }>).value.injectId;
    const row = await db.inject.findUniqueOrThrow({ where: { id: injectId } });
    expect(row).toMatchObject({ status: "open", source: "contingency", targetTeamIds: [teams[1]!.id] });
    expect((await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } })).currentInjectId).toBe(injectId);
    expect(await db.inject.count({ where: { exerciseId, status: "pending" } })).toBe(0);

    // Only the targeted team sees it.
    const execView = JSON.stringify(await projectFor(exerciseId, { kind: "guest", exerciseId, participantId: players[0]!.id }));
    const legalView = JSON.stringify(await projectFor(exerciseId, { kind: "guest", exerciseId, participantId: players[1]!.id }));
    expect(execView).not.toContain("The state regulator calls");
    expect(legalView).toContain("The state regulator calls");

    // While it is open, advance is busy and another contingency is refused.
    expect(await advanceExercise(exerciseId, {})).toEqual({ ok: false, reason: "busy" });
    await expect409(publishContingency(exerciseId, contingencyBody(teams[0]!.id), {}));

    // After it closes, the next scripted update follows: contingencies do not count.
    await closeInject(exerciseId, injectId, "facilitator", {}, { autoAdvance: false });
    const res = await advanceExercise(exerciseId, {});
    expect(res.ok).toBe(true);
    const next = await waitFor(() => openInject(exerciseId));
    expect(next.title).toBe("Update number 2");
  });

  it("runs a seeded template: teams, objectives and clocks from the template, scripted variants open first", async () => {
    await seedStrategicTemplates(db as never);
    const user = await makeUser();
    const { id } = await createExercise({ mode: "strategic", title: "Fintech", templateId: "lib-strategic-fintech-breach", advancePolicy: "facilitator" }, user);
    const ex = await db.exercise.findUniqueOrThrow({ where: { id }, include: { teams: true, objectives: true, clocks: true } });
    expect(ex.teams.map((t) => t.name).sort()).toEqual(["Communications", "Executive", "IT and Security", "Legal", "Operations"]);
    expect(ex.objectives.length).toBe(5);
    expect(ex.objectives.every((o) => o.capabilityIds.length > 0)).toBe(true);
    expect(ex.clocks.map((c) => c.key).sort()).toEqual(["gdpr_72h", "insurer_notice", "nydfs_72h", "state_ag"]);
    expect(ex.scenarioStartAt).not.toBeNull();
    await startExercise(id, {});
    const first = await db.inject.findFirstOrThrow({ where: { exerciseId: id, status: "open" } });
    expect(first.title).toBe("Unusual export from the data warehouse");
    expect(first.source).toBe("template");
    const content = first.content as { teamVariants: Array<{ team: string; teamId: string | null }> };
    expect(content.teamVariants.every((v) => v.teamId)).toBe(true);
    await closeInject(id, first.id, "facilitator", {}, { autoAdvance: false });
    const insurer = await db.regulatoryClock.findFirstOrThrow({ where: { exerciseId: id, key: "insurer_notice" } });
    expect(insurer.status).toBe("running");
  });
});
