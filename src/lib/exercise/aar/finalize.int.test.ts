// After-action reports against Postgres (TEST_DATABASE_URL): finalize rules, two-party signing,
// lock after final, amendment, signed document contents, evidence bundle,
// participant feedback scoping, hotwash and ratings permissions.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { createTestUser, hasTestDb, setTestSettings, truncate } from "@/test/exercise-db";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { getSessionUser } from "@/lib/exercise/auth/session";
import { resolvePrincipal } from "@/lib/exercise/auth/guest";
import { canonicalize } from "./canonical";
import { sha256Hex, verifyEnvelope } from "./sign";
import { keyIdFor, type LoadedSigningKey } from "./keys";
import { amendAar, setReviewStatus, signAar, signoffState, type SignInput } from "./finalize";
import { editSection, refreshFromRecord, setAarStatus } from "./service";
import { readStoredFile } from "@/lib/exercise/files";
import { APPROVAL_STATEMENT } from "./schema";
import { POST as hotwashItemPost } from "@/app/api/exercises/[id]/hotwash/route";
import { addNoDeviceAttendee, setAttendance } from "@/lib/exercise/participants";
import { gatherAarInputs } from "./inputs";
import { buildSignedDocument, parseStoredEnvelope } from "./document";
import { buildEvidenceBundle } from "./bundle";
import { verifyBundle } from "./verify";
import { renderAarPdf } from "./pdf";
import { renderAarDocx } from "./docx";
import { fixtureSections } from "./test-fixture";
import { createActionItem, updateActionItem } from "@/lib/exercise/improvement/service";
import { resolveAfi } from "@/lib/exercise/improvement/afis";
import { carryAfiToNextExercise } from "@/lib/exercise/improvement/carry";
import { getPolicy } from "@/lib/exercise/program/policy";
import { buildProgramReport } from "@/lib/exercise/program/report";
import { ServiceError } from "@/lib/exercise/errors";
import { PUT as feedbackPut, GET as feedbackGet } from "@/app/api/play/[id]/feedback/route";
import { POST as hotwashPost } from "@/app/api/exercises/[id]/hotwash/route";
import { POST as ratingsPost } from "@/app/api/exercises/[id]/ratings/route";

