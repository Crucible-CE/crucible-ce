// @vitest-environment node
// Situation Manual and C/E handbook against Postgres (ce_test): what each
// audience gets, per mode, and who may download which document.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, ensureTestOrg, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { TEST_ORG_ID } from "@/test/exercise-db";
import { seedStrategicTemplates } from "@/lib/exercise/strategic/seed";
import { GET as exportRoute } from "@/app/api/exercises/[id]/exports/[kind]/route";
import { createExercise } from "../create";
import { seedCapabilities } from "../seed-capabilities";
import { createCrisisTemplateFixture } from "../test-fixture";
import { buildHandbook, buildSituationManual } from "./data";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

async function makeUser(role: "admin" | "facilitator" | "member" = "facilitator"): Promise<SessionUser> {
  return await createTestUser({ email: `x${Math.random().toString(36).slice(2)}@example.test`, name: `Lee ${role}`, role: role });
}

function signIn(u: SessionUser | null) {
  vi.mocked(auth).mockResolvedValue((u ? sessionFor(u) : null) as never);
}

/** Every string in a value, joined, for "must not contain" checks. */
function allText(v: unknown): string {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(v);
  return out.join("\n");
}

/** Narratives, questions, options and expected actions in a template's injects. */
async function secretStrings(templateId: string): Promise<string[]> {
  const rows = await db.templateInject.findMany({ where: { templateId }, select: { content: true, secret: true, expectedActions: true } });
  const out: string[] = [];
  const keep = new Set(["narrativeMd", "narrative", "stem", "text", "consequenceText", "scenarioUpdate", "discussionPrompt", "prompt", "content"]);
  const walk = (x: unknown, key: string | null, secret: boolean) => {
    if (typeof x === "string") {
      if ((secret || (key && keep.has(key))) && x.trim().length > 12) out.push(x.trim().slice(0, 60));
    } else if (Array.isArray(x)) x.forEach((y) => walk(y, key, secret));
    else if (x && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k, secret);
  };
  for (const r of rows) {
    walk(r.content, null, false);
    walk(r.secret, null, true);
    walk(r.expectedActions, null, true);
  }
  return out;
}

async function createDocumentTemplate(createdById: string): Promise<string> {
  const t = await db.exerciseTemplate.create({
    data: {
      mode: "document",
      title: "Playbook walk-through",
      status: "published",
      createdById,
      config: { schemaVersion: 1, teams: [], executiveBriefMd: "We walk the incident playbook module by module." },
      objectives: [{ key: "declare", text: "Declare a severity 1 incident on time.", capabilityKeys: [] }],
    },
  });
  const modules = [
    { title: "Detection and declaration", update: "The SOC sees mass file renames on three servers at 02:10.", q: "Who can declare a severity 1 incident at night?", act: "Page the incident commander within 15 minutes" },
    { title: "Containment", update: "Encryption has reached the backup server share.", q: "When do you cut the network link to the plant?", act: "Isolate the backup network segment" },
  ];
  for (const [i, m] of modules.entries()) {
    await db.templateInject.create({
      data: {
        templateId: t.id,
        nodeId: `m${i + 1}`,
        seq: i + 1,
        title: m.title,
        objectiveKeys: ["declare"],
        content: { schemaVersion: 1, scenarioUpdate: m.update, keyIssues: ["Night shift staffing is thin"], docSectionRefs: [], questions: [{ key: `q${i + 1}`, text: m.q, category: "detection" }] },
        secret: { schemaVersion: 1, expectedActions: [m.act] },
      },
    });
  }
  return t.id;
}

