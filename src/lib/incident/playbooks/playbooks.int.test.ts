// Incident playbook runs against Postgres (TEST_DATABASE_URL): suggestions
// from Documents, attach as a checklist, check off with who and when, edit the
// checklist without touching the document, step to task, export, and scoping.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { hasTestDb, truncate } from "@/test/exercise-db";
import { createIncident, createMember, jsonRequest, memberSession, params, type TestMember } from "@/test/incident-db";
import { GET as listPlaybooks, POST as attach } from "@/app/api/incidents/[id]/playbooks/route";
import { POST as addStepRoute } from "@/app/api/incidents/[id]/playbooks/[runId]/steps/route";
import { PATCH as patchStep } from "@/app/api/incidents/[id]/playbooks/[runId]/steps/[stepId]/route";
import { POST as toTask } from "@/app/api/incidents/[id]/playbooks/[runId]/steps/[stepId]/task/route";
import { gatherIncident } from "@/lib/export/gather";
import { libraryPlaybookText } from "@/lib/exercise/library/documents";
import { sha256Hex } from "@/lib/exercise/documents/documents";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// The tests make their own playbook documents; keep the shipped library out.
vi.mock("@/lib/exercise/library", () => ({ ensureExerciseLibrary: async () => true }));

function as(m: TestMember) {
  vi.mocked(auth).mockResolvedValue(memberSession(m) as never);
}

const RANSOMWARE = libraryPlaybookText({ file: "healthcare/playbooks/qilin-ransomware-phi-warehouse.md", libraryKey: "test" });
const OTHER = "# Wire fraud response\n\n## 1. Contain\n\n1. Call the bank fraud line\n2. Freeze the outgoing wire\n\n## 2. Notes\n\nNothing here.\n";

async function doc(m: TestMember, title: string, text: string, scope = "local") {
  return db.sourceDocument.create({ data: { organizationId: m.organizationId, kind: "playbook", title, text, sha256: sha256Hex(text), scope }, select: { id: true } });
}

