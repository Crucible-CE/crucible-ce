// @vitest-environment node
// Scenario Studio and portable templates against Postgres (ce_test).
// Builds a branched Strategic TTX template through the Studio API, launches
// it and checks the run follows the team_outcome edge set by a human grade.
// Also: optimistic concurrency, the in-use rule, secret export permission and
// export then import for every mode.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { advanceExercise, closeInject, startExercise, submitResponse } from "@/lib/exercise/runtime/engine";
import { toParticipantRow } from "@/lib/exercise/runtime/snapshot";
import { createExercise } from "@/lib/exercise/create";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { addHumanGrade } from "@/lib/exercise/strategic/grades";
import { seedStrategicTemplates } from "@/lib/exercise/strategic/seed";
import { seedCrisisSimTemplates } from "@/lib/exercise/templates/crisissim-seed";
import { RANSOMWARE_TEMPLATE_ID } from "@/lib/exercise/templates/crisissim-seed-data";
import { exportTemplate, importTemplate, type PortableTemplate } from "@/lib/exercise/templates/portable";
import { documentFixture } from "./fixtures";
import { POST as createRoute } from "@/app/api/studio/templates/route";
import { GET as getRoute, PUT as putRoute } from "@/app/api/studio/templates/[id]/route";
import { POST as publishRoute } from "@/app/api/studio/templates/[id]/publish/route";
import { GET as exportRoute } from "@/app/api/templates/[id]/export/route";
import { POST as importRoute } from "@/app/api/templates/import/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const TEAMS = ["Executive", "Legal"];

async function makeUser(role: "facilitator" | "member" | "admin" = "facilitator"): Promise<SessionUser> {
  return await createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name: "Sam Studio", role: role });
}

function signIn(u: SessionUser | null) {
  vi.mocked(auth).mockResolvedValue((u ? sessionFor(u) : null) as never);
}

