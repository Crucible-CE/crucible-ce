// @vitest-environment node
// Playbook Exercise end to end against Postgres (ce_test), by hand:
// document -> draft template from its sections -> modules, questions,
// expected actions and rubric written in the editor -> publish -> exercise ->
// start -> entries -> close -> evaluator grade against the rubric.
// Players never see rubric criteria, model answers, expected actions or
// grades.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { advanceExercise, closeInject, endExercise, startExercise, submitResponse } from "@/lib/exercise/runtime/engine";
import { toParticipantRow } from "@/lib/exercise/runtime/snapshot";
import { projectFor } from "@/lib/exercise/runtime/view";
import { createExercise } from "@/lib/exercise/create";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { createDocument, readSections } from "./documents";
import { createDocumentTemplate, starterSections } from "@/lib/exercise/templates/document";
import { loadDocumentTemplate, publishDocumentTemplate, saveDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { addHumanGrade, gradeDetails, setEntryStatus } from "@/lib/exercise/grading/human";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const PLAYBOOK = readFileSync(path.join(process.cwd(), "src/lib/exercise/documents/fixtures/ransomware-playbook.md"), "utf8");
const EXCERPT = "The IC declares a Severity 1 incident when encryption is confirmed on more than one host or on any server.";
const SECRET_EXPECTED = "Page the CISO within 30 minutes of declaration";
const SECRET_CRITERION = "Names the incident commander as the person who declares";
const SECRET_MODEL = "MODEL-ANSWER-the IC declares and opens the bridge";

async function makeUser(): Promise<SessionUser> {
  return createTestUser({ email: `f${Math.random().toString(36).slice(2)}@example.test`, name: "Fran", role: "facilitator" });
}

describe.skipIf(!hasTestDb)("Playbook Exercise by hand (integration)", () => {
  beforeAll(async () => {
    await truncate("Exercise", "ExerciseTemplate", "SourceDocument", "StoredFile", "User", "Job", "AuditEvent");
    await seedCapabilities();
  });
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await truncate("Exercise", "ExerciseTemplate", "SourceDocument", "StoredFile", "User", "Job", "AuditEvent");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 200));
    await db.$disconnect();
  });

  it("starts one module per section, saves half-written work, and publishes only when complete", async () => {
    const user = await makeUser();
    const doc = await createDocument({ title: "Ransomware Response Playbook", kind: "playbook", text: PLAYBOOK }, user.id);
    const sections = readSections((await db.sourceDocument.findUniqueOrThrow({ where: { id: doc.id } })).sections);
    const starters = starterSections(sections);
    expect(starters.length).toBeGreaterThan(1);

    const templateId = await createDocumentTemplate(
      doc.id,
      { title: "Depot ransomware", objectives: [{ text: "Validate the declaration path.", capabilityKeys: ["RS.MA"] }], teams: [], moduleMinutes: null, paced: "facilitator", start: "sections" },
      user.id,
    );
    const loaded = await loadDocumentTemplate(templateId);
    expect(loaded.template.status).toBe("draft");
    expect(loaded.modules.map((m) => m.title)).toEqual(starters.map((s) => s.heading.trim()));
    expect(loaded.modules[0].content.docSectionRefs).toEqual([starters[0].id]);
    expect(loaded.document?.text).toContain("Declaring an Incident");
    // Empty scenario updates and questions are listed, not refused.
    expect(loaded.issues.some((i) => /scenario update/.test(i.message))).toBe(true);
    await expect(publishDocumentTemplate(templateId)).rejects.toMatchObject({ status: 409 });

    // Nothing runs in the background.
    expect(await db.job.count()).toBe(0);

    const blank = await createDocumentTemplate(doc.id, { title: "Blank start", objectives: [], teams: [], moduleMinutes: null, paced: "facilitator", start: "blank" }, user.id);
    expect((await loadDocumentTemplate(blank)).modules).toEqual([]);
  });

  it("runs a hand-written template, takes evaluator grades and keeps secrets from players", async () => {
    const user = await makeUser();
    const doc = await createDocument({ title: "Ransomware Response Playbook", kind: "playbook", text: PLAYBOOK }, user.id);
    const sections = readSections((await db.sourceDocument.findUniqueOrThrow({ where: { id: doc.id } })).sections);
    const declare = sections.find((s) => /Declaring an Incident/.test(s.heading))!.id;
    const templateId = await createDocumentTemplate(
      doc.id,
      { title: "Depot ransomware", objectives: [{ text: "Validate the declaration path.", capabilityKeys: ["RS.MA"] }], teams: [], moduleMinutes: null, paced: "facilitator", start: "blank" },
      user.id,
    );

    // Write two modules and their rubrics, as the editor sends them.
    const moduleDraft = (n: number) => ({
      title: `Stage ${n}`,
      scenarioOffsetMin: (n - 1) * 60,
      plannedDelayMin: null,
      content: {
        schemaVersion: 1 as const,
        scenarioUpdate: `Stage ${n}. File servers at the depot show encrypted files.`,
        rationale: "Tests the declaration path.",
        keyIssues: ["Who declares"],
        sourceExcerpt: EXCERPT,
        docSectionRefs: [declare],
        questions: [
          { key: `m${n}q1`, text: "Who declares the incident and when?", category: "detection" as const, capabilityKeys: ["RS.MA"], objectiveKeys: ["o1"], docSectionRefs: [declare] },
          { key: `m${n}q2`, text: "Who is told first and how?", category: "communication" as const, capabilityKeys: [], objectiveKeys: [], docSectionRefs: [] },
        ],
      },
      secret: { schemaVersion: 1 as const, expectedActions: [SECRET_EXPECTED] },
    });
    const rubric = (key: string) => ({
      questionKey: key,
      capabilityKey: "RS.MA",
      modelAnswer: SECRET_MODEL,
      criteria: [
        { id: "c1", text: SECRET_CRITERION, controlRefs: [{ framework: "nist-csf", controlId: "DE.AE-08" }] },
        { id: "c2", text: "States the 15 minute validation window.", controlRefs: [] },
      ],
    });
    const saved = await saveDocumentTemplate(templateId, { modules: [moduleDraft(1), moduleDraft(2)], rubrics: ["m1q1", "m1q2", "m2q1", "m2q2"].map(rubric) });
    expect(saved.issues).toEqual([]);

    // A source excerpt that is not in the document is caught before publishing.
    const wrong = moduleDraft(1);
    wrong.content.sourceExcerpt = "This sentence is not in the playbook at all, word for word or otherwise.";
    const flagged = await saveDocumentTemplate(templateId, { modules: [wrong, moduleDraft(2)] });
    expect(flagged.issues.map((i) => i.message)).toContain("The source excerpt in module 1 is not in the document. Copy it word for word or clear it.");
    await saveDocumentTemplate(templateId, { modules: [moduleDraft(1), moduleDraft(2)] });
    await publishDocumentTemplate(templateId);

    const { id: exerciseId } = await createExercise({ mode: "document", title: "Depot ransomware run", templateId, sourceDocumentId: doc.id }, user);
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId }, include: { objectives: true } });
    expect(ex.objectives).toHaveLength(1);
    const player = toParticipantRow(await db.participant.create({ data: { exerciseId, displayName: "Pat Player", isGuest: true, roles: ["player"] } }));
    const guest = { kind: "guest" as const, exerciseId, participantId: player.id };
    const fac = { kind: "user" as const, userId: user.id, accountRole: "facilitator" };

    await startExercise(exerciseId, {});
    const m1 = await db.inject.findFirstOrThrow({ where: { exerciseId, status: "open" } });
    expect(m1.title).toBe("Stage 1");

    const good = await submitResponse({ exerciseId, injectId: m1.id, participant: player, kind: "entry", raw: { type: "discussion", text: "I think the incident commander declares once the SOC confirms it.", questionKey: "m1q1" } });
    const gap = await submitResponse({ exerciseId, injectId: m1.id, participant: player, kind: "entry", raw: { type: "gap", text: "Nobody owns the VPN shutdown.", severity: "high", docSectionRef: declare } });
    await expect(
      submitResponse({ exerciseId, injectId: m1.id, participant: player, kind: "entry", raw: { type: "discussion", text: "x", questionKey: "m2q1" } }),
    ).rejects.toThrow(/not in this module/);

    // Player view while open: no expected actions, excerpt or rationale.
    let playerText = JSON.stringify(await projectFor(exerciseId, guest));
    expect(playerText).toContain("Nobody owns the VPN shutdown.");
    expect(playerText).not.toContain(SECRET_EXPECTED);
    expect(playerText).not.toContain("Tests the declaration path.");
    const control = (await projectFor(exerciseId, fac)) as { injects: Array<{ control?: { expectedActions: string[] } }> };
    expect(control.injects[0].control?.expectedActions).toEqual([SECRET_EXPECTED]);

    // Moderate and close. Nothing is queued: evaluators grade.
    await setEntryStatus(exerciseId, gap.responseId, "confirmed");
    const closed = await closeInject(exerciseId, m1.id, "facilitator", {});
    expect(closed.closed).toBe(true);
    expect(await db.job.count()).toBe(0);

    // The evaluator reads the rubric and grades. A later grade replaces the earlier one.
    const details = await gradeDetails(exerciseId);
    expect(details.criteria.m1q1.map((c) => c.text)).toEqual([SECRET_CRITERION, "States the 15 minute validation window."]);
    await addHumanGrade(exerciseId, { responseId: good.responseId, score: 2, rating: "partially_met", rationale: "EVAL-NOTE names the owner, misses the window." }, user.id);
    await addHumanGrade(exerciseId, { responseId: good.responseId, score: 3, rating: "met", rationale: "EVAL-NOTE the SOC confirms first, so this is right." }, user.id);
    const grades = await db.grade.findMany({ where: { responseId: good.responseId }, orderBy: { attempt: "asc" } });
    expect(grades.map((g) => [g.source, g.attempt])).toEqual([
      ["human", 1],
      ["human", 2],
    ]);
    const ctl = (await projectFor(exerciseId, fac)) as { injects: Array<{ entries: Array<{ id: string; grade?: { source: string; score: number } }> }> };
    expect(ctl.injects[0].entries.find((x) => x.id === good.responseId)!.grade).toMatchObject({ source: "human", score: 3 });
    await expect(addHumanGrade(exerciseId, { responseId: "missing", score: 1, rating: "not_met", rationale: "x" }, user.id)).rejects.toMatchObject({ status: 404 });

    // Next module, then ENDEX.
    const adv = await advanceExercise(exerciseId, {});
    expect(adv.ok).toBe(true);
    await endExercise(exerciseId, "facilitator", {});

    playerText = JSON.stringify(await projectFor(exerciseId, guest));
    for (const secret of [SECRET_EXPECTED, SECRET_CRITERION, SECRET_MODEL, "EVAL-NOTE", "partially_met", '"grade"']) {
      expect(playerText).not.toContain(secret);
    }
    const debrief = (JSON.parse(playerText) as { debrief: { modules: Array<{ answered: string[]; gaps: unknown[] }> } }).debrief;
    expect(debrief.modules[0].answered).toEqual(["m1q1"]);
    expect(debrief.modules[0].gaps).toHaveLength(1);
  });

  it("blocks deleting a document an active exercise uses", async () => {
    const { deleteDocument } = await import("./documents");
    const user = await makeUser();
    const doc = await createDocument({ title: "Plan", kind: "bcp_dr", text: PLAYBOOK }, user.id);
    await createExercise({ mode: "document", title: "Uses the doc", sourceDocumentId: doc.id }, user);
    await expect(deleteDocument(doc.id)).rejects.toThrow(/has not ended/);
  });
});
