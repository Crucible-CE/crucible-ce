// After-action report end to end against Postgres (TEST_DATABASE_URL), no AI:
// Crisis Sim to ENDEX -> the end hook drafts v1 from the record -> evaluators
// write the narrative and cite evidence -> refresh keeps their edits ->
// attendance and ratings flow into the draft. Players cannot read the report.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, setTestSettings, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { advanceExercise, closeInject, endExercise, startExercise, submitResponse } from "@/lib/exercise/runtime/engine";
import { toParticipantRow } from "@/lib/exercise/runtime/snapshot";
import { createExercise } from "@/lib/exercise/create";
import { setAttendance } from "@/lib/exercise/participants";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { createCrisisTemplateFixture } from "@/lib/exercise/test-fixture";
import { GET as aarGet } from "@/app/api/exercises/[id]/aar/route";
import { createAar, editSection, getAarView, refreshFromRecord } from "./service";
import { syncRosterIntoAar } from "./roster-sync";
import { syncRatingsIntoAar } from "./ratings-sync";
import { evidenceFromOption } from "./evidence";
import { readEditLog, readSections, sectionOrigins } from "./edit";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

async function makeUser(role: "facilitator" | "member", name: string): Promise<SessionUser> {
  return createTestUser({ email: `${Math.random().toString(36).slice(2)}@example.test`, name, role });
}

