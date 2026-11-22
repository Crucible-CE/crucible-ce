// Findings review against Postgres (TEST_DATABASE_URL): proposals from the
// record at draft time, accept and reject through the route (audited),
// exactly one action item per "Create action item", none for "No action
// needed", finalize blocked while a finding is proposed, the appendix, the
// lock after final, and an amendment that carries every decision.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, setTestSettings, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { audit } from "@/lib/exercise/audit";
import { ServiceError } from "@/lib/exercise/errors";
import { createActionItem } from "@/lib/exercise/improvement/service";
import { applyFindings, resolveAfi } from "@/lib/exercise/improvement/afis";
import { POST as findingsPost } from "@/app/api/exercises/[id]/aar/findings/route";
import { amendAar, signoffState } from "./finalize";
import { collectFindings, createAar } from "./service";
import { readSections } from "./edit";
import { allFindings, appendixRows, reportAfis } from "./findings";
import { buildLiveDocument } from "./document";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/exercise/audit", () => ({ audit: vi.fn(), writeAudit: vi.fn() }));

async function sections(aarId: string) {
  return readSections((await db.afterActionReport.findUniqueOrThrow({ where: { id: aarId } })).sections)!;
}

async function expectStatus(p: Promise<unknown>, status: number, message?: RegExp) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).status).toBe(status);
    if (message) expect((e as ServiceError).message).toMatch(message);
    return;
  }
  throw new Error(`expected a ${status} error`);
}