vi.mock("@/lib/exercise/auth/session", () => ({ getSessionUser: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/exercise/auth/guest", async (orig) => ({ ...(await orig<typeof import("@/lib/exercise/auth/guest")>()), resolvePrincipal: vi.fn() }));

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const KEY: LoadedSigningKey = {
  keyId: keyIdFor(publicKey),
  privateKey,
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
};

async function makeUser(name: string, role: "admin" | "facilitator" | "member" = "facilitator"): Promise<SessionUser> {
  return createTestUser({ email: `u${Math.random().toString(36).slice(2)}@example.test`, name, role });
}

interface Fixture {
  exerciseId: string;
  aarId: string;
  owner: SessionUser;
  objectiveId: string;
}

/** Sign with the body hash the sign-off panel shows, unless the test passes its own. */
async function signNow(input: Omit<SignInput, "bodyHash"> & { bodyHash?: string }, a: { userId: string; accountRole: string; name: string }, opts: { now?: Date; key?: LoadedSigningKey } = {}) {
  const bodyHash = input.bodyHash ?? (await signoffState(input.aarId)).bodyHash ?? "0".repeat(64);
  return signAar({ ...input, bodyHash }, a, opts);
}

async function setupExercise(opts: { isPractice?: boolean; status?: string; aarStatus?: string; noMeeting?: boolean; noRating?: boolean } = {}): Promise<Fixture> {
  const owner = await makeUser("Fran Facilitator");
  const ex = await db.exercise.create({
    data: {
      mode: "crisissim",
      title: "Fixture ransomware drill",
      status: opts.status ?? "ended",
      isPractice: opts.isPractice ?? false,
      startedAt: new Date("2026-03-04T14:00:00Z"),
      endedAt: new Date("2026-03-04T16:00:00Z"),
      createdById: owner.id,
      objectives: { create: [{ seq: 1, text: "Decide on containment within the first hour." }] },
    },
    include: { objectives: true },
  });
  const objectiveId = ex.objectives[0].id;
  await db.participant.create({ data: { exerciseId: ex.id, userId: owner.id, displayName: owner.name, roles: ["lead_facilitator"], joinedAt: new Date(), attendance: "attended" } });
  // The fixture's evaluator rating exists in the record too.
  if (!opts.noRating) {
    await db.capabilityRating.create({ data: { exerciseId: ex.id, objectiveId, rating: "S", source: "evaluator", rationale: "Containment started within 40 minutes.", byUserId: owner.id } });
  }
  const aar = await db.afterActionReport.create({
    data: {
      exerciseId: ex.id,
      status: opts.aarStatus ?? "draft",
      sections: fixtureSections([{ id: objectiveId, text: "Decide on containment within the first hour." }]) as unknown as Prisma.InputJsonValue,
      ...(opts.noMeeting
        ? {}
        : { aamAt: new Date("2026-03-06T15:00:00Z"), aamAttendees: "Exercise director, General counsel, IT lead", ipAgreedAt: new Date("2026-03-06T16:00:00Z") }),
    },
  });
  return { exerciseId: ex.id, aarId: aar.id, owner, objectiveId };
}

const actor = (u: SessionUser) => ({ userId: u.id, accountRole: u.role, name: u.name });

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

async function resolveAll(f: Fixture, by: SessionUser) {
  await createActionItem(
    { aarId: f.aarId, afiId: "afi1a", afi: "Legal was briefed late", correctiveAction: "Add legal to the first call tree.", poete: "planning", priority: "high", poc: "IR manager" },
    by.id,
  );
  await resolveAfi(f.aarId, "afi1b", { rejectedReason: "Covered by the backup program." }, by.id);
}

function jsonReq(url: string, method: string, body: unknown): Request {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe.skipIf(!hasTestDb)("after-action finalize and sign", () => {
  const savedKey = process.env.EXPORT_SIGNING_PRIVATE_KEY;
  beforeAll(async () => {
    await truncate("Exercise", "ExerciseTemplate", "User", "Job", "AuditEvent", "ActionItem", "SigningKey");
    await setTestSettings({ requireSponsorSignoff: true, enabledFrameworks: ["pci-dss", "nist-csf"], policy: {} });
    process.env.EXPORT_SIGNING_PRIVATE_KEY = KEY.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  });
  afterAll(async () => {
    if (savedKey === undefined) delete process.env.EXPORT_SIGNING_PRIVATE_KEY;
    else process.env.EXPORT_SIGNING_PRIVATE_KEY = savedKey;
    await setTestSettings({ requireSponsorSignoff: true, enabledFrameworks: [], policy: {} });
  });
  beforeEach(() => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(resolvePrincipal).mockResolvedValue(null);
  });

  it("refuses to sign a draft, an unresolved AFI, and a practice exercise", async () => {
    const f = await setupExercise();
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409, /review first/);
    await setReviewStatus(f.aarId, "review");
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409, /areas for improvement/);
    const state = await signoffState(f.aarId);
    expect(state.unresolvedAfis.map((a) => a.id).sort()).toEqual(["afi1a", "afi1b"]);

    const p = await setupExercise({ isPractice: true, aarStatus: "review" });
    await expectStatus(signNow({ aarId: p.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(p.owner), { key: KEY }), 409, /Practice/);
    await expectStatus(createActionItem({ aarId: p.aarId, afi: "x", correctiveAction: "y" }, p.owner.id), 409, /Practice/);
    await expectStatus(setReviewStatus(p.aarId, "draft"), 409, /Practice/);
  });

  it("signs facilitator then sponsor, locks, verifies, and amends", async () => {
    const f = await setupExercise();
    await setReviewStatus(f.aarId, "review");
    await resolveAll(f, f.owner);
    expect((await signoffState(f.aarId)).problems).toEqual([]);

    // Sponsor cannot go first.
    const sponsor = await makeUser("Sam Sponsor", "member");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: sponsor.id, displayName: sponsor.name, roles: ["observer"], attendance: "attended" } });
    // A player cannot sign as sponsor; an observer account needs to be the designated sponsor.
    const playerUser = await makeUser("Pia Player", "member");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: playerUser.id, displayName: playerUser.name, roles: ["player"], attendance: "attended" } });
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Sam Sponsor", title: "COO", onBehalf: false }, actor(sponsor), { key: KEY }), 409, /facilitator signs first/);

    // A player or observer cannot sign as facilitator.
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Sam Sponsor", title: "COO", onBehalf: false }, actor(sponsor), { key: KEY }), 403);

    const r1 = await signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Exercise director", onBehalf: false }, actor(f.owner), {
      key: KEY,
      now: new Date("2026-03-08T12:00:00Z"),
    });
    expect(r1.final).toBe(false);
    expect((await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId } })).status).toBe("review");
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Pia Player", title: "COO", onBehalf: false }, actor(playerUser), { key: KEY }), 403, /Players cannot sign/);
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Sam Sponsor", title: "COO", onBehalf: false }, actor(sponsor), { key: KEY }), 403);
    await db.exercise.update({ where: { id: f.exerciseId }, data: { plan: { sponsorUserId: sponsor.id } } });
    // A stale body hash (the report the signer saw) is refused.
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Sam Sponsor", title: "COO", onBehalf: false, bodyHash: "a".repeat(64) }, actor(sponsor), { key: KEY }), 409, /changed since you opened/);

    // Same person cannot countersign; facilitator cannot sign twice.
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409, /different person/);
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409, /already recorded/);

    const r2 = await signNow({ aarId: f.aarId, role: "sponsor", name: "Sam Sponsor", title: "Chief Operating Officer", onBehalf: false }, actor(sponsor), {
      key: KEY,
      now: new Date("2026-03-09T12:00:00Z"),
    });
    expect(r2.final).toBe(true);

    const aar = await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId }, include: { signatures: true } });
    expect(aar.status).toBe("final");
    expect(aar.finalizedAt).not.toBeNull();
    const env = parseStoredEnvelope(aar.canonical)!;
    expect(env).not.toBeNull();
    expect(aar.contentHash).toBe(sha256Hex(canonicalize(env.document)));
    expect(verifyEnvelope(env, KEY.publicKeyPem)).toEqual({ ok: true });
    expect(env.document.actionItems).toHaveLength(1);
    expect(env.document.actionItems[0]).toMatchObject({ afiId: "afi1a", correctiveAction: "Add legal to the first call tree.", priority: "high", poc: "IR manager" });
    expect(env.document.signers.map((s) => [s.role, s.name, s.title])).toEqual([
      ["facilitator", "Fran Facilitator", "Exercise director"],
      ["sponsor", "Sam Sponsor", "Chief Operating Officer"],
    ]);
    // Every signer approved the statement, and the signing account is recorded next to the typed name.
    expect(env.document.signers.map((s) => [s.approval, s.accountName])).toEqual([
      [APPROVAL_STATEMENT, "Fran Facilitator"],
      [APPROVAL_STATEMENT, "Sam Sponsor"],
    ]);
    expect(env.document.aar.meeting).toMatchObject({ attendees: "Exercise director, General counsel, IT lead" });
    expect(env.document.aar.provenance?.length).toBeGreaterThan(0);
    // The final PDF is stored once and served as the same bytes in the bundle.
    const stored = await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId }, select: { finalPdfFileId: true } });
    expect(stored.finalPdfFileId).not.toBeNull();
    const pdfFile = (await readStoredFile(stored.finalPdfFileId!))!;
    expect(pdfFile.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(env.document.aar.sections.roster.length).toBeGreaterThan(0);
    expect(env.document.aar.sections.decisionLog.length).toBeGreaterThan(0);
    expect(env.document.aar.sections.analysis[0].afis[0].evidence[0].quote).toBe("Has anyone told legal yet?");
    expect(env.document.aar.sections.analysis[0].afis[1].rejectedReason).toBe("Covered by the backup program.");
    expect(aar.signatures.find((s) => s.role === "sponsor")!.signature).toBe(env.signature);
    expect(await db.signingKey.findUnique({ where: { keyId: KEY.keyId } })).not.toBeNull();

    // Locked: sections and plan edits refuse; status tracking still works and does not change the snapshot.
    const item = await db.actionItem.findFirstOrThrow({ where: { aarId: f.aarId } });
    await expectStatus(resolveAfi(f.aarId, "afi1b", { reopen: true }, f.owner.id), 409, /final/);
    await expectStatus(createActionItem({ aarId: f.aarId, afi: "x", correctiveAction: "y" }, f.owner.id), 409, /final/);
    await expectStatus(updateActionItem(item.id, { correctiveAction: "Changed" }), 409, /final/);
    await updateActionItem(item.id, { status: "done", closureEvidence: "Call tree v2 published." });
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("done");
    const snap = await buildSignedDocument(f.aarId);
    expect(snap.actionItems[0].status).toBe("open");
    await expectStatus(setReviewStatus(f.aarId, "draft"), 409, /final/);

    // Evidence bundle verifies.
    const { zip } = await buildEvidenceBundle(f.aarId, { pdf: renderAarPdf, docx: renderAarDocx });
    const v = await verifyBundle(zip);
    expect(v.reasons).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.contentHash).toBe(aar.contentHash);
    const JSZip = (await import("jszip")).default;
    const bundlePdf = await (await JSZip.loadAsync(zip)).file("aar.pdf")!.async("nodebuffer");
    expect(sha256Hex(bundlePdf)).toBe(pdfFile.file.sha256);

    // Ratings and hotwash lock once the report is final.
    vi.mocked(getSessionUser).mockResolvedValue(f.owner);
    const ctx = { params: Promise.resolve({ id: f.exerciseId }) };
    const rateRes = await ratingsPost(jsonReq(`http://x/api/exercises/${f.exerciseId}/ratings`, "POST", { objectiveId: f.objectiveId, rating: "P", rationale: "Later view." }), ctx);
    expect(rateRes.status).toBe(409);
    const hotRes = await hotwashItemPost(jsonReq(`http://x/api/exercises/${f.exerciseId}/hotwash`, "POST", { kind: "strength", text: "Late note." }), ctx);
    expect(hotRes.status).toBe(409);
    vi.mocked(getSessionUser).mockResolvedValue(null);

    // Amend creates v2 in draft with the same sections, no signatures, and the plan rows.
    await expectStatus(amendAar(f.aarId, " "), 400, /why/);
    const v2 = await amendAar(f.aarId, "Correct the work item due date.");
    expect(v2.version).toBe(2);
    const v2doc = await buildSignedDocument(v2.id);
    expect(v2doc.aar.previousVersion).toEqual({ id: f.aarId, version: 1, contentHash: aar.contentHash, reason: "Correct the work item due date." });
    const row2 = await db.afterActionReport.findUniqueOrThrow({ where: { id: v2.id }, include: { signatures: true } });
    expect(row2.status).toBe("draft");
    expect(row2.previousId).toBe(f.aarId);
    expect(row2.signatures).toHaveLength(0);
    expect(row2.sections).toEqual(aar.sections);
    expect(await db.actionItem.count({ where: { aarId: v2.id } })).toBe(1);
    await expectStatus(amendAar(f.aarId, "Another amendment."), 409);
    // The old final version still exports its signed bundle.
    expect((await verifyBundle((await buildEvidenceBundle(f.aarId, { pdf: renderAarPdf, docx: renderAarDocx })).zip)).ok).toBe(true);
  }, 120_000);

  it("lets a facilitator enter the sponsor only when the sponsor has no account", async () => {
    const f = await setupExercise();
    await setReviewStatus(f.aarId, "review");
    await resolveAll(f, f.owner);
    await signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Exercise director", onBehalf: false }, actor(f.owner), { key: KEY });
    await makeUser("Pat Account", "member");
    // The facilitator who signed cannot also enter the sponsor's signature.
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Robin Offline", title: "CFO", onBehalf: true }, actor(f.owner), { key: KEY }), 409, /signed as facilitator/);
    const ctl = await makeUser("Cal Controller", "facilitator");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: ctl.id, displayName: ctl.name, roles: ["controller"], attendance: "attended" } });
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "pat account", title: "CFO", onBehalf: true }, actor(ctl), { key: KEY }), 409, /has an account/);
    const res = await signNow({ aarId: f.aarId, role: "sponsor", name: "Robin Offline", title: "CFO", onBehalf: true }, actor(ctl), { key: KEY });
    expect(res.final).toBe(true);
    const env = parseStoredEnvelope((await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId } })).canonical)!;
    const sp = env.document.signers.find((s) => s.role === "sponsor")!;
    expect(sp.userId).toBeNull();
    expect(sp.accountName).toBeNull();
    expect(sp.enteredBy).toEqual({ userId: ctl.id, name: ctl.name });
    expect((await signoffState(f.aarId)).signatures.find((s) => s.role === "sponsor")?.enteredBy?.userId).toBe(ctl.id);
  });

  it("asks the facilitator to sign again when the report changed", async () => {
    const f = await setupExercise();
    await setReviewStatus(f.aarId, "review");
    await resolveAll(f, f.owner);
    await signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Exercise director", onBehalf: false }, actor(f.owner), { key: KEY });
    const item = await db.actionItem.findFirstOrThrow({ where: { aarId: f.aarId } });
    await updateActionItem(item.id, { dueDate: new Date("2027-01-01T00:00:00Z") });
    const ctl = await makeUser("Cal Controller", "facilitator");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: ctl.id, displayName: ctl.name, roles: ["controller"], attendance: "attended" } });
    await expectStatus(signNow({ aarId: f.aarId, role: "sponsor", name: "Robin Offline", title: "CFO", onBehalf: true }, actor(ctl), { key: KEY }), 409, /sign again/);
    expect(await db.aarSignature.count({ where: { aarId: f.aarId } })).toBe(0);
  });

  it("needs attendance confirmed for every participant before signing", async () => {
    const f = await setupExercise();
    await setReviewStatus(f.aarId, "review");
    await resolveAll(f, f.owner);
    const guest = await db.participant.create({ data: { exerciseId: f.exerciseId, displayName: "Gil Guest", isGuest: true, roles: ["player"], joinedAt: new Date() } });
    expect((await signoffState(f.aarId)).problems).toEqual(["One participant has no confirmed attendance. Confirm it on the roster."]);
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409, /attendance/);
    // Attendance is frozen in review like the rest of the report.
    await expectStatus(setAttendance(f.exerciseId, guest.id, "absent"), 409, /in review/);
    await setReviewStatus(f.aarId, "draft");
    await setAttendance(f.exerciseId, guest.id, "absent");
    await setReviewStatus(f.aarId, "review");
    expect((await signoffState(f.aarId)).problems).toEqual([]);
  });

  it("finalizes on the facilitator alone when sponsor sign-off is off", async () => {
    await setTestSettings({ requireSponsorSignoff: false });
    try {
      const f = await setupExercise();
      await setReviewStatus(f.aarId, "review");
      await resolveAll(f, f.owner);
      const r = await signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY });
      expect(r.final).toBe(true);
    } finally {
      await setTestSettings({ requireSponsorSignoff: true });
    }
  });

  it("refuses unrated objectives, incomplete AFIs, an empty summary and a missing meeting record", async () => {
    // No evaluator rating in the record: the objective is not signable.
    const f = await setupExercise({ noRating: true, noMeeting: true });
    const sec = fixtureSections([{ id: f.objectiveId, text: "Decide on containment within the first hour." }]);
    sec.analysis[0] = { ...sec.analysis[0], rating: null, ratingSource: null };
    sec.analysis[0].afis[0].recommendation = "";
    sec.executiveSummary = "";
    await db.afterActionReport.update({ where: { id: f.aarId }, data: { sections: sec as unknown as Prisma.InputJsonValue } });
    await resolveAll(f, f.owner);
    await setReviewStatus(f.aarId, "review");
    const problems = (await signoffState(f.aarId)).problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/no evaluator rating/),
        expect.stringMatching(/no observation, analysis or recommendation/),
        expect.stringMatching(/executive summary/),
        expect.stringMatching(/after-action meeting/),
      ]),
    );
    await expectStatus(signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY }), 409);

    // Fix it in draft: "Not evaluated" with a reason counts; the rejected AFI no longer needs fields.
    await setAarStatus(f.exerciseId, "draft");
    vi.mocked(getSessionUser).mockResolvedValue(f.owner);
    const ctx = { params: Promise.resolve({ id: f.exerciseId }) };
    const noReason = await ratingsPost(jsonReq("http://x/r", "POST", { objectiveId: f.objectiveId, rating: "not_evaluated", rationale: "" }), ctx);
    expect(noReason.status).toBe(400);
    const ne = await ratingsPost(jsonReq("http://x/r", "POST", { objectiveId: f.objectiveId, rating: "not_evaluated", rationale: "No inject tested containment." }), ctx);
    expect(ne.status).toBe(201);
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const row = await db.afterActionReport.findUniqueOrThrow({ where: { id: f.aarId } });
    const synced = row.sections as unknown as typeof sec;
    expect(synced.analysis[0]).toMatchObject({ rating: null, ratingSource: "evaluator", notEvaluated: true, ratingRationale: "No inject tested containment." });
    await editSection(f.exerciseId, { section: "executiveSummary", value: "Containment was not tested. Notification was late." }, f.owner.id);
    await editSection(f.exerciseId, { section: "analysis", path: "0.afis.0.recommendation", value: "Add legal to the first call tree." }, f.owner.id);
    await db.afterActionReport.update({ where: { id: f.aarId }, data: { aamAt: new Date(), aamAttendees: "Exercise director", ipAgreedAt: new Date() } });
    await setReviewStatus(f.aarId, "review");
    expect((await signoffState(f.aarId)).problems).toEqual([]);
  });

  it("freezes the report in review and clears signatures on the way back to draft", async () => {
    const f = await setupExercise();
    await resolveAll(f, f.owner);
    // Ratings cannot be hand-edited through sections.
    await expectStatus(editSection(f.exerciseId, { section: "analysis", path: "0.rating", value: "P" }, f.owner.id), 400, /ratings page/);
    await expectStatus(editSection(f.exerciseId, { section: "analysis", path: "0.ratingSource", value: null }, f.owner.id), 400, /ratings page/);
    await setAarStatus(f.exerciseId, "review");
    await expectStatus(editSection(f.exerciseId, { section: "executiveSummary", value: "Changed in review." }, f.owner.id), 409, /in review/);
    await expectStatus(refreshFromRecord(f.exerciseId, {}), 409, /in review/);
    // Ratings are frozen too.
    vi.mocked(getSessionUser).mockResolvedValue(f.owner);
    const r = await ratingsPost(jsonReq("http://x/r", "POST", { objectiveId: f.objectiveId, rating: "P", rationale: "x" }), { params: Promise.resolve({ id: f.exerciseId }) });
    expect(r.status).toBe(409);
    vi.mocked(getSessionUser).mockResolvedValue(null);

    await signNow({ aarId: f.aarId, role: "facilitator", name: "Fran Facilitator", title: "Director", onBehalf: false }, actor(f.owner), { key: KEY });
    expect(await db.aarSignature.count({ where: { aarId: f.aarId } })).toBe(1);
    const back = await setAarStatus(f.exerciseId, "draft");
    expect(back.clearedSignatures).toBe(1);
    expect(await db.aarSignature.count({ where: { aarId: f.aarId } })).toBe(0);
  });

  it("counts only confirmed attendance for required roles and adds no-device attendees after ENDEX", async () => {
    const f = await setupExercise();
    await setTestSettings({ policy: { requiredRoles: ["Legal", "Communications"] } });
    try {
      const legal = await db.participant.create({ data: { exerciseId: f.exerciseId, displayName: "Lee Legal", title: "Legal counsel", isGuest: true, roles: ["player"], joinedAt: new Date() } });
      let inputs = await gatherAarInputs(f.exerciseId);
      expect(inputs.requiredRoles).toEqual([
        { role: "Legal", present: false },
        { role: "Communications", present: false },
      ]);
      await setAttendance(f.exerciseId, legal.id, "partial");
      const comms = await addNoDeviceAttendee(f.exerciseId, { displayName: "Cam Comms", title: "Communications director", organization: "Corp Comms", roles: ["player"], attendance: "attended" });
      inputs = await gatherAarInputs(f.exerciseId);
      expect(inputs.requiredRoles).toEqual([
        { role: "Legal", present: true },
        { role: "Communications", present: true },
      ]);
      const row = await db.participant.findUniqueOrThrow({ where: { id: comms.participantId } });
      expect(row).toMatchObject({ userId: null, isGuest: false, noDevice: true, attendance: "attended" });
      expect(await db.guestSession.count({ where: { participantId: comms.participantId } })).toBe(0);
      await setAttendance(f.exerciseId, legal.id, "absent");
      inputs = await gatherAarInputs(f.exerciseId);
      expect(inputs.requiredRoles[0]).toEqual({ role: "Legal", present: false });
      // Not before ENDEX.
      const live = await setupExercise({ status: "live" });
      await expectStatus(addNoDeviceAttendee(live.exerciseId, { displayName: "X", roles: ["player"], attendance: "attended" }), 409, /after ENDEX/);
    } finally {
      await setTestSettings({ policy: {} });
    }
  });

  it("counts plan requirements as tested in final reports for cadence", async () => {
    const f = await setupExercise();
    const sec = fixtureSections([{ id: f.objectiveId, text: "Decide on containment within the first hour." }]);
    sec.controlMapping = [];
    sec.overview.requirements = [{ framework: "pci-dss", controlId: "12.10.2", title: "Test the IR plan" }];
    await db.exercise.update({ where: { id: f.exerciseId }, data: { endedAt: new Date("2026-08-01T16:00:00Z") } });
    await db.afterActionReport.update({ where: { id: f.aarId }, data: { status: "final", sections: sec as unknown as Prisma.InputJsonValue } });
    const report = await buildProgramReport({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z") }, new Date("2026-10-20T00:00:00Z"));
    const pci = report.cadence.find((c) => c.framework === "pci-dss" && c.controlId === "12.10.2");
    expect(pci?.lastTested?.slice(0, 10)).toBe("2026-08-01");
    expect(report.controls.find((c) => c.controlId === "12.10.2")?.result).toBe("tested");
    expect(report.signingKeys.map((k) => k.keyId)).toContain(KEY.keyId);
    // Keep later cadence checks independent of this exercise.
    await db.exercise.update({ where: { id: f.exerciseId }, data: { isPractice: true } });
  });

  it("carries an AFI to the next exercise and reports cadence from final AARs", async () => {
    const f = await setupExercise();
    const s = await carryAfiToNextExercise(f.aarId, "afi1b");
    expect((await getPolicy()).suggestedObjectives.map((x) => x.id)).toContain(s.id);
    // Idempotent.
    expect((await carryAfiToNextExercise(f.aarId, "afi1b")).id).toBe(s.id);
    const report = await buildProgramReport({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T23:59:59Z") }, new Date("2026-10-20T00:00:00Z"));
    const pci = report.cadence.find((c) => c.framework === "pci-dss" && c.controlId === "12.10.2");
    expect(pci?.lastTested?.slice(0, 10)).toBe("2026-03-04");
    expect(pci?.sentence).toBe("PCI DSS v4.0 12.10.2 last tested 2026-03-04, due 2027-03-04");
    expect(report.exercises.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasTestDb)("feedback and hotwash access", () => {
  beforeEach(() => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    vi.mocked(resolvePrincipal).mockResolvedValue(null);
  });

  async function guestIn(exerciseId: string, name: string) {
    const p = await db.participant.create({ data: { exerciseId, displayName: name, isGuest: true, roles: ["player"], joinedAt: new Date() } });
    return { participantId: p.id, principal: { kind: "guest" as const, exerciseId, participantId: p.id } };
  }

  const form = { overall: 5, realism: 4, relevance: 4, roleClarity: 3, strengths: "Clear injects", improvements: "", comments: "" };

  it("keeps one feedback row per participant and scopes guests to their exercise", async () => {
    const f = await setupExercise();
    const g = await guestIn(f.exerciseId, "Guest One");
    vi.mocked(resolvePrincipal).mockResolvedValue(g.principal);
    const ctx = { params: Promise.resolve({ id: f.exerciseId }) };
    const r1 = await feedbackPut(jsonReq(`http://x/api/play/${f.exerciseId}/feedback`, "PUT", form), ctx);
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { created: boolean }).created).toBe(true);
    const r2 = await feedbackPut(jsonReq(`http://x/api/play/${f.exerciseId}/feedback`, "PUT", { ...form, overall: 2 }), ctx);
    expect(((await r2.json()) as { created: boolean }).created).toBe(false);
    expect(await db.feedback.count({ where: { exerciseId: f.exerciseId } })).toBe(1);
    const got = (await (await feedbackGet(new Request(`http://x/api/play/${f.exerciseId}/feedback`), ctx)).json()) as { feedback: { overall: number } };
    expect(got.feedback.overall).toBe(2);

    // The same guest cookie cannot reach another exercise.
    const other = await setupExercise();
    const r3 = await feedbackPut(jsonReq(`http://x/api/play/${other.exerciseId}/feedback`, "PUT", form), { params: Promise.resolve({ id: other.exerciseId }) });
    expect(r3.status).toBe(403);

    // Closed once the report is final.
    await db.afterActionReport.update({ where: { id: f.aarId }, data: { status: "final" } });
    const r4 = await feedbackPut(jsonReq(`http://x/api/play/${f.exerciseId}/feedback`, "PUT", form), ctx);
    expect(r4.status).toBe(409);

    // Not before ENDEX.
    const live = await setupExercise({ status: "live" });
    const g2 = await guestIn(live.exerciseId, "Guest Two");
    vi.mocked(resolvePrincipal).mockResolvedValue(g2.principal);
    const r5 = await feedbackPut(jsonReq(`http://x/api/play/${live.exerciseId}/feedback`, "PUT", form), { params: Promise.resolve({ id: live.exerciseId }) });
    expect(r5.status).toBe(409);
  });

  it("gives players 403 on hotwash and ratings, evaluators ratings only, drivers the hotwash", async () => {
    const f = await setupExercise();
    const player = await makeUser("Pia Player", "member");
    const evaluator = await makeUser("Eve Evaluator", "member");
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: player.id, displayName: player.name, roles: ["player"] } });
    await db.participant.create({ data: { exerciseId: f.exerciseId, userId: evaluator.id, displayName: evaluator.name, roles: ["evaluator"] } });
    const ctx = { params: Promise.resolve({ id: f.exerciseId }) };
    const hot = () => jsonReq(`http://x/api/exercises/${f.exerciseId}/hotwash`, "POST", { kind: "strength", objectiveId: f.objectiveId, text: "Fast isolation." });
    const rate = () => jsonReq(`http://x/api/exercises/${f.exerciseId}/ratings`, "POST", { objectiveId: f.objectiveId, rating: "S", rationale: "Some delays." });

    vi.mocked(getSessionUser).mockResolvedValue(player);
    expect((await hotwashPost(hot(), ctx)).status).toBe(403);
    expect((await ratingsPost(rate(), ctx)).status).toBe(403);

    vi.mocked(getSessionUser).mockResolvedValue(evaluator);
    expect((await hotwashPost(hot(), ctx)).status).toBe(403);
    expect((await ratingsPost(rate(), ctx)).status).toBe(201);

    vi.mocked(getSessionUser).mockResolvedValue(f.owner);
    expect((await hotwashPost(hot(), ctx)).status).toBe(201);
    expect((await ratingsPost(rate(), ctx)).status).toBe(201);
    // Two new ratings next to the fixture's evaluator rating.
    expect(await db.capabilityRating.count({ where: { exerciseId: f.exerciseId, source: "evaluator" } })).toBe(3);

    // Guests never reach these routes.
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await hotwashPost(hot(), ctx)).status).toBe(401);
  });
});
