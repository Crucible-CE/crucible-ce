// Export for Cloud and Cloud notes against Postgres (TEST_DATABASE_URL): the
// file holds templates, source documents and user emails and nothing else;
// a dismissed note stays dismissed; the org switch hides every note.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, sessionFor, setTestSettings, TEST_ORG_ID, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createCrisisTemplateFixture } from "@/lib/exercise/test-fixture";
import { fixtureSections } from "@/lib/exercise/aar/test-fixture";
import { buildCloudExport, CLOUD_EXPORT_FORMAT } from "./cloud-export";
import { seedCrisisSimTemplates } from "./templates/crisissim-seed";
import { seedStrategicTemplates } from "./strategic/seed";
import { CRISISSIM_SEED_TEMPLATES } from "./templates/crisissim-seed-data";
import { STRATEGIC_SEED_TEMPLATES } from "./strategic/seed-data";
import { cloudNotesStateFor } from "@/lib/cloud/notes-server";
import { GET as exportRoute } from "@/app/api/settings/cloud-export/route";
import { POST as dismissRoute, DELETE as resetRoute } from "@/app/api/cloud-notes/route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const email = (p: string) => `${p}${Math.random().toString(36).slice(2, 8)}@example.test`;

describe.skipIf(!hasTestDb)("Export for Cloud (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "ExerciseTemplate", "SourceDocument", "User", "Incident", "AuditEvent", "CloudNoteDismissal");
    await setTestSettings({ showCloudNotes: true });
  });
  afterAll(async () => {
    await setTestSettings({ showCloudNotes: true });
    await db.$disconnect();
  });

  it("holds templates, documents and user emails, and no exercises, reports or incidents", async () => {
    const admin = await createTestUser({ email: email("admin"), name: "Ada Admin", role: "admin" });
    const gone = await createTestUser({ email: email("gone"), name: "Gone User", role: "member" });
    await db.user.update({ where: { id: gone.id }, data: { isActive: false } });
    const templateId = await createCrisisTemplateFixture(db, { createdById: admin.id });
    await db.exerciseTemplate.create({ data: { mode: "crisissim", title: "Library scenario", scope: "library", status: "published" } });
    await db.sourceDocument.create({ data: { kind: "playbook", title: "Ransomware playbook", text: "Isolate first.", sha256: "a".repeat(64) } });
    const ex = await db.exercise.create({
      data: { mode: "crisissim", title: "SECRET EXERCISE TITLE", status: "ended", objectives: { create: [{ seq: 1, text: "Objective text" }] } },
      include: { objectives: true },
    });
    const sections = fixtureSections([{ id: ex.objectives[0].id, text: "Objective text" }]);
    sections.executiveSummary = "SECRET REPORT SUMMARY";
    await db.afterActionReport.create({ data: { exerciseId: ex.id, sections: sections as unknown as Prisma.InputJsonValue } });
    await db.incident.create({ data: { organizationId: TEST_ORG_ID, reportedById: admin.id, title: "SECRET INCIDENT", description: "SECRET INCIDENT BODY" } });

    const { file } = await buildCloudExport();
    expect(Object.keys(file).sort()).toEqual(["documents", "exportedAt", "format", "templates", "users", "version"]);
    expect(file.format).toBe(CLOUD_EXPORT_FORMAT);
    expect(file.templates.map((t) => t.template.title)).toHaveLength(1);
    expect(file.templates[0].format).toBe("crucible-template");
    expect(file.documents).toEqual([{ title: "Ransomware playbook", kind: "playbook", text: "Isolate first.", sha256: "a".repeat(64) }]);
    expect(file.users).toEqual([{ email: admin.email }]);
    const text = JSON.stringify(file);
    for (const secret of ["SECRET EXERCISE TITLE", "SECRET REPORT SUMMARY", "SECRET INCIDENT", ex.id, "Library scenario", gone.email, "Ada Admin"]) {
      expect(text).not.toContain(secret);
    }
    expect(templateId).toBeTruthy();

    // Administrators only, and audited with counts.
    const member = await createTestUser({ email: email("m"), name: "Mo Member", role: "facilitator" });
    vi.mocked(auth).mockResolvedValue(sessionFor(member) as never);
    expect((await exportRoute(new Request("http://localhost/api/settings/cloud-export"))).status).toBe(403);
    vi.mocked(auth).mockResolvedValue(sessionFor(admin) as never);
    const res = await exportRoute(new Request("http://localhost/api/settings/cloud-export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="crucible-export-for-cloud-\d{4}-\d{2}-\d{2}\.json"/);
    expect(((await res.json()) as { templates: unknown[] }).templates).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 200));
    const row = await db.adminAuditLog.findFirst({ where: { action: "settings.cloud_export" } });
    expect(row?.metadataJson).toMatchObject({ templates: 1, documents: 1, users: 2 });
  });

  it("includes a library template only after the organization edits it", async () => {
    await seedCrisisSimTemplates(db);
    await seedStrategicTemplates(db);
    expect((await buildCloudExport()).file.templates).toEqual([]);

    // Moving a node on the canvas is not an edit.
    const crisisId = CRISISSIM_SEED_TEMPLATES[0].id;
    const first = await db.templateInject.findFirstOrThrow({ where: { templateId: crisisId }, orderBy: { seq: "asc" } });
    await db.templateInject.update({ where: { id: first.id }, data: { position: { x: 400, y: 20 } } });
    expect((await buildCloudExport()).file.templates).toEqual([]);

    await db.templateInject.update({ where: { id: first.id }, data: { title: "Edited first update" } });
    const strategicId = STRATEGIC_SEED_TEMPLATES[0].id;
    await db.exerciseTemplate.update({ where: { id: strategicId }, data: { summary: "Our own summary." } });
    const titles = (await buildCloudExport()).file.templates.map((t) => t.template.title).sort();
    expect(titles).toEqual([CRISISSIM_SEED_TEMPLATES[0].title, STRATEGIC_SEED_TEMPLATES[0].title].sort());
  });

  it("keeps a dismissed note dismissed, and hides every note when the organization turns them off", async () => {
    const fac = await createTestUser({ email: email("f"), name: "Fran Facilitator", role: "facilitator" });
    const reader = await createTestUser({ email: email("r"), name: "Rae Reader", role: "member" });
    const ceRole = (u: typeof fac) => ({ id: u.id, role: sessionFor(u).user.role });
    expect(await cloudNotesStateFor(ceRole(fac))).toMatchObject({ enabled: true, dismissed: [] });
    expect((await cloudNotesStateFor(ceRole(reader))).enabled).toBe(false);

    vi.mocked(auth).mockResolvedValue(sessionFor(fac) as never);
    const post = (note: string) =>
      dismissRoute(new Request("http://localhost/api/cloud-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) }));
    expect((await post("ai-grading")).status).toBe(200);
    expect((await post("ai-grading")).status).toBe(200);
    expect((await post("not-a-note")).status).toBe(400);
    expect((await cloudNotesStateFor(ceRole(fac))).dismissed).toEqual(["ai-grading"]);
    expect(await db.cloudNoteDismissal.count()).toBe(1);

    vi.mocked(auth).mockResolvedValue(sessionFor(reader) as never);
    expect((await post("sop-analysis")).status).toBe(403);

    await setTestSettings({ showCloudNotes: false });
    expect((await cloudNotesStateFor(ceRole(fac))).enabled).toBe(false);
    await setTestSettings({ showCloudNotes: true });

    vi.mocked(auth).mockResolvedValue(sessionFor(fac) as never);
    expect((await resetRoute()).status).toBe(200);
    expect((await cloudNotesStateFor(ceRole(fac))).dismissed).toEqual([]);
  });
});
