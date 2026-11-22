// @vitest-environment node
// Template actions across modes against Postgres (ce_test):
//   - /api/templates/[id]/duplicate copies injects, branches and rubrics for
//     every mode (Studio modes through the Studio duplicate);
//   - /api/templates/[id]/publish runs the Studio checks for Strategic TTX and
//     Document TTX and keeps the Crisis Sim checks;
//   - the Document TTX editor save keeps Studio positions, node ids and branches;
//   - /api/documents/templates/[id]/publish runs the graph checks when branched;
//   - a Document TTX exercise created from a template gets its source document.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { createExercise } from "@/lib/exercise/create";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { createCrisisTemplateFixture } from "@/lib/exercise/test-fixture";
import { documentFixture } from "@/lib/exercise/studio/fixtures";
import { loadDocumentTemplate, saveDocumentTemplate } from "@/lib/exercise/templates/document-edit";
import { POST as duplicateRoute } from "@/app/api/templates/[id]/duplicate/route";
import { POST as publishRoute } from "@/app/api/templates/[id]/publish/route";
import { POST as documentPublishRoute } from "@/app/api/documents/templates/[id]/publish/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const TEAMS = ["Executive", "Legal"];

async function makeUser(): Promise<SessionUser> {
  const user = await createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name: "Tess Template", role: "facilitator" });
  vi.mocked(auth).mockResolvedValue(sessionFor(user) as never);
  return user;
}

const post = (url: string) => new Request(`http://localhost${url}`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function documentTemplate(status = "draft", config: Record<string, unknown> = {}): Promise<string> {
  const fx = documentFixture();
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "document",
      title: fx.title,
      summary: fx.summary,
      status,
      branching: fx.branching,
      config: { ...(fx.config as object), sourceDocumentId: null, ...config },
      objectives: fx.objectives as never,
      injects: { create: fx.injects.map((i) => ({ ...i, expectedActions: i.expectedActions as never, content: i.content as never, secret: i.secret as never, position: i.position as never })) },
      branches: { create: fx.branches.map((b) => ({ ...b, condition: b.condition as never })) },
      rubrics: { create: fx.rubrics.map((r) => ({ ...r, criteria: r.criteria as never })) },
    },
  });
  return t.id;
}

function strategicNode(nodeId: string, seq: number, end = false) {
  return {
    nodeId,
    seq,
    title: `Stage ${seq}`,
    scenarioOffsetMin: (seq - 1) * 30,
    plannedDelayMin: null,
    targetTeams: TEAMS,
    objectiveKeys: ["o1"],
    expectedActions: { Executive: ["Names an incident commander"], Legal: ["Records the discovery time"] },
    content: {
      schemaVersion: 1,
      narrativeMd: `Stage ${seq}. Administrators are locked out of the identity provider across the company.`,
      phase: "main",
      artifacts: [],
      teamVariants: TEAMS.map((team) => ({ team, status: "active", narrativeMd: `${team} hears about it.`, questions: [{ key: "q1", text: `What does ${team} decide first?` }] })),
    },
    secret: { schemaVersion: 1, expectedActions: { Executive: ["Names an incident commander"], Legal: ["Records the discovery time"] }, mitreTags: [], capabilityKeys: ["RS.MA"], clockUpdates: [] },
    position: { x: 0, y: seq * 160, ...(end ? { end: true } : {}) },
  };
}

/** A branched Strategic TTX template. With `deadEnd`, s2 neither branches on nor is marked as an end. */
async function strategicTemplate(deadEnd: boolean): Promise<string> {
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "strategic",
      title: "Identity takeover",
      status: "draft",
      branching: "branched",
      config: { teams: TEAMS, targetDurationMin: 60, scenarioAnchor: { weekday: 2, time: "09:00" }, regulatoryClocks: [] },
      objectives: [{ key: "o1", text: "Lead the response.", capabilityKeys: ["RS.MA"] }],
      injects: { create: [strategicNode("s1", 1), strategicNode("s2", 2, !deadEnd), strategicNode("s3", 3, true)] },
      branches: {
        create: [
          { fromNodeId: "s1", toNodeId: "s3", condition: { type: "team_outcome", team: "Legal", outcome: "ineffective" }, priority: 0 },
          { fromNodeId: "s1", toNodeId: "s2", condition: { type: "default" }, priority: 1 },
        ],
      },
    },
  });
  return t.id;
}

async function full(id: string) {
  return db.exerciseTemplate.findUniqueOrThrow({
    where: { id },
    include: {
      injects: { orderBy: { seq: "asc" } },
      branches: { orderBy: [{ fromNodeId: "asc" }, { priority: "asc" }] },
      rubrics: { orderBy: { questionKey: "asc" } },
    },
  });
}

