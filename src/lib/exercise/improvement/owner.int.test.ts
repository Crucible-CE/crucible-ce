// Work items for their owner against Postgres (TEST_DATABASE_URL). A reader
// sees the items where they are the point of contact (POC email) and changes
// their status and closure evidence. Not other fields, not a rejection, not
// someone else's item, and never a new item. Contributors, exercise
// directors and administrators keep the whole plan.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, sessionFor, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { auth } from "@/lib/auth";
import { fixtureSections } from "@/lib/exercise/aar/test-fixture";
import { GET as listRoute, POST as createRoute } from "@/app/api/action-items/route";
import { PATCH as itemPatch } from "@/app/api/action-items/[itemId]/route";
import { assertOwnerUpdate, ownsItem } from "./access";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

async function makeUser(name: string, role: SessionUser["role"]): Promise<SessionUser> {
  return createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name, role });
}

function as(user: SessionUser) {
  vi.mocked(auth).mockResolvedValue(sessionFor(user) as never);
}

async function list(query = ""): Promise<{ status: number; ids: string[] }> {
  const res = await listRoute(new Request(`http://localhost/api/action-items${query}`));
  const body = (await res.json()) as { items?: Array<{ id: string }> };
  return { status: res.status, ids: (body.items ?? []).map((i) => i.id).sort() };
}