describe.skipIf(!hasTestDb)("exercise exports (integration)", () => {
  beforeAll(async () => {
    await ensureTestOrg();
    await seedCapabilities();
  });
  beforeEach(async () => {
    await truncate("Exercise", "ExerciseTemplate", "User", "AuditEvent", "RateLimitBucket");
    await db.exerciseSettings.upsert({ where: { organizationId: TEST_ORG_ID }, create: { organizationId: TEST_ORG_ID, timezone: "UTC" }, update: { timezone: "UTC" } });
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await db.$disconnect();
  });

  it("Crisis Sim: the SitMan has the brief and no inject content; the handbook has all of it", async () => {
    const user = await makeUser();
    const templateId = await createCrisisTemplateFixture(db, { createdById: user.id });
    const { id } = await createExercise({ mode: "crisissim", title: "Ransomware drill", templateId, plan: { stopWord: "REDWOOD", scope: "Corporate IT only." } }, user);

    const sitman = await buildSituationManual(id);
    const text = allText(sitman);
    expect(sitman.scenario).toContain("ransomware crew");
    expect(sitman.modules).toBeNull();
    expect(sitman.stopWord).toBe("REDWOOD");
    expect(sitman.objectives.map((o) => o.text)).toContain("Decide on containment within the first hour.");
    expect(sitman.teams.map((t) => t.name)).toEqual(["Executive", "Technical"]);
    for (const s of await secretStrings(templateId)) expect(text).not.toContain(s);
    for (const s of ["Ransomware on file servers", "Reporter calls", "Isolate the affected systems now.", "Isolate affected hosts", "What is your first move"]) {
      expect(text).not.toContain(s);
    }

    const hb = await buildHandbook(id);
    const all = allText(hb);
    expect(all).toContain("Ransomware on file servers");
    expect(all).toContain("What is your first move on the encrypted servers?");
    expect(all).toContain("Isolate affected hosts");
    expect(all).toContain("The team has early warning");
    const first = hb.injects[0];
    expect(first.narratives.map((n) => n.label)).toEqual(["On track path", "Under strain path", "Escalating path"]);
    expect(first.intended).toContainEqual({ team: "Executive", path: "On track", option: "Isolate the affected systems now.", why: null });
    expect(hb.eeg[0].criticalTasks).toContain("Isolate affected hosts");
    expect(hb.ratingLegend.map((r) => r.rating)).toEqual(["P", "S", "M", "U"]);
  });

  it("Strategic TTX: the SitMan never carries narratives, team questions or expected actions", async () => {
    const user = await makeUser();
    await seedStrategicTemplates(db);
    const template = await db.exerciseTemplate.findFirstOrThrow({ where: { mode: "strategic", status: "published" }, orderBy: { title: "asc" } });
    const { id } = await createExercise({ mode: "strategic", title: "Strategic test", templateId: template.id }, user);
    const sitman = await buildSituationManual(id);
    const text = allText(sitman);
    const secrets = await secretStrings(template.id);
    expect(secrets.length).toBeGreaterThan(10);
    for (const s of secrets) expect(text).not.toContain(s);
    const titles = await db.templateInject.findMany({ where: { templateId: template.id }, select: { title: true } });
    for (const t of titles) expect(text).not.toContain(t.title);
    expect(sitman.modules).toBeNull();

    const hb = await buildHandbook(id);
    expect(hb.injects.some((i) => i.narratives.length > 1)).toBe(true);
    expect(hb.injects.some((i) => i.expectedActions.length > 0)).toBe(true);
  });

  it("Document TTX: control gets every module title and question, no scenario updates or expected actions", async () => {
    const user = await makeUser();
    const templateId = await createDocumentTemplate(user.id);
    const { id } = await createExercise({ mode: "document", title: "Playbook test", templateId }, user);
    const sitman = await buildSituationManual(id, { control: true });
    expect(sitman.modules).toEqual([
      { seq: 1, title: "Detection and declaration", questions: ["Who can declare a severity 1 incident at night?"] },
      { seq: 2, title: "Containment", questions: ["When do you cut the network link to the plant?"] },
    ]);
    const text = allText(sitman);
    expect(text).not.toContain("mass file renames");
    expect(text).not.toContain("Page the incident commander");
    expect(text).not.toContain("Night shift staffing");
    const hb = await buildHandbook(id);
    expect(allText(hb)).toContain("Page the incident commander within 15 minutes");
    expect(allText(hb)).toContain("mass file renames");
  });

  it("Document TTX: players see no modules before STARTEX, then only released ones", async () => {
    const user = await makeUser();
    const templateId = await createDocumentTemplate(user.id);
    const { id } = await createExercise({ mode: "document", title: "Playbook test", templateId }, user);
    const before = await buildSituationManual(id);
    expect(before.modules).toEqual([]);
    expect(allText(before)).not.toContain("Detection and declaration");
    expect(allText(before)).not.toContain("Containment");

    const t1 = await db.templateInject.findFirstOrThrow({ where: { templateId, seq: 1 } });
    await db.exercise.update({ where: { id }, data: { status: "live", startedAt: new Date() } });
    await db.inject.create({ data: { exerciseId: id, seq: 1, status: "open", source: "module", title: t1.title, content: t1.content as never, templateInjectId: t1.id } });
    await db.inject.create({ data: { exerciseId: id, seq: 2, status: "held", source: "module", title: "Containment", content: {} } });
    const during = await buildSituationManual(id);
    expect(during.modules).toEqual([{ seq: 1, title: "Detection and declaration", questions: ["Who can declare a severity 1 incident at night?"] }]);
    expect(allText(during)).not.toContain("Containment");
  });

  it("the SitMan lists contacts by name and role only; the handbook keeps their email", async () => {
    const user = await makeUser();
    const templateId = await createCrisisTemplateFixture(db, { createdById: user.id });
    const { id } = await createExercise({ mode: "crisissim", title: "Contacts", templateId }, user);
    const sitman = await buildSituationManual(id, { control: true });
    expect(sitman.contacts.length).toBeGreaterThan(0);
    for (const c of sitman.contacts) {
      expect(c.email).toBeNull();
      expect(c.title).toBeNull();
      expect(c.organization).toBeNull();
      expect(c.roles).toEqual(["Lead facilitator"]);
    }
    expect(allText(sitman)).not.toContain(user.email);
    const hb = await buildHandbook(id);
    expect(hb.contacts.map((c) => c.email)).toContain(user.email);
  });

  it("players get the SitMan; only control gets the handbook and MSEL", async () => {
    const owner = await makeUser();
    const templateId = await createCrisisTemplateFixture(db, { createdById: owner.id });
    const { id } = await createExercise({ mode: "crisissim", title: "Access test", templateId }, owner);
    const player = await makeUser("member");
    const evaluator = await makeUser("member");
    const outsider = await makeUser("facilitator");
    await db.participant.create({ data: { exerciseId: id, userId: player.id, displayName: "Player One", roles: ["player"] } });
    await db.participant.create({ data: { exerciseId: id, userId: evaluator.id, displayName: "Eve Evaluator", roles: ["evaluator"] } });

    const call = (kind: string) => exportRoute(new Request(`http://localhost/api/exercises/${id}/exports/${kind}`), { params: Promise.resolve({ id, kind }) });

    signIn(player);
    const sm = await call("situation-manual");
    expect(sm.status).toBe(200);
    expect(sm.headers.get("content-type")).toBe("application/pdf");
    expect(sm.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await sm.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect((await call("ce-handbook")).status).toBe(403);
    expect((await call("msel-csv")).status).toBe(403);

    signIn(evaluator);
    const hb = await call("ce-handbook");
    expect(hb.status).toBe(200);
    expect(Buffer.from(await hb.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const csv = await call("msel-csv");
    expect(csv.status).toBe(200);
    expect(await csv.text()).toContain("Ransomware on file servers");

    signIn(outsider);
    expect((await call("situation-manual")).status).toBe(403);
    signIn(null);
    expect((await call("situation-manual")).status).toBe(401);
    signIn(owner);
    expect((await call("nope")).status).toBe(404);
  });
});