describe.skipIf(!hasTestDb)("after-action report (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent", "RateLimitBucket", "StoredFile", "ActionItem");
    await setTestSettings({ policy: { requiredRoles: ["General Counsel"] }, enabledFrameworks: ["nist-csf"] });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await setTestSettings({ policy: {}, enabledFrameworks: [] });
    await new Promise((r) => setTimeout(r, 200));
    await db.$disconnect();
  });

  it("drafts v1 at ENDEX from the record and lets evaluators write the narrative", async () => {
    const fac = await makeUser("facilitator", "Fran Facilitator");
    const templateId = await createCrisisTemplateFixture(db, { createdById: fac.id });
    const { id } = await createExercise({ mode: "crisissim", title: "AAR test", templateId, advancePolicy: "facilitator", config: { holdAfterClose: false } }, fac);
    const teams = await db.team.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" } });
    const dana = await db.participant.create({ data: { exerciseId: id, displayName: "Dana Lee", title: "General Counsel", isGuest: true, roles: ["player"], teamId: teams[0].id } });
    const sam = await db.participant.create({ data: { exerciseId: id, displayName: "Sam Ortiz", title: "CISO", isGuest: true, roles: ["player"], teamId: teams[1].id } });
    const member = await makeUser("member", "Pat Player");
    await db.participant.create({ data: { exerciseId: id, userId: member.id, displayName: "Pat Player", roles: ["player"], teamId: teams[0].id } });

    // Unfinished exercises are refused.
    await expect(createAar(id)).rejects.toMatchObject({ status: 409 });

    // Run to ENDEX.
    await startExercise(id, {});
    const first = (await db.inject.findFirst({ where: { exerciseId: id, status: "open" } }))!;
    for (const p of [dana, sam]) await submitResponse({ exerciseId: id, injectId: first.id, participant: toParticipantRow(p), kind: "vote", raw: { optionId: "a" } });
    await closeInject(id, first.id, "facilitator", {}, { autoAdvance: false });
    await advanceExercise(id, {});
    const second = (await db.inject.findFirst({ where: { exerciseId: id, status: "open" } }))!;
    await submitResponse({ exerciseId: id, injectId: second.id, participant: toParticipantRow(dana), kind: "vote", raw: { optionId: "b", comment: "Dana Lee says hold the statement." } });
    const objectives = await db.objective.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" } });
    const obs = await db.observation.create({ data: { exerciseId: id, objectiveId: objectives[1].id, injectId: second.id, kind: "afi", text: "The team did not know who calls the insurer." } });
    expect(await endExercise(id, "facilitator", {})).toBe(true);

    // The end hook drafted v1 in this process, with no AI and no job.
    const v1 = await db.afterActionReport.findFirstOrThrow({ where: { exerciseId: id } });
    expect(v1).toMatchObject({ version: 1, status: "draft" });
    expect(await db.job.count()).toBe(0);
    await expect(createAar(id)).rejects.toMatchObject({ status: 409 });
    let sections = readSections(v1.sections)!;
    expect(sections.executiveSummary).toBe("");
    // Strengths start empty. Findings from the record start as proposed.
    expect(sections.analysis.every((a) => a.strengths.length === 0 && a.afis.every((f) => f.status === "proposed"))).toBe(true);
    expect(sections.overview).toMatchObject({ name: "AAR test" });
    expect(sections.decisionLog.length).toBeGreaterThanOrEqual(2);
    expect(sections.methodology.text).toContain("Evaluators and facilitators wrote");
    expect(sections.roster.map((r) => r.name)).toEqual(expect.arrayContaining(["Dana Lee", "Sam Ortiz"]));
    expect(sections.requiredRoles).toEqual([{ role: "General Counsel", present: false }]);
    expect(Object.values(sectionOrigins(readEditLog(v1.editLog))).every((o) => o === null || o === "system")).toBe(true);

    // Evidence options come from the record and point at their rows.
    const view = await getAarView(id);
    const option = view.evidence.find((e) => e.sourceId === obs.id)!;
    expect(option).toMatchObject({ kind: "observation", quote: "The team did not know who calls the insurer." });
    expect(view.evidence.some((e) => e.kind === "vote" && e.quote.includes("hold the statement"))).toBe(true);

    // An evaluator writes the summary and an AFI with a control reference and evidence.
    // It goes after the findings proposed from the record.
    const n1 = sections.analysis[1].afis.length;
    await editSection(id, { section: "executiveSummary", value: "The team contained the incident. Notification was late." }, fac.id);
    await editSection(
      id,
      {
        section: "analysis",
        path: `1.afis.${n1}`,
        value: {
          id: "afi_manual",
          title: "No owner for the insurer notice",
          observation: "Nobody knew who calls the insurer.",
          analysis: "The plan does not name an owner.",
          recommendation: "Name an owner in the plan.",
          capabilityKey: null,
          references: [{ type: "control", ref: "nist-csf:RS.MA-01" }],
          evidence: [evidenceFromOption(option)],
          actionItemId: null,
          rejectedReason: null,
        },
      },
      fac.id,
    );
    let aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: v1.id } });
    sections = readSections(aar.sections)!;
    expect(sections.analysis[1].afis[n1]).toMatchObject({ status: "proposed", sources: [{ kind: "written", sourceId: null }] });
    expect(sections.analysis[1].afis[n1].evidence[0]).toMatchObject({ kind: "observation", sourceId: obs.id });
    // The control mapping follows the findings.
    expect(sections.controlMapping.find((c) => c.controlId === "RS.MA-01")).toMatchObject({ status: "gap", afiIds: ["afi_manual"] });

    // A person edits the parking lot; a refresh keeps that edit and the narrative.
    await editSection(id, { section: "parkingLot", value: ["Written by hand."] }, fac.id);
    await db.hotwashItem.create({ data: { exerciseId: id, kind: "parking_lot", text: "Insurer limits." } });
    const r = await refreshFromRecord(id, {}, fac.id);
    expect(r.changed).not.toContain("parkingLot");
    aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: v1.id } });
    sections = readSections(aar.sections)!;
    expect(sections.parkingLot).toEqual(["Written by hand."]);
    expect(sections.executiveSummary).toBe("The team contained the incident. Notification was late.");
    expect(sections.analysis[1].afis).toHaveLength(n1 + 1);
    // Forced refresh replaces the edited record section.
    await refreshFromRecord(id, { sections: ["parkingLot"], force: true }, fac.id);
    aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: v1.id } });
    expect(readSections(aar.sections)!.parkingLot).toEqual(["Insurer limits."]);

    // Attendance flows into the roster and required roles.
    await setAttendance(id, dana.id, "attended");
    expect(await syncRosterIntoAar(id)).toBe(true);
    aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: v1.id } });
    sections = readSections(aar.sections)!;
    expect(sections.roster.find((p) => p.name === "Dana Lee")?.attendance).toBe("attended");
    expect(sections.requiredRoles).toEqual([{ role: "General Counsel", present: true }]);

    // Evaluator ratings flow into the draft.
    await db.capabilityRating.create({ data: { exerciseId: id, objectiveId: objectives[0].id, rating: "S", source: "evaluator", rationale: "Isolation was quick.", byUserId: fac.id } });
    expect(await syncRatingsIntoAar(id)).toBe(true);
    aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: v1.id } });
    expect(readSections(aar.sections)!.analysis[0]).toMatchObject({ rating: "S", ratingSource: "evaluator" });

    // Players never read the report; the control team does.
    vi.mocked(getSessionUser).mockResolvedValue(member);
    const denied = await aarGet(new Request(`http://localhost/api/exercises/${id}/aar`), { params: Promise.resolve({ id }) });
    expect(denied.status).toBe(403);
    vi.mocked(getSessionUser).mockResolvedValue(fac);
    const ok = await aarGet(new Request(`http://localhost/api/exercises/${id}/aar`), { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { aar: { version: number }; evidence: unknown[] };
    expect(body.aar.version).toBe(1);
    expect(body.evidence.length).toBeGreaterThan(0);
    vi.mocked(getSessionUser).mockResolvedValue(null);
  });

  it("does not draft a report for a practice run", async () => {
    const fac = await makeUser("facilitator", "Fran Facilitator");
    const templateId = await createCrisisTemplateFixture(db, { createdById: fac.id });
    const { id } = await createExercise({ mode: "crisissim", title: "Practice", templateId, isPractice: true, advancePolicy: "facilitator" }, fac);
    await startExercise(id, {});
    expect(await endExercise(id, "facilitator", {})).toBe(true);
    expect(await db.afterActionReport.count({ where: { exerciseId: id } })).toBe(0);
  });
});