describe.skipIf(!hasTestDb)("incident playbooks (integration)", () => {
  beforeEach(async () => {
    await truncate("Incident", "IncidentPlaybookRun", "IncidentPlaybookStep", "IncidentTask", "IncidentLedgerEntry", "SourceDocument", "User", "AuditEvent");
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("suggests by category, attaches a checklist, checks off with who and when, and exports it", async () => {
    const c = await createMember("contributor", "Casey Contributor");
    const rw = await doc(c, "Ransomware on analytics systems and the PHI warehouse", RANSOMWARE, "library");
    await doc(c, "Wire fraud response", OTHER);
    const inc = await createIncident(c, { title: "Files encrypted on FS01", category: "ransomware" });

    as(c);
    const list = await (await listPlaybooks(jsonRequest("/x", "GET"), params({ id: inc.id }))).json();
    expect(list.suggestions[0].id).toBe(rw.id);
    expect(list.suggestions.some((s: { title: string }) => s.title === "Wire fraud response")).toBe(false);

    const res = await attach(jsonRequest("/x", "POST", { documentId: rw.id }), params({ id: inc.id }));
    expect(res.status).toBe(201);
    const { runId } = await res.json();
    expect((await attach(jsonRequest("/x", "POST", { documentId: rw.id }), params({ id: inc.id }))).status).toBe(409);

    const steps = await db.incidentPlaybookStep.findMany({ where: { runId }, orderBy: { position: "asc" } });
    expect(steps.length).toBeGreaterThan(20);
    expect(steps[0].section).toBe("5. Detect");
    expect(steps[0].text).toMatch(/^D1\. /);
    expect(steps.some((s) => s.kind === "decision")).toBe(true);

    const first = steps[0];
    expect((await patchStep(jsonRequest("/x", "PATCH", { done: true }), params({ id: inc.id, runId, stepId: first.id }))).status).toBe(200);
    const done = await db.incidentPlaybookStep.findUniqueOrThrow({ where: { id: first.id } });
    expect(done.doneByName).toBe("Casey Contributor");
    expect(done.doneAt).not.toBeNull();

    const after = await (await listPlaybooks(jsonRequest("/x", "GET"), params({ id: inc.id }))).json();
    expect(after.runs[0].doneCount).toBe(1);
    expect(after.runs[0].totalCount).toBe(steps.length);
    expect(after.suggestions.some((s: { id: string }) => s.id === rw.id)).toBe(false);

    const ledger = await db.incidentLedgerEntry.findMany({ where: { incidentId: inc.id }, select: { eventType: true } });
    expect(ledger.map((l) => l.eventType)).toEqual(expect.arrayContaining(["playbook_attached", "playbook_step_done"]));

    const gathered = await gatherIncident(inc.id, c.organizationId, "internal");
    expect(gathered!.playbooks).toHaveLength(1);
    expect(gathered!.playbooks[0].steps.find((s) => s.doneAt)?.doneBy).toBe("Casey Contributor");
  });

  it("editing the checklist and making a task never change the document", async () => {
    const c = await createMember("contributor");
    const d = await doc(c, "Wire fraud response", OTHER);
    const inc = await createIncident(c, { category: "phishing", title: "Wire fraud attempt" });
    as(c);
    const { runId } = await (await attach(jsonRequest("/x", "POST", { documentId: d.id }), params({ id: inc.id }))).json();
    const steps = await db.incidentPlaybookStep.findMany({ where: { runId }, orderBy: { position: "asc" } });
    expect(steps.map((s) => [s.section, s.text])).toEqual([
      ["1. Contain", "Call the bank fraud line"],
      ["1. Contain", "Freeze the outgoing wire"],
    ]);

    await patchStep(jsonRequest("/x", "PATCH", { text: "Call the bank fraud line at 24h number" }), params({ id: inc.id, runId, stepId: steps[0].id }));
    await addStepRoute(jsonRequest("/x", "POST", { section: "1. Contain", text: "Tell the CFO" }), params({ id: inc.id, runId }));
    await patchStep(jsonRequest("/x", "PATCH", { move: "down" }), params({ id: inc.id, runId, stepId: steps[0].id }));
    const edited = await db.incidentPlaybookStep.findMany({ where: { runId }, orderBy: { position: "asc" } });
    expect(edited.map((s) => s.text)).toEqual(["Freeze the outgoing wire", "Call the bank fraud line at 24h number", "Tell the CFO"]);
    expect(edited[2].source).toBe("custom");

    const t = await toTask(jsonRequest("/x", "POST"), params({ id: inc.id, runId, stepId: edited[0].id }));
    expect(t.status).toBe(201);
    const { taskId } = await t.json();
    const task = await db.incidentTask.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.incidentId).toBe(inc.id);
    expect(task.title).toBe("Freeze the outgoing wire");
    expect((await toTask(jsonRequest("/x", "POST"), params({ id: inc.id, runId, stepId: edited[0].id }))).status).toBe(409);

    // Every step done: the run is completed; reopening one makes it active again.
    for (const s of edited) await patchStep(jsonRequest("/x", "PATCH", { done: true }), params({ id: inc.id, runId, stepId: s.id }));
    expect((await db.incidentPlaybookRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("completed");
    await patchStep(jsonRequest("/x", "PATCH", { done: false }), params({ id: inc.id, runId, stepId: edited[1].id }));
    expect((await db.incidentPlaybookRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("active");

    const source = await db.sourceDocument.findUniqueOrThrow({ where: { id: d.id } });
    expect(source.text).toBe(OTHER);
  });

  it("scoping: another incident's path, a reader, and a locked incident's participant cannot change a run", async () => {
    const admin = await createMember("administrator");
    const reader = await createMember("reader");
    const participant = await createMember("contributor");
    const d = await doc(admin, "Wire fraud response", OTHER);
    const a = await createIncident(admin);
    const b = await createIncident(admin);
    as(admin);
    const { runId } = await (await attach(jsonRequest("/x", "POST", { documentId: d.id }), params({ id: a.id }))).json();
    const step = await db.incidentPlaybookStep.findFirstOrThrow({ where: { runId } });

    // The run of incident A through incident B's path: not found.
    expect((await patchStep(jsonRequest("/x", "PATCH", { done: true }), params({ id: b.id, runId, stepId: step.id }))).status).toBe(404);

    as(reader);
    expect((await patchStep(jsonRequest("/x", "PATCH", { done: true }), params({ id: a.id, runId, stepId: step.id }))).status).toBe(403);
    const readerView = await (await listPlaybooks(jsonRequest("/x", "GET"), params({ id: a.id }))).json();
    expect(readerView.canEdit).toBe(false);
    expect(readerView.runs).toHaveLength(1);

    await db.incident.update({ where: { id: a.id }, data: { restricted: true, lockedAt: new Date() } });
    await db.incidentParticipant.create({ data: { organizationId: admin.organizationId, incidentId: a.id, userId: participant.id, userName: participant.name } });
    as(participant);
    expect((await patchStep(jsonRequest("/x", "PATCH", { done: true }), params({ id: a.id, runId, stepId: step.id }))).status).toBe(403);
    as(reader);
    expect((await listPlaybooks(jsonRequest("/x", "GET"), params({ id: a.id }))).status).toBe(404);
    expect((await db.incidentPlaybookStep.findUniqueOrThrow({ where: { id: step.id } })).doneAt).toBeNull();
  });
});