const json = (method: string, url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function node(nodeId: string, seq: number, title: string, end = false) {
  const variant = (team: string) => ({ team, status: "active", narrativeMd: `${team} hears about it from the service desk.`, questions: [{ key: "q1", text: `What does ${team} decide first?` }] });
  return {
    nodeId,
    seq,
    title,
    scenarioOffsetMin: (seq - 1) * 30,
    plannedDelayMin: null,
    objectiveKeys: ["o1"],
    content: {
      schemaVersion: 1,
      narrativeMd: `${title}. Administrators are locked out of the identity provider across the company.`,
      phase: "main",
      artifacts: [],
      teamVariants: TEAMS.map(variant),
    },
    secret: {
      schemaVersion: 1,
      expectedActions: { Executive: ["Names an incident commander"], Legal: ["Records the discovery time"] },
      mitreTags: [],
      capabilityKeys: ["RS.MA"],
      clockUpdates: [],
    },
    position: { x: 0, y: seq * 160, ...(end ? { end: true } : {}) },
  };
}

function branchedGraph(title = "Identity takeover") {
  return {
    template: {
      title,
      summary: null,
      branching: "branched",
      config: { teams: TEAMS, targetDurationMin: 60, scenarioAnchor: { weekday: 2, time: "09:00" }, regulatoryClocks: [] },
      objectives: [{ key: "o1", text: "Lead the response.", capabilityKeys: ["RS.MA"] }],
    },
    injects: [node("s1", 1, "Locked out"), node("s2", 2, "Recovery on track", true), node("s3", 3, "Legal escalation", true)],
    branches: [
      { fromNodeId: "s1", toNodeId: "s3", condition: { type: "team_outcome", team: "Legal", outcome: "ineffective" }, priority: 0 },
      { fromNodeId: "s1", toNodeId: "s2", condition: { type: "default" }, priority: 1 },
    ],
  };
}

async function studioTemplate(user: SessionUser, publish = true): Promise<{ id: string; updatedAt: string }> {
  signIn(user);
  const created = await createRoute(json("POST", "/api/studio/templates", { mode: "strategic", title: "Identity takeover" }));
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const got = (await (await getRoute(new Request(`http://localhost/api/studio/templates/${id}`), ctx(id))).json()) as { template: { updatedAt: string } };
  const put = await putRoute(json("PUT", `/api/studio/templates/${id}`, { expectedUpdatedAt: got.template.updatedAt, graph: branchedGraph() }), ctx(id));
  const putBody = (await put.json()) as { updatedAt: string; issues: unknown[]; error?: string };
  expect(put.status, JSON.stringify(putBody)).toBe(200);
  if (publish) {
    const pub = await publishRoute(new Request(`http://localhost/api/studio/templates/${id}/publish`, { method: "POST" }), ctx(id));
    expect(pub.status, JSON.stringify(await pub.clone().json())).toBe(200);
  }
  return { id, updatedAt: putBody.updatedAt };
}

async function launch(templateId: string, user: SessionUser) {
  const { id } = await createExercise({ mode: "strategic", title: "Run", templateId, advancePolicy: "facilitator" }, user);
  const teams = await db.team.findMany({ where: { exerciseId: id }, orderBy: { seq: "asc" } });
  const players = [];
  for (const team of teams) {
    players.push(
      toParticipantRow(
        await db.participant.create({ data: { exerciseId: id, displayName: `${team.name} lead`, isGuest: true, roles: ["player"], teamId: team.id, isDecisionMaker: true } }),
      ),
    );
  }
  return { exerciseId: id, teams, players };
}

async function runFirstWithLegal(templateId: string, user: SessionUser, rating: "effective" | "ineffective") {
  const { exerciseId, teams, players } = await launch(templateId, user);
  await startExercise(exerciseId, {});
  const first = await db.inject.findFirstOrThrow({ where: { exerciseId, status: "open" } });
  expect(first.title).toBe("Locked out");
  const legal = teams.findIndex((t) => t.name === "Legal");
  await submitResponse({ exerciseId, injectId: first.id, participant: players[legal]!, kind: "answer", raw: { text: "We record the discovery time as 09:10 and brief outside counsel." } });
  await closeInject(exerciseId, first.id, "facilitator", {}, { autoAdvance: false });
  const response = await db.response.findFirstOrThrow({ where: { injectId: first.id, teamId: teams[legal]!.id } });
  await addHumanGrade(exerciseId, { responseId: response.id, score: rating === "effective" ? 4 : 1, rating, rationale: "Evaluator call." }, user.id);
  const res = await advanceExercise(exerciseId, {});
  expect(res.ok).toBe(true);
  return db.inject.findFirstOrThrow({ where: { exerciseId, status: "open" } });
}

describe.skipIf(!hasTestDb)("Scenario Studio (integration)", () => {
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

  it("builds a branched Strategic TTX template and the run follows the team_outcome edge", async () => {
    const user = await makeUser();
    const { id } = await studioTemplate(user);
    const t = await db.exerciseTemplate.findUniqueOrThrow({ where: { id }, include: { injects: true, branches: true } });
    expect(t).toMatchObject({ status: "published", branching: "branched", mode: "strategic" });
    expect(t.injects).toHaveLength(3);
    expect(t.branches).toHaveLength(2);
    expect(t.injects.find((i) => i.nodeId === "s1")?.targetTeams).toEqual(TEAMS);

    const escalated = await runFirstWithLegal(id, user, "ineffective");
    expect(escalated.title).toBe("Legal escalation");
    const onTrack = await runFirstWithLegal(id, user, "effective");
    expect(onTrack.title).toBe("Recovery on track");
  });

  it("refuses a stale save with 409 and keeps the first save", async () => {
    const user = await makeUser();
    const { id, updatedAt } = await studioTemplate(user, false);
    signIn(user);
    const g1 = branchedGraph("First title");
    const ok = await putRoute(json("PUT", `/api/studio/templates/${id}`, { expectedUpdatedAt: updatedAt, graph: g1 }), ctx(id));
    expect(ok.status).toBe(200);
    const stale = await putRoute(json("PUT", `/api/studio/templates/${id}`, { expectedUpdatedAt: updatedAt, graph: branchedGraph("Second title") }), ctx(id));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe("Someone saved this template after you opened it. Reload to see their changes.");
    expect((await db.exerciseTemplate.findUniqueOrThrow({ where: { id } })).title).toBe("First title");
  });

  it("refuses a save with graph errors and lists them", async () => {
    const user = await makeUser();
    const { id, updatedAt } = await studioTemplate(user, false);
    signIn(user);
    const g = branchedGraph();
    g.branches.push({ fromNodeId: "s3", toNodeId: "s1", condition: { type: "default" }, priority: 0 });
    const res = await putRoute(json("PUT", `/api/studio/templates/${id}`, { expectedUpdatedAt: updatedAt, graph: g }), ctx(id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Array<{ code: string }> };
    expect(body.issues.some((i) => i.code === "cycle")).toBe(true);
  });

  it("refuses edits while a non-ended exercise uses the template", async () => {
    const user = await makeUser();
    const { id, updatedAt } = await studioTemplate(user);
    await createExercise({ mode: "strategic", title: "Run", templateId: id, advancePolicy: "facilitator" }, user);
    signIn(user);
    const res = await putRoute(json("PUT", `/api/studio/templates/${id}`, { expectedUpdatedAt: updatedAt, graph: branchedGraph("Changed") }), ctx(id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("An exercise using this template has not ended. Duplicate the template to make changes.");
  });

  it("exports secrets only to template managers who may read them", async () => {
    const owner = await makeUser();
    const member = await makeUser("member");
    const playing = await makeUser();
    const { id } = await studioTemplate(owner);
    const req = () => new Request(`http://localhost/api/templates/${id}/export`);

    signIn(member);
    expect((await exportRoute(req(), ctx(id))).status).toBe(403);
    expect((await getRoute(req(), ctx(id))).status).toBe(403);

    // A facilitator seated as a player in a live run of the template cannot read it.
    const { exerciseId } = await launch(id, owner);
    await db.exercise.update({ where: { id: exerciseId }, data: { status: "live" } });
    await db.participant.create({ data: { exerciseId, userId: playing.id, displayName: "Pat", roles: ["player"] } });
    signIn(playing);
    expect((await exportRoute(req(), ctx(id))).status).toBe(403);
    expect((await getRoute(req(), ctx(id))).status).toBe(403);

    signIn(owner);
    const ok = await exportRoute(req(), ctx(id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Disposition")).toContain("identity-takeover.template.json");
    const file = (await ok.json()) as PortableTemplate;
    expect(file.mode).toBe("strategic");
    expect(JSON.stringify(file)).toContain("Records the discovery time");
    expect(file.branches).toHaveLength(2);
  });

  it("exports and imports every mode as a new local draft", async () => {
    const user = await makeUser();
    await seedCrisisSimTemplates(db as never);
    await seedStrategicTemplates(db as never);

    // Crisis Sim through the existing routes.
    signIn(user);
    const crisisFile = await (await exportRoute(new Request("http://localhost/x"), ctx(RANSOMWARE_TEMPLATE_ID))).json();
    const imported = await importRoute(json("POST", "/api/templates/import", crisisFile));
    expect(imported.status).toBe(201);
    const ib = (await imported.json()) as { id: string; mode: string; issues: unknown[]; warnings: string[] };
    expect(ib).toMatchObject({ mode: "crisissim", issues: [], warnings: [] });
    const [src, copy] = await Promise.all(
      [RANSOMWARE_TEMPLATE_ID, ib.id].map((id) => db.exerciseTemplate.findUniqueOrThrow({ where: { id }, include: { injects: { orderBy: { seq: "asc" } } } })),
    );
    expect(copy).toMatchObject({ status: "draft", scope: "local", mode: "crisissim" });
    expect(copy.injects.map((i) => [i.content, i.secret, i.expectedActions])).toEqual(src.injects.map((i) => [i.content, i.secret, i.expectedActions]));

    // Strategic TTX, branched.
    const sFile = await exportTemplate("lib-strategic-fintech-breach");
    const s = await importTemplate(sFile, user.id);
    const [sSrc, sCopy] = await Promise.all(
      ["lib-strategic-fintech-breach", s.id].map((id) =>
        db.exerciseTemplate.findUniqueOrThrow({ where: { id }, include: { injects: { orderBy: { seq: "asc" } }, branches: { orderBy: [{ fromNodeId: "asc" }, { priority: "asc" }] } } }),
      ),
    );
    expect(sCopy).toMatchObject({ status: "draft", branching: "branched", sourceId: null });
    expect(sCopy.injects.map((i) => [i.nodeId, i.content, i.secret])).toEqual(sSrc.injects.map((i) => [i.nodeId, i.content, i.secret]));
    expect(sCopy.branches.map((b) => [b.fromNodeId, b.toNodeId, b.condition, b.priority])).toEqual(sSrc.branches.map((b) => [b.fromNodeId, b.toNodeId, b.condition, b.priority]));
    // The seed marks its last node as the end, so the copy has no graph issues.
    expect(s.issues.map((i) => (i as { code?: string }).code)).toEqual([]);

    // Document TTX with rubrics; the document is matched by hash.
    const fx = documentFixture();
    const text = "# Playbook\n\n## Declaring\nThe IC declares.";
    const sha = "b".repeat(64);
    const doc = await db.sourceDocument.create({ data: { kind: "playbook", title: "Ransomware playbook", text, sha256: sha, sections: [{ id: "s1", heading: "Declaring", level: 2, start: 0, end: text.length }] } });
    const tpl = await db.exerciseTemplate.create({
      data: {
        mode: "document",
        title: fx.title,
        summary: fx.summary,
        status: "published",
        branching: fx.branching,
        config: { ...(fx.config as object), sourceDocumentId: doc.id, sourceDocumentSha: sha },
        objectives: fx.objectives as never,
        injects: { create: fx.injects.map((i) => ({ ...i, expectedActions: i.expectedActions as never, content: i.content as never, secret: i.secret as never, position: i.position as never })) },
        branches: { create: fx.branches.map((b) => ({ ...b, condition: b.condition as never })) },
        rubrics: { create: fx.rubrics.map((r) => ({ ...r, criteria: r.criteria as never })) },
      },
    });
    const dFile = await exportTemplate(tpl.id);
    expect(dFile.sourceDocument).toEqual({ title: "Ransomware playbook", sha256: sha });
    expect(JSON.stringify(dFile)).not.toContain(doc.id);
    expect(JSON.stringify(dFile)).not.toContain("DOCUMENT-BODY-TEXT");
    const linked = await importTemplate(dFile, user.id);
    expect(linked.warnings).toEqual([]);
    const linkedRow = await db.exerciseTemplate.findUniqueOrThrow({ where: { id: linked.id }, include: { rubrics: true, branches: true } });
    expect((linkedRow.config as { sourceDocumentId: string }).sourceDocumentId).toBe(doc.id);
    expect(linkedRow.rubrics.map((r) => r.questionKey).sort()).toEqual(["q1", "q2", "q3"]);
    expect(linkedRow.branches).toHaveLength(3);

    await db.exerciseTemplate.delete({ where: { id: linked.id } });
    await db.sourceDocument.delete({ where: { id: doc.id } });
    const orphan = await importTemplate(dFile, user.id);
    expect(orphan.warnings).toEqual(['"Ransomware playbook" is not in the document library. Upload it to link its sections.']);
    const orphanRow = await db.exerciseTemplate.findUniqueOrThrow({ where: { id: orphan.id } });
    expect((orphanRow.config as { sourceDocumentId: string | null; sourceDocumentSha: string }).sourceDocumentId).toBeNull();
    expect((orphanRow.config as { sourceDocumentSha: string }).sourceDocumentSha).toBe(sha);
  });
});
