// After-action reports list and read-only access against Postgres
// (TEST_DATABASE_URL): administrators, exercise directors and contributors
// see every report; readers see final versions of exercises they took part
// in. Practice exercises never appear. Filters by status, mode, ended date
// and title.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { fixtureSections } from "./test-fixture";
import { listAarRows, readableAarVersion } from "./register";

async function makeUser(name: string, role: SessionUser["role"]): Promise<SessionUser> {
  return createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name, role });
}

function sections(accepted: boolean): Prisma.InputJsonValue {
  const s = fixtureSections();
  if (accepted) s.analysis[0].afis[0] = { ...s.analysis[0].afis[0], status: "accepted" };
  return s as unknown as Prisma.InputJsonValue;
}

async function exercise(data: { title: string; mode: string; endedAt: string; createdById: string; isPractice?: boolean }) {
  return db.exercise.create({
    data: { ...data, status: "ended", startedAt: new Date(new Date(data.endedAt).getTime() - 2 * 3600_000), endedAt: new Date(data.endedAt), isPractice: data.isPractice ?? false },
  });
}

async function setup() {
  const admin = await makeUser("Ada Admin", "admin");
  const director = await makeUser("Dee Director", "director");
  const contributor = await makeUser("Cora Contributor", "facilitator");
  const reader = await makeUser("Rhea Reader", "member");
  const outsider = await makeUser("Otto Outsider", "member");

  const harbor = await exercise({ title: "Harbor outage drill", mode: "crisissim", endedAt: "2026-03-04T16:00:00Z", createdById: admin.id });
  const board = await exercise({ title: "Board tabletop", mode: "strategic", endedAt: "2026-06-10T16:00:00Z", createdById: contributor.id });
  const playbook = await exercise({ title: "Playbook walk", mode: "document", endedAt: "2026-09-01T16:00:00Z", createdById: admin.id });
  const practice = await exercise({ title: "Practice run", mode: "crisissim", endedAt: "2026-09-20T16:00:00Z", createdById: admin.id, isPractice: true });

  // The reader played in the harbor drill.
  await db.participant.create({ data: { exerciseId: harbor.id, userId: reader.id, displayName: "Rhea", roles: ["player"] } });

  const harborV1 = await db.afterActionReport.create({
    data: { exerciseId: harbor.id, version: 1, status: "final", finalizedAt: new Date("2026-03-06T12:00:00Z"), sections: sections(true) },
  });
  await db.aarSignature.createMany({
    data: [
      { aarId: harborV1.id, role: "sponsor", name: "Pat Morgan", keyId: "k1", signature: "sig" },
      { aarId: harborV1.id, role: "facilitator", name: "Dana Reyes", keyId: "k1", signature: "sig" },
    ],
  });
  await db.actionItem.createMany({
    data: [
      { exerciseId: harbor.id, aarId: harborV1.id, afi: "Legal was briefed late", correctiveAction: "Add legal to the call tree" },
      { exerciseId: harbor.id, aarId: harborV1.id, afi: "Backups not verified", correctiveAction: "Assign backup checks" },
    ],
  });
  await db.afterActionReport.create({ data: { exerciseId: harbor.id, version: 2, previousId: harborV1.id, status: "draft", sections: sections(true) } });
  await db.afterActionReport.create({ data: { exerciseId: board.id, version: 1, status: "review", sections: sections(false) } });
  await db.afterActionReport.create({ data: { exerciseId: playbook.id, version: 1, status: "final", finalizedAt: new Date("2026-09-03T12:00:00Z"), sections: sections(false) } });
  await db.afterActionReport.create({ data: { exerciseId: practice.id, version: 1, status: "final", sections: sections(false) } });

  return { admin, director, contributor, reader, outsider, harbor, board, playbook, practice };
}

const titles = (rows: Array<{ exerciseTitle: string }>) => rows.map((r) => r.exerciseTitle);

describe.skipIf(!hasTestDb)("after-action reports list (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "User", "ActionItem");
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await db.$disconnect();
  });

  it("program users see every report, newest first, the latest version; practice never appears", async () => {
    const f = await setup();
    for (const u of [f.admin, f.director, f.contributor]) {
      const rows = await listAarRows(u);
      expect(titles(rows), u.name).toEqual(["Playbook walk", "Board tabletop", "Harbor outage drill"]);
      const harbor = rows.find((r) => r.exerciseId === f.harbor.id)!;
      expect(harbor).toMatchObject({ version: 2, status: "draft", mode: "crisissim" });
    }
    // Exports follow the control team: administrators and directors everywhere,
    // a contributor where they own the exercise.
    expect((await listAarRows(f.admin)).every((r) => r.canExport)).toBe(true);
    expect((await listAarRows(f.director)).every((r) => r.canExport)).toBe(true);
    const mine = await listAarRows(f.contributor);
    expect(mine.filter((r) => r.canExport).map((r) => r.exerciseTitle)).toEqual(["Board tabletop"]);
  });

  it("a reader sees only final versions of exercises they took part in", async () => {
    const f = await setup();
    const rows = await listAarRows(f.reader);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exerciseTitle: "Harbor outage drill",
      version: 1,
      status: "final",
      acceptedFindings: 1,
      workItems: 2,
      canExport: false,
      signers: [
        { role: "facilitator", name: "Dana Reyes" },
        { role: "sponsor", name: "Pat Morgan" },
      ],
    });
    expect(await listAarRows(f.outsider)).toEqual([]);
    // Drafts and reviews stay hidden whatever the filter asks for.
    expect(await listAarRows(f.reader, { status: "draft" })).toEqual([]);
  });

  it("filters by status, mode, ended date and title", async () => {
    const f = await setup();
    expect(titles(await listAarRows(f.admin, { status: "final" }))).toEqual(["Playbook walk"]);
    expect(titles(await listAarRows(f.admin, { status: "review" }))).toEqual(["Board tabletop"]);
    expect(titles(await listAarRows(f.admin, { status: "draft" }))).toEqual(["Harbor outage drill"]);
    expect(titles(await listAarRows(f.admin, { mode: "strategic" }))).toEqual(["Board tabletop"]);
    expect(titles(await listAarRows(f.admin, { q: "HARBOR" }))).toEqual(["Harbor outage drill"]);
    expect(titles(await listAarRows(f.admin, { from: "2026-05-01", to: "2026-06-30" }))).toEqual(["Board tabletop"]);
    expect(titles(await listAarRows(f.admin, { to: "2026-03-04" }))).toEqual(["Harbor outage drill"]);
    expect(titles(await listAarRows(f.admin, { from: "2026-06-11" }))).toEqual(["Playbook walk"]);
    expect(titles(await listAarRows(f.admin, { mode: "document", q: "board" }))).toEqual([]);
  });

  it("read-only access: program users any version, readers who took part final versions only", async () => {
    const f = await setup();
    expect(await readableAarVersion(f.admin, f.harbor.id)).toBe(2);
    expect(await readableAarVersion(f.contributor, f.harbor.id, 1)).toBe(1);
    expect(await readableAarVersion(f.contributor, f.board.id)).toBe(1);
    expect(await readableAarVersion(f.reader, f.harbor.id)).toBe(1);
    expect(await readableAarVersion(f.reader, f.harbor.id, 2)).toBeNull();
    expect(await readableAarVersion(f.reader, f.playbook.id)).toBeNull();
    expect(await readableAarVersion(f.outsider, f.harbor.id)).toBeNull();
    expect(await readableAarVersion(f.admin, f.practice.id)).toBeNull();
  });
});