describe.skipIf(!hasTestDb)("template actions by mode (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    await truncate("Exercise", "ExerciseTemplate", "SourceDocument", "User", "Job", "AuditEvent");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("duplicate copies branches and rubrics for Document TTX, Strategic TTX and Crisis Sim", async () => {
    await makeUser();
    for (const src of [await documentTemplate(), await strategicTemplate(false)]) {
      const res = await duplicateRoute(post(`/api/templates/${src}/duplicate`), ctx(src));
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const [a, b] = await Promise.all([full(src), full(id)]);
      expect(b).toMatchObject({ status: "draft", scope: "local", sourceId: src, branching: "branched", mode: a.mode });
      expect(b.injects.map((i) => [i.nodeId, i.seq, i.position, i.content])).toEqual(a.injects.map((i) => [i.nodeId, i.seq, i.position, i.content]));
      expect(b.branches.map((x) => [x.fromNodeId, x.toNodeId, x.condition, x.priority])).toEqual(a.branches.map((x) => [x.fromNodeId, x.toNodeId, x.condition, x.priority]));
      expect(b.rubrics.map((r) => [r.questionKey, r.criteria, r.modelAnswer])).toEqual(a.rubrics.map((r) => [r.questionKey, r.criteria, r.modelAnswer]));
      // Every branch end points at a node of the copy.
      const nodes = new Set(b.injects.map((i) => i.nodeId));
      expect(b.branches.every((x) => nodes.has(x.fromNodeId) && nodes.has(x.toNodeId))).toBe(true);
    }

    const crisis = await createCrisisTemplateFixture(db);
    await db.rubric.create({ data: { templateId: crisis, questionKey: "deliverable-n1", criteria: [{ id: "c1", text: "Names a spokesperson", controlRefs: [] }], maxScore: 4 } });
    const res = await duplicateRoute(post(`/api/templates/${crisis}/duplicate`), ctx(crisis));
    expect(res.status).toBe(201);
    const copy = await full(((await res.json()) as { id: string }).id);
    expect(copy.title).toBe("Fixture ransomware drill (copy)");
    expect(copy.injects.map((i) => i.nodeId)).toEqual(["n1", "n2"]);
    expect(copy.rubrics.map((r) => r.questionKey)).toEqual(["deliverable-n1"]);
  });

  it("publish runs the Studio checks for Strategic TTX and keeps the response shape", async () => {
    await makeUser();
    const bad = await strategicTemplate(true);
    const refused = await publishRoute(post(`/api/templates/${bad}/publish`), ctx(bad));
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; issues: Array<{ code: string; nodeId: string | null }> };
    expect(body.error).toBe("Fix the listed problems before publishing.");
    expect(body.issues.some((i) => i.code === "dead_end" && i.nodeId === "s2")).toBe(true);
    expect((await db.exerciseTemplate.findUniqueOrThrow({ where: { id: bad } })).status).toBe("draft");

    const good = await strategicTemplate(false);
    const ok = await publishRoute(post(`/api/templates/${good}/publish`), ctx(good));
    expect(ok.status, JSON.stringify(await ok.clone().json())).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(await db.exerciseTemplate.findUniqueOrThrow({ where: { id: good } })).toMatchObject({ status: "published", version: 2 });

    // Crisis Sim keeps its own checks and issue shape (the fixture lacks a materiality question).
    const crisis = await createCrisisTemplateFixture(db, { status: "draft" });
    const c = await publishRoute(post(`/api/templates/${crisis}/publish`), ctx(crisis));
    expect(c.status).toBe(409);
    const cb = (await c.json()) as { issues: Array<{ inject: number | null; message: string }> };
    expect(cb.issues[0]).toHaveProperty("inject");
  });

  it("the Document TTX editor save keeps Studio positions, node ids and branches", async () => {
    await makeUser();
    const id = await documentTemplate();
    await db.templateInject.update({ where: { templateId_nodeId: { templateId: id, nodeId: "m1" } }, data: { position: { x: 420, y: 40 } } });

    // Reorder only: everything Studio drew stays.
    const loaded = await loadDocumentTemplate(id);
    await saveDocumentTemplate(id, { modules: [loaded.modules[0]!, loaded.modules[2]!, loaded.modules[1]!] });
    let t = await full(id);
    expect(t.injects.map((i) => [i.nodeId, i.position])).toEqual([
      ["m1", { x: 420, y: 40 }],
      ["m3", { x: 0, y: 320, end: true }],
      ["m2", { x: 0, y: 160 }],
    ]);
    expect(t.branches).toHaveLength(3);

    // Drop m2 and add a module: branches touching m2 go, the new module lands below.
    const again = await loadDocumentTemplate(id);
    const m2 = again.modules.find((m) => m.title === "Module 2")!;
    const added = {
      title: "Module 4",
      scenarioOffsetMin: 240,
      plannedDelayMin: 20,
      content: { ...m2.content, questions: m2.content.questions.map((q) => ({ ...q, key: "q9" })) },
      secret: m2.secret,
    };
    await saveDocumentTemplate(id, { modules: [again.modules[0]!, again.modules[1]!, added] });
    t = await full(id);
    expect(t.injects.map((i) => [i.nodeId, i.position])).toEqual([
      ["m1", { x: 420, y: 40 }],
      ["m3", { x: 0, y: 320, end: true }],
      ["m4", { x: 0, y: 480 }],
    ]);
    expect(t.branches.map((b) => [b.fromNodeId, b.toNodeId])).toEqual([["m1", "m3"]]);
  });

  it("the Document TTX publish route runs the graph checks for a branched template", async () => {
    await makeUser();
    const id = await documentTemplate();
    await db.templateBranch.deleteMany({ where: { templateId: id, fromNodeId: "m2" } });
    const res = await documentPublishRoute(post(`/api/documents/templates/${id}/publish`), ctx(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; issues: Array<{ module: number | null; message: string }> };
    expect(body.issues.some((i) => i.module === 1)).toBe(true);
    expect((await db.exerciseTemplate.findUniqueOrThrow({ where: { id } })).status).toBe("draft");
  });

  it("a Document TTX exercise from a template gets the template's document and pacing", async () => {
    const user = await makeUser();
    const doc = await db.sourceDocument.create({ data: { kind: "playbook", title: "Playbook", text: "# Playbook", sha256: "c".repeat(64), sections: [] } });
    const id = await documentTemplate("published", { sourceDocumentId: doc.id, paced: "timer", moduleMinutes: 20 });
    const { id: exerciseId } = await createExercise({ mode: "document", title: "Run", templateId: id }, user);
    expect(await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } })).toMatchObject({ sourceDocumentId: doc.id, advancePolicy: "timer" });
  });
});
