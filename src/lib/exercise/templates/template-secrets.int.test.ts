// @vitest-environment node
// A facilitator seated as a player in a colleague's live exercise must not
// read ahead through any template path (ce_test):
//   - Document TTX template GET, PATCH, rubrics GET and PUT, duplicate;
//   - the editor page;
//   - a new exercise from the template;
//   - the C/E handbook and MSEL of the exercise they play in.
// Once the exercise ends, the same facilitator reads the template again.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { createExercise } from "@/lib/exercise/create";
import { seedCapabilities } from "@/lib/exercise/seed-capabilities";
import { TEST_ORG_ID } from "@/test/exercise-db";
import { documentFixture } from "@/lib/exercise/studio/fixtures";
import { GET as templateGet, PATCH as templatePatch } from "@/app/api/documents/templates/[id]/route";
import { GET as rubricsGet, PUT as rubricsPut } from "@/app/api/documents/templates/[id]/rubrics/route";
import { POST as duplicateRoute } from "@/app/api/documents/templates/[id]/duplicate/route";
import { GET as exportRoute } from "@/app/api/exercises/[id]/exports/[kind]/route";
import { GET as mselRoute } from "@/app/api/exercises/[id]/msel/route";
import DocumentTemplatePage from "@/app/(platform)/documents/templates/[id]/page";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/components/documents/document-template-editor", () => ({ DocumentTemplateEditor: () => null }));

async function makeUser(name: string): Promise<SessionUser> {
  return createTestUser({ email: `${name.toLowerCase()}${Math.random().toString(36).slice(2)}@example.test`, name, role: "facilitator" });
}

function signIn(u: SessionUser) {
  vi.mocked(auth).mockResolvedValue(sessionFor(u) as never);
}

async function documentTemplate(createdById: string): Promise<string> {
  const fx = documentFixture();
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "document",
      title: fx.title,
      summary: fx.summary,
      status: "published",
      createdById,
      branching: fx.branching,
      config: { ...(fx.config as object), sourceDocumentId: null },
      objectives: fx.objectives as never,
      injects: { create: fx.injects.map((i) => ({ ...i, expectedActions: i.expectedActions as never, content: i.content as never, secret: i.secret as never, position: i.position as never })) },
      branches: { create: fx.branches.map((b) => ({ ...b, condition: b.condition as never })) },
      rubrics: { create: fx.rubrics.map((r) => ({ ...r, criteria: r.criteria as never })) },
    },
  });
  return t.id;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);

describe.skipIf(!hasTestDb)("template secrets for a seated player (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    await truncate("Exercise", "ExerciseTemplate", "SourceDocument", "User", "Job", "AuditEvent", "RateLimitBucket");
    await db.exerciseSettings.upsert({ where: { organizationId: TEST_ORG_ID }, create: { organizationId: TEST_ORG_ID, timezone: "UTC" }, update: { timezone: "UTC" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await db.$disconnect();
  });

  it("refuses every template path while the exercise runs, and allows them after it ends", async () => {
    const owner = await makeUser("Olive");
    const player = await makeUser("Pat");
    const templateId = await documentTemplate(owner.id);
    const { id: exerciseId } = await createExercise({ mode: "document", title: "Colleague run", templateId }, owner);
    await db.exercise.update({ where: { id: exerciseId }, data: { status: "live", startedAt: new Date() } });
    await db.participant.create({ data: { exerciseId, userId: player.id, displayName: "Pat Player", roles: ["player"], joinedAt: new Date() } });

    signIn(player);
    const get = await templateGet(req(`/api/documents/templates/${templateId}`), ctx(templateId));
    expect(get.status).toBe(403);
    expect(await get.json()).toEqual({ error: "You are playing in an exercise that uses this template." });
    expect((await rubricsGet(req(`/api/documents/templates/${templateId}/rubrics`), ctx(templateId))).status).toBe(403);
    const patch = req(`/api/documents/templates/${templateId}`, { method: "PATCH", body: JSON.stringify({ title: "Mine now" }), headers: { "content-type": "application/json" } });
    expect((await templatePatch(patch, ctx(templateId))).status).toBe(403);
    const put = req(`/api/documents/templates/${templateId}/rubrics`, { method: "PUT", body: JSON.stringify({ rubrics: [] }), headers: { "content-type": "application/json" } });
    expect((await rubricsPut(put, ctx(templateId))).status).toBe(403);
    expect((await duplicateRoute(req(`/api/documents/templates/${templateId}/duplicate`, { method: "POST" }), ctx(templateId))).status).toBe(403);
    expect(await db.exerciseTemplate.count()).toBe(1);
    await expect(DocumentTemplatePage({ params: Promise.resolve({ id: templateId }) })).rejects.toThrow(/NOT_FOUND|404/);

    await expect(createExercise({ mode: "document", title: "Read ahead", templateId }, player)).rejects.toMatchObject({
      status: 403,
      message: "You are playing in an exercise that uses this template.",
    });
    expect(await db.exercise.count()).toBe(1);

    // The exercise they play in: no handbook, no MSEL.
    const exportCall = (kind: string) => exportRoute(req(`/api/exercises/${exerciseId}/exports/${kind}`), { params: Promise.resolve({ id: exerciseId, kind }) });
    expect((await exportCall("ce-handbook")).status).toBe(403);
    expect((await exportCall("msel-csv")).status).toBe(403);
    expect((await mselRoute(req(`/api/exercises/${exerciseId}/msel`), ctx(exerciseId))).status).toBe(403);
    expect((await exportCall("situation-manual")).status).toBe(200);

    // The owner is unaffected.
    signIn(owner);
    expect((await templateGet(req(`/api/documents/templates/${templateId}`), ctx(templateId))).status).toBe(200);
    expect((await rubricsGet(req(`/api/documents/templates/${templateId}/rubrics`), ctx(templateId))).status).toBe(200);

    // After ENDEX the player reads the template again.
    await db.exercise.update({ where: { id: exerciseId }, data: { status: "ended", endedAt: new Date() } });
    signIn(player);
    expect((await templateGet(req(`/api/documents/templates/${templateId}`), ctx(templateId))).status).toBe(200);
    expect((await duplicateRoute(req(`/api/documents/templates/${templateId}/duplicate`, { method: "POST" }), ctx(templateId))).status).toBe(201);
    const { id } = await createExercise({ mode: "document", title: "After ENDEX", templateId }, player);
    expect(id).toBeTruthy();
  });
});
