// The onboarding practice Crisis Sim against Postgres (TEST_DATABASE_URL): one
// open solo practice run per member, reused until it ends; ENDEX completes the
// step; practice runs never get an after-action report.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, hasTestDb, truncate } from "@/test/exercise-db";
import { seedCrisisSimTemplates } from "@/lib/exercise/templates/crisissim-seed";
import { PRACTICE_TEMPLATE_ID } from "@/lib/exercise/templates/crisissim-seed-data";
import { endExercise, startExercise } from "@/lib/exercise/runtime/engine";
import { reportBlockedReason } from "@/lib/exercise/aar/service";
import { launchPracticeSim } from "./practice-sim";
import { loadPracticeFacts } from "./practice-facts";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

describe.skipIf(!hasTestDb)("onboarding practice sim (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "ExerciseTemplate", "User", "AuditEvent");
    await seedCrisisSimTemplates(db);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("launches one solo practice run, reuses it, and completes the step at ENDEX", async () => {
    const user = await createTestUser({ email: "solo@example.test", name: "Sam Solo", role: "facilitator" });
    const facts = () => loadPracticeFacts({ id: user.id, organizationId: user.organizationId, role: "contributor" });

    const first = await launchPracticeSim(user);
    expect(first.created).toBe(true);
    expect(await launchPracticeSim(user)).toEqual({ id: first.id, created: false });

    const ex = await db.exercise.findUniqueOrThrow({ where: { id: first.id }, select: { isPractice: true, templateId: true, mode: true } });
    expect(ex).toEqual({ isPractice: true, templateId: PRACTICE_TEMPLATE_ID, mode: "crisissim" });
    const seats = await db.participant.findMany({ where: { exerciseId: first.id }, select: { userId: true, roles: true, teamId: true, isDecisionMaker: true } });
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ userId: user.id, isDecisionMaker: true });
    expect(seats[0].roles).toEqual(expect.arrayContaining(["lead_facilitator", "player"]));
    expect(seats[0].teamId).not.toBeNull();

    expect(await facts()).toMatchObject({ practiceSimOpenId: first.id, practiceSimEnded: false });

    const actor = { userId: user.id, participantId: null };
    await startExercise(first.id, actor);
    await endExercise(first.id, "facilitator", actor);
    expect(await facts()).toMatchObject({ practiceSimOpenId: null, practiceSimEnded: true });
    expect(reportBlockedReason({ status: "ended", isPractice: true })).not.toBeNull();

    // After ENDEX a new launch is a new run.
    const again = await launchPracticeSim(user);
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
  });

  it("only members who can create exercises see the sim and schedule steps", async () => {
    const reader = await createTestUser({ email: "reader@example.test", name: "Rae Reader", role: "member" });
    expect(await loadPracticeFacts({ id: reader.id, organizationId: reader.organizationId, role: "reader" })).toMatchObject({ canExercises: false, canDocuments: false });
  });
});
