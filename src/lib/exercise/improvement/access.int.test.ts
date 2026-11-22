// Improvement plan write access against Postgres (TEST_DATABASE_URL): drivers of the
// exercise and admins resolve, reject and reopen AFIs; a facilitator seated
// as a player in the exercise never writes its plan.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { auth } from "@/lib/auth";
import { fixtureSections } from "@/lib/exercise/aar/test-fixture";
import { POST as afiRoute } from "@/app/api/action-items/afis/route";
import { PATCH as itemPatch } from "@/app/api/action-items/[itemId]/route";
import { assertPlanWrite } from "./access";
import { listAfis, parseSections } from "./afis";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

async function makeUser(name: string, role: "admin" | "facilitator" | "member" = "facilitator"): Promise<SessionUser> {
  return createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name, role });
}

async function setup() {
  const owner = await makeUser("Fran Facilitator");
  const ex = await db.exercise.create({
    data: {
      mode: "crisissim",
      title: "Fixture drill",
      status: "ended",
      startedAt: new Date("2026-03-04T14:00:00Z"),
      endedAt: new Date("2026-03-04T16:00:00Z"),
      createdById: owner.id,
      objectives: { create: [{ seq: 1, text: "Decide on containment within the first hour." }] },
    },
    include: { objectives: true },
  });
  await db.participant.create({ data: { exerciseId: ex.id, userId: owner.id, displayName: owner.name, roles: ["lead_facilitator"], joinedAt: new Date() } });
  const aar = await db.afterActionReport.create({
    data: {
      exerciseId: ex.id,
      status: "draft",
      sections: fixtureSections([{ id: ex.objectives[0].id, text: ex.objectives[0].text }]) as unknown as Prisma.InputJsonValue,
    },
  });
  const afiId = listAfis(parseSections(aar.sections)!)[0].id;
  return { owner, exerciseId: ex.id, aarId: aar.id, afiId };
}

function as(user: SessionUser | null) {
  vi.mocked(auth).mockResolvedValue((user ? sessionFor(user) : null) as never);
}

const afi = (body: Record<string, unknown>) =>
  afiRoute(new Request("http://localhost/api/action-items/afis", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

describe.skipIf(!hasTestDb)("improvement plan write access (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "User", "AuditEvent", "ActionItem");
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await db.$disconnect();
  });

  it("drivers and admins write; a facilitator seated as a player does not", async () => {
    const f = await setup();
    const admin = await makeUser("Ada Admin", "admin");
    const controller = await makeUser("Cal Controller", "member");
    const seatedPlayer = await makeUser("Pat Player");
    const outsider = await makeUser("Otto Outsider");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: controller.id, displayName: "Cal", roles: ["controller"] } });
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: seatedPlayer.id, displayName: "Pat", roles: ["player"] } });

    await expect(assertPlanWrite(f.owner, f.exerciseId)).resolves.toBeTruthy();
    await expect(assertPlanWrite(admin, f.exerciseId)).resolves.toBeTruthy();
    await expect(assertPlanWrite(controller, f.exerciseId)).resolves.toBeTruthy();
    await expect(assertPlanWrite(seatedPlayer, f.exerciseId)).rejects.toMatchObject({ status: 403 });
    await expect(assertPlanWrite(seatedPlayer, f.exerciseId, { scope: "item" })).rejects.toMatchObject({ status: 403 });
    await expect(assertPlanWrite(outsider, f.exerciseId)).rejects.toMatchObject({ status: 403 });
    // Program-wide tracking of item status still works for a facilitator with no seat.
    await expect(assertPlanWrite(outsider, f.exerciseId, { scope: "item" })).resolves.toEqual({ participantId: null });
  });

  it("AFI reject and reopen refuse a seated player facilitator and accept the lead facilitator", async () => {
    const f = await setup();
    const seatedPlayer = await makeUser("Pat Player");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: seatedPlayer.id, displayName: "Pat", roles: ["player"] } });

    as(seatedPlayer);
    expect((await afi({ aarId: f.aarId, afiId: f.afiId, action: "reject", reason: "Out of scope" })).status).toBe(403);
    expect((await afi({ aarId: f.aarId, afiId: f.afiId, action: "reopen" })).status).toBe(403);
    expect((await afi({ aarId: f.aarId, afiId: f.afiId, action: "carry" })).status).toBe(403);
    expect(listAfis(parseSections((await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId } })).sections)!)[0].rejectedReason).toBeNull();

    as(f.owner);
    expect((await afi({ aarId: f.aarId, afiId: f.afiId, action: "reject", reason: "Out of scope" })).status).toBe(200);
    expect(listAfis(parseSections((await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId } })).sections)!)[0].rejectedReason).toBe("Out of scope");
    expect((await afi({ aarId: f.aarId, afiId: f.afiId, action: "reopen" })).status).toBe(200);

    const item = await db.actionItem.create({ data: { exerciseId: f.exerciseId, aarId: f.aarId, afi: "Containment was late", correctiveAction: "Write the isolation runbook" } });
    as(seatedPlayer);
    const patch = new Request(`http://localhost/api/action-items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }), headers: { "content-type": "application/json" } });
    expect((await itemPatch(patch, { params: Promise.resolve({ itemId: item.id }) })).status).toBe(403);
  });
});