function post(exerciseId: string, body: unknown) {
  const req = new Request(`http://x/api/exercises/${exerciseId}/aar/findings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return findingsPost(req, { params: Promise.resolve({ id: exerciseId }) });
}

describe.skipIf(!hasTestDb)("findings review", () => {
  let owner: SessionUser;
  let exerciseId: string;
  let objectiveId: string;
  let aarId: string;

  beforeAll(async () => {
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent", "ActionItem");
    await setTestSettings({ requireSponsorSignoff: false, enabledFrameworks: [], policy: {} });
    owner = await createTestUser({ email: `f${Math.random().toString(36).slice(2)}@example.test`, name: "Fran Facilitator", role: "facilitator" });
    const ex = await db.exercise.create({
      data: {
        mode: "crisissim",
        title: "Findings drill",
        status: "ended",
        startedAt: new Date("2026-03-04T14:00:00Z"),
        endedAt: new Date("2026-03-04T16:00:00Z"),
        createdById: owner.id,
        objectives: { create: [{ seq: 1, text: "Decide on containment within the first hour." }] },
      },
      include: { objectives: true },
    });
    exerciseId = ex.id;
    objectiveId = ex.objectives[0].id;
    const lead = await db.participant.create({
      data: { exerciseId, userId: owner.id, displayName: owner.name, roles: ["lead_facilitator"], joinedAt: new Date(), attendance: "attended" },
    });
    const player = await db.participant.create({ data: { exerciseId, displayName: "Dana Lee", title: "General Counsel", roles: ["player"], isGuest: true, joinedAt: new Date(), attendance: "attended" } });
    await db.hotwashItem.create({ data: { exerciseId, kind: "afi", objectiveId, text: "Nobody owned the holding statement.", byParticipantId: lead.id } });
    await db.hotwashItem.create({ data: { exerciseId, kind: "strength", objectiveId, text: "Isolation was fast." } });
    await db.observation.create({ data: { exerciseId, objectiveId, kind: "afi", text: "Legal joined after 90 minutes.", authorParticipantId: lead.id } });
    await db.feedback.create({ data: { exerciseId, participantId: player.id, ratings: { improvements: "Dana Lee wanted a printed call tree." } as Prisma.InputJsonValue } });
    aarId = (await createAar(exerciseId)).aarId;
  });

  afterAll(async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
  });

  it("proposes findings from hotwash, evaluator observations and feedback at draft time, once", async () => {
    const s = await sections(aarId);
    const all = allFindings(s);
    expect(all.map((f) => f.afi.sources[0].kind).sort()).toEqual(["evaluator", "feedback", "hotwash"]);
    expect(all.every((f) => f.afi.status === "proposed")).toBe(true);
    // Feedback has no objective yet. Names became roles.
    const fb = all.find((f) => f.afi.sources[0].kind === "feedback")!;
    expect(fb.objectiveId).toBeNull();
    expect(fb.afi.title).not.toContain("Dana Lee");
    expect((await collectFindings(exerciseId, owner.id)).proposed).toBe(0);
    // Nothing is in the report yet and finalize is blocked.
    expect(reportAfis(s.analysis[0].afis)).toEqual([]);
    expect((await signoffState(aarId)).problems).toContain("3 areas for improvement are still proposed. Accept or reject them on the Findings tab.");
  });

  it("accept and create action item makes exactly one action item; No action needed makes none and needs a reason", async () => {
    const s = await sections(aarId);
    const hot = allFindings(s).find((f) => f.afi.sources[0].kind === "hotwash")!.afi.id;
    const obs = allFindings(s).find((f) => f.afi.sources[0].kind === "evaluator")!.afi.id;

    vi.mocked(getSessionUser).mockResolvedValue(owner);
    expect((await post(exerciseId, { action: "accept", ids: [hot, obs] })).status).toBe(200);
    expect((await post(exerciseId, { action: "no_action", ids: [obs] })).status).toBe(400);
    expect((await post(exerciseId, { action: "no_action", ids: [obs], preset: "already_fixed", reason: "Legal is on the call tree now." })).status).toBe(200);
    vi.mocked(getSessionUser).mockResolvedValue(null);

    await createActionItem({ aarId, afiId: hot, afi: "No holding statement owner", correctiveAction: "Name an owner in the plan.", priority: "high" }, owner.id);
    await expectStatus(createActionItem({ aarId, afiId: hot, afi: "Again", correctiveAction: "Again." }, owner.id), 409, /already has an action/);
    expect(await db.actionItem.count({ where: { exerciseId } })).toBe(1);

    const after = await sections(aarId);
    const h = allFindings(after).find((f) => f.afi.id === hot)!.afi;
    const o = allFindings(after).find((f) => f.afi.id === obs)!.afi;
    expect(h).toMatchObject({ status: "accepted", decision: { kind: "action", byName: "Fran Facilitator" } });
    expect(h.actionItemId).toBeTruthy();
    expect(o).toMatchObject({ status: "accepted", actionItemId: null, decision: { kind: "no_action", preset: "already_fixed" } });

    // Every decision is audited.
    const events = vi.mocked(audit).mock.calls.map(([e]) => e).filter((e) => e.action.startsWith("aar.finding_"));
    expect(events.map((e) => e.action).sort()).toEqual(["aar.finding_accept", "aar.finding_accept", "aar.finding_no_action"]);
    expect(events.every((e) => e.targetId === aarId && e.actorUserId === owner.id)).toBe(true);
    expect(events.find((e) => e.action === "aar.finding_no_action")?.data).toMatchObject({ afiId: obs, preset: "already_fixed" });
  });

  it("reject needs a reason and keeps the finding out of the report but in the appendix", async () => {
    const s = await sections(aarId);
    const fb = allFindings(s).find((f) => f.afi.sources[0].kind === "feedback")!.afi.id;
    vi.mocked(getSessionUser).mockResolvedValue(owner);
    expect((await post(exerciseId, { action: "reject", ids: [fb] })).status).toBe(400);
    expect((await post(exerciseId, { action: "reject", ids: [fb], preset: "out_of_scope" })).status).toBe(200);
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const doc = await buildLiveDocument(aarId);
    const inReport = doc.aar.sections.analysis.flatMap((a) => reportAfis(a.afis)).map((f) => f.id);
    expect(inReport).not.toContain(fb);
    expect(appendixRows(doc.aar.sections)).toEqual([expect.objectContaining({ id: fb, status: "Rejected", reason: "Out of scope.", sources: "Feedback", by: "Fran Facilitator" })]);
    // Nothing is proposed or waiting for follow-up now.
    const problems = (await signoffState(aarId)).problems;
    expect(problems.some((p) => /still proposed|no work item/.test(p))).toBe(false);
  });

  it("locks decisions after final; an amendment carries them", async () => {
    const before = await sections(aarId);
    await db.afterActionReport.update({ where: { id: aarId }, data: { status: "final", finalizedAt: new Date() } });
    const any = allFindings(before)[0].afi.id;
    await expectStatus(applyFindings(aarId, { kind: "reopen", ids: [any] }, owner.id), 409, /final/);
    await expectStatus(resolveAfi(aarId, any, { reopen: true }, owner.id), 409, /final/);

    const v2 = await amendAar(aarId, "Correct a finding.");
    const carried = await sections(v2.id);
    const pick = (x: typeof before) => allFindings(x).map((f) => [f.afi.id, f.afi.status, f.afi.decision?.kind ?? null, f.afi.actionItemId]);
    expect(pick(carried)).toEqual(pick(before));
    // The action item moved with the amendment, so the linked finding stays followed up.
    expect(await db.actionItem.count({ where: { aarId: v2.id } })).toBe(1);
  });
});
