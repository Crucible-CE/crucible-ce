// Readiness snapshots against Postgres (TEST_DATABASE_URL): one row per day,
// a rerun the same day replaces it, the trend reads 12 months oldest first,
// and the executive dashboard counts what a director may see.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_ORG_ID, createTestUser, hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import { readinessTrend, saveReadinessSnapshot, snapshotDay, takeReadinessSnapshot } from "./snapshot";
import { computeReadiness } from "./score";
import { readinessInputs } from "./inputs";
import { buildProgramReport } from "@/lib/exercise/program/report";
import { buildExecutiveDashboard } from "@/lib/exercise/program/executive";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const empty = computeReadiness({
  cadence: [],
  exercisesLast12: 0,
  roles: [],
  ratings: [],
  workItems: { open: 0, overdue: 0, openHigh: 0, stale: 0 },
  aar: { ended: 0, overdue: 0 },
  techniques: 0,
  playbooks: { total: 0, own: 0, exercised: 0, run: 0, used: 0 },
});

describe.skipIf(!hasTestDb)("readiness snapshots (integration)", () => {
  beforeEach(async () => {
    await truncate("ReadinessSnapshot", "Exercise", "ActionItem", "User");
  });

  afterAll(async () => {
    await truncate("ReadinessSnapshot");
  });

  it("keeps one row per day and replaces it on a rerun", async () => {
    const morning = new Date("2026-10-26T02:30:00Z");
    const evening = new Date("2026-10-26T21:00:00Z");
    const a = await saveReadinessSnapshot({ ...empty, score: 40 }, morning);
    const b = await saveReadinessSnapshot({ ...empty, score: 55 }, evening);
    expect(a?.id).toBe(b?.id);
    const rows = await db.readinessSnapshot.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(55);
    expect(rows[0].day.toISOString()).toBe(snapshotDay(morning).toISOString());

    await saveReadinessSnapshot({ ...empty, score: 60 }, new Date("2026-10-27T02:30:00Z"));
    expect(await db.readinessSnapshot.count()).toBe(2);
  });

  it("returns the last 12 months, oldest first", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    await saveReadinessSnapshot({ ...empty, score: 10 }, new Date("2025-09-01T00:00:00Z"));
    await saveReadinessSnapshot({ ...empty, score: 70 }, new Date("2026-10-20T00:00:00Z"));
    await saveReadinessSnapshot({ ...empty, score: 50 }, new Date("2026-01-15T00:00:00Z"));
    expect(await readinessTrend(now)).toEqual([
      { day: "2026-01-15", score: 50 },
      { day: "2026-10-20", score: 70 },
    ]);
  });

  it("takes a snapshot from the database twice in a day without a second row", async () => {
    const now = new Date();
    const first = await takeReadinessSnapshot(now);
    const second = await takeReadinessSnapshot(now);
    expect(first?.id).toBe(second?.id);
    expect(await db.readinessSnapshot.count()).toBe(1);
  });

  it("counts own playbooks exercised or run on an incident, once each", async () => {
    await truncate("SourceDocument", "Incident");
    const admin = await createTestUser({ email: "pb-admin@example.test", name: "Pat Admin", role: "admin" });
    const doc = (title: string, scope = "local") =>
      db.sourceDocument.create({ data: { kind: "playbook", title, text: "# " + title, sha256: title.padEnd(64, "0").slice(0, 64), scope } });
    const [both, exercisedOnly, runOnly, deletedRun, unused] = await Promise.all([doc("both"), doc("exercised"), doc("run"), doc("deleted"), doc("unused")]);
    await doc("library", "library");
    const now = new Date();
    for (const d of [both, exercisedOnly]) {
      await db.exercise.create({
        data: { mode: "document", title: "From " + d.title, status: "ended", startedAt: new Date(now.getTime() - 7200_000), endedAt: new Date(now.getTime() - 3600_000), sourceDocumentId: d.id },
      });
    }
    const incident = await db.incident.create({ data: { organizationId: TEST_ORG_ID, reportedById: admin.id, title: "Live incident", description: "x" } });
    const gone = await db.incident.create({ data: { organizationId: TEST_ORG_ID, reportedById: admin.id, title: "Deleted incident", description: "x", deletedAt: now } });
    const run = (incidentId: string, d: { id: string; title: string; sha256: string }, createdAt = now) =>
      db.incidentPlaybookRun.create({ data: { organizationId: TEST_ORG_ID, incidentId, documentId: d.id, documentTitle: d.title, documentSha256: d.sha256, createdById: admin.id, createdAt } });
    await run(incident.id, both);
    await run(incident.id, runOnly);
    await run(gone.id, deletedRun);
    await run(incident.id, unused, new Date(now.getTime() - 400 * 86_400_000));

    const inputs = await readinessInputs(await buildProgramReport({ from: new Date(now.getTime() - 365 * 86_400_000), to: now }, now), now);
    expect(inputs.playbooks).toEqual({ total: 6, own: 5, exercised: 2, run: 2, used: 3 });
  });

  it("builds the executive dashboard for an exercise director", async () => {
    const director = await createTestUser({ email: "dir@example.test", name: "Dana Director", role: "director" });
    await db.exercise.create({
      data: { mode: "crisissim", title: "Q3 drill", status: "ended", startedAt: new Date(Date.now() - 3 * 3600_000), endedAt: new Date(Date.now() - 3600_000), createdById: director.id },
    });
    await db.actionItem.create({ data: { afi: "Slow paging", correctiveAction: "Add a paging test", priority: "high", dueDate: new Date(Date.now() - 86_400_000) } });
    const d = await buildExecutiveDashboard({ id: director.id, organizationId: director.organizationId, role: "exercise_director" });
    expect(d.program.exercises).toBe(1);
    expect(d.program.byMode).toEqual({ crisissim: 1 });
    expect(d.improvement).toMatchObject({ open: 1, overdue: 1, openHigh: 1 });
    expect(d.readiness.components).toHaveLength(7);
    expect(d.readiness.score).toBeGreaterThanOrEqual(0);
    expect(Object.keys(d.incidents.bySeverity)).toEqual(expect.arrayContaining(["critical", "high", "medium", "low"]));
  });
});