async function patch(id: string, body: Record<string, unknown>): Promise<number> {
  const req = new Request(`http://localhost/api/action-items/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return (await itemPatch(req, { params: Promise.resolve({ itemId: id }) })).status;
}

async function setup() {
  const admin = await makeUser("Ada Admin", "admin");
  const director = await makeUser("Dee Director", "director");
  const contributor = await makeUser("Cora Contributor", "facilitator");
  const reader = await makeUser("Rhea Reader", "member");
  const other = await makeUser("Otto Other", "member");
  const ex = await db.exercise.create({
    data: { mode: "crisissim", title: "Harbor outage drill", status: "ended", startedAt: new Date("2026-03-04T14:00:00Z"), endedAt: new Date("2026-03-04T16:00:00Z"), createdById: admin.id },
  });
  // Seated as a player: no plan write access in this exercise.
  await db.participant.create({ data: { exerciseId: ex.id, userId: reader.id, displayName: "Rhea", roles: ["player"] } });
  const aar = await db.afterActionReport.create({
    data: { exerciseId: ex.id, status: "final", finalizedAt: new Date("2026-03-06T12:00:00Z"), sections: fixtureSections() as unknown as Prisma.InputJsonValue },
  });
  const item = (data: Partial<Prisma.ActionItemUncheckedCreateInput>) =>
    db.actionItem.create({ data: { afi: "Legal was briefed late", correctiveAction: "Add legal to the call tree", ...data }, select: { id: true } });
  const mine = await item({ exerciseId: ex.id, aarId: aar.id, poc: "Rhea Reader", pocEmail: reader.email.toUpperCase() });
  const loose = await item({ pocEmail: reader.email });
  const rejected = await item({ exerciseId: ex.id, pocEmail: reader.email, status: "rejected", rejectedReason: "Out of scope" });
  const theirs = await item({ exerciseId: ex.id, aarId: aar.id, pocEmail: other.email });
  return { admin, director, contributor, reader, other, ex, mine: mine.id, loose: loose.id, rejected: rejected.id, theirs: theirs.id };
}

describe("work item ownership rules", () => {
  it("matches the POC email without case and never an empty email", () => {
    expect(ownsItem({ email: "Rhea@Example.test" }, { pocEmail: " rhea@example.test " })).toBe(true);
    expect(ownsItem({ email: "rhea@example.test" }, { pocEmail: "otto@example.test" })).toBe(false);
    expect(ownsItem({ email: "" }, { pocEmail: "" })).toBe(false);
    expect(ownsItem({ email: "rhea@example.test" }, { pocEmail: null })).toBe(false);
  });

  it("allows status and closure evidence only", () => {
    expect(() => assertOwnerUpdate({ status: "in_progress" }, { status: "open" })).not.toThrow();
    expect(() => assertOwnerUpdate({ status: "done", closureEvidence: "Plan v3 approved" }, { status: "open" })).not.toThrow();
    expect(() => assertOwnerUpdate({ pocEmail: "x@example.test" }, { status: "open" })).toThrow(/own work items/);
    expect(() => assertOwnerUpdate({ status: "rejected", rejectedReason: "No" }, { status: "open" })).toThrow();
    expect(() => assertOwnerUpdate({ status: "open" }, { status: "rejected" })).toThrow(/rejected/);
  });
});

describe.skipIf(!hasTestDb)("work items for their owner (integration)", () => {
  beforeEach(async () => {
    await truncate("Exercise", "User", "AuditEvent", "ActionItem");
  });
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 100));
    await db.$disconnect();
  });

  it("a reader lists their own items only", async () => {
    const f = await setup();
    as(f.reader);
    expect(await list("?status=all")).toEqual({ status: 200, ids: [f.mine, f.loose, f.rejected].sort() });
    expect(await list("?status=open")).toEqual({ status: 200, ids: [f.mine, f.loose].sort() });
    expect(await list(`?status=all&mine=1&exerciseId=${f.ex.id}`)).toEqual({ status: 200, ids: [f.mine, f.rejected].sort() });
    // The exercise's whole plan stays with its control team.
    expect((await list(`?exerciseId=${f.ex.id}`)).status).toBe(403);
    as(f.other);
    expect(await list("?status=all")).toEqual({ status: 200, ids: [f.theirs] });
  });

  it("a reader changes status and closure evidence of their own item, nothing else", async () => {
    const f = await setup();
    as(f.reader);
    expect(await patch(f.mine, { status: "in_progress" })).toBe(200);
    expect(await patch(f.mine, { closureEvidence: "Draft call tree sent to legal." })).toBe(200);
    expect(await patch(f.mine, { status: "done" })).toBe(200);
    const row = await db.actionItem.findUniqueOrThrow({ where: { id: f.mine } });
    expect(row).toMatchObject({ status: "done", closureEvidence: "Draft call tree sent to legal." });
    expect(await patch(f.loose, { status: "done" })).toBe(400);
    expect(await patch(f.loose, { status: "done", closureEvidence: "Done." })).toBe(200);

    // No reassigning, no other fields, no rejecting, no reopening a rejection.
    expect(await patch(f.loose, { pocEmail: f.other.email })).toBe(403);
    expect(await patch(f.loose, { poc: "Someone else" })).toBe(403);
    expect(await patch(f.loose, { status: "rejected", rejectedReason: "Not mine" })).toBe(403);
    expect(await patch(f.rejected, { status: "open" })).toBe(409);
    // Someone else's item.
    expect(await patch(f.theirs, { status: "in_progress" })).toBe(403);
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: f.theirs } })).status).toBe("open");
    // No new items.
    const create = await createRoute(
      new Request("http://localhost/api/action-items", { method: "POST", body: JSON.stringify({ afi: "Gap", correctiveAction: "Fix", pocEmail: f.reader.email }), headers: { "content-type": "application/json" } }),
    );
    expect(create.status).toBe(403);
    expect(await db.actionItem.count()).toBe(4);
  });

  it("contributors, directors and administrators keep the whole plan", async () => {
    const f = await setup();
    const all = [f.mine, f.loose, f.rejected, f.theirs].sort();
    for (const u of [f.contributor, f.director, f.admin]) {
      as(u);
      expect(await list("?status=all"), u.name).toEqual({ status: 200, ids: all });
      expect(await patch(f.theirs, { status: "in_progress" }), u.name).toBe(200);
      // Reassigning an item that is not locked by a final report.
      expect(await patch(f.loose, { pocEmail: f.other.email }), u.name).toBe(200);
      expect(await patch(f.loose, { pocEmail: f.reader.email }), u.name).toBe(200);
    }
    // Program users can still ask for their own items.
    as(f.contributor);
    expect(await list("?status=all&mine=1")).toEqual({ status: 200, ids: [] });
  });
});
