// Finalize, sign and amend after-action reports.
//
// Flow: draft -> review (after-action meeting) -> facilitator signs -> sponsor
// countersigns when ExerciseSettings.requireSponsorSignoff -> final. Only humans sign.
//
// Signature scheme (one envelope, plus per-signer attestations):
//   - Each AarSignature row stores an Ed25519 attestation over
//     canonicalize({aarId, version, role, name, title, signedAt, keyId, bodyHash}),
//     where bodyHash = documentBodyHash(document) (the document without signers
//     and generatedAt). It records exactly what that signer approved. The
//     sponsor step re-checks the facilitator's attestation against the current
//     body; if the report changed in between, the facilitator signs again.
//   - When the last required signature lands, the full document (including
//     every signer entry) is signed once with signDocument(). That envelope is
//     stored as canonical JSON in AfterActionReport.canonical, its contentHash
//     (sha256 of the canonical document) in contentHash, and its signature on
//     the final signer's row. verify.ts and the evidence bundle check this
//     envelope; the attestations are internal records.
//
// After final the version is locked (src/aar/lock.ts). ActionItem status
// updates stay allowed: they are live tracking, not part of the snapshot.
// An amendment is a new version (previousId) in draft with no signatures.

import { sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { managesAllExercises } from "@/lib/exercise/auth/rbac";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { canonicalize } from "./canonical";
import { signDocument } from "./sign";
import { readSigningKey, type LoadedSigningKey } from "./keys";
import { lockAarRow } from "./lock";
import { buildLiveDocument, documentBodyHash, orderSigners, parseStoredEnvelope, signerEntryFor, type SignerEntry, type SignerRole } from "./document";
import { parseSections, unresolvedAfis, type AfiRef } from "@/lib/exercise/improvement/afis";
import { readPlan } from "@/lib/exercise/schemas";
import { APPROVAL_STATEMENT, type AarSections } from "./schema";
import { objectivesWithoutEvaluatorRating } from "./draft";
import { applyRatingsToRow } from "./ratings-sync";
import { ensureFinalPdf } from "./render";

export const signInputSchema = z.object({
  aarId: z.string().min(1).max(40),
  role: z.enum(["facilitator", "sponsor"]),
  name: z.string().trim().min(2, "Type the full name.").max(120, "Use 120 characters or fewer."),
  title: z.string().trim().min(1, "Type the title.").max(200, "Use 200 characters or fewer."),
  /** A facilitator enters the sponsor's signature because the sponsor has no account. */
  onBehalf: z.boolean().optional().default(false),
  /** documentBodyHash of the report the signer was shown. A mismatch is refused (409). */
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/, "Reload the report, then sign."),
});
export type SignInput = z.infer<typeof signInputSchema>;

export interface SignActor {
  userId: string;
  accountRole: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface FinalizeFacts {
  exercise: { status: string; isPractice: boolean };
  aar: { status: string; isLatest: boolean };
  sectionsReadable: boolean;
  /** Findings still proposed: nobody accepted or rejected them. */
  unresolvedAfiCount: number;
  /** Accepted findings with neither a work item nor a "No action needed" reason. */
  acceptedWithoutFollowUp?: number;
  /** Objectives with no evaluator rating and no "Not evaluated" with a reason. */
  unratedObjectives?: number;
  /** Accepted findings with a blank observation, analysis or recommendation. */
  incompleteAfis?: number;
  executiveSummaryEmpty?: boolean;
  /** Which after-action meeting fields are missing. */
  meetingMissing?: Array<"date" | "attendees" | "plan">;
  /** Participants (not removed) whose attendance nobody confirmed. */
  unconfirmedAttendance?: number;
}

/** Content checks for the sections. Pure. */
export function sectionFacts(sections: AarSections | null): Pick<FinalizeFacts, "unratedObjectives" | "incompleteAfis" | "executiveSummaryEmpty"> {
  if (!sections) return { unratedObjectives: 0, incompleteAfis: 0, executiveSummaryEmpty: false };
  return {
    unratedObjectives: objectivesWithoutEvaluatorRating(sections.analysis).length,
    incompleteAfis: sections.analysis
      .flatMap((a) => a.afis)
      .filter((f) => f.status === "accepted" && !f.rejectedReason && (!f.observation.trim() || !f.analysis.trim() || !f.recommendation.trim())).length,
    executiveSummaryEmpty: !sections.executiveSummary.trim(),
  };
}

export function meetingMissing(m: { aamAt: Date | null; aamAttendees: string | null; ipAgreedAt: Date | null }): Array<"date" | "attendees" | "plan"> {
  const out: Array<"date" | "attendees" | "plan"> = [];
  if (!m.aamAt) out.push("date");
  if (!m.aamAttendees?.trim()) out.push("attendees");
  if (!m.ipAgreedAt) out.push("plan");
  return out;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace("{n}", String(n)));

/** Why this AAR cannot be signed now. Empty when it can. Pure. */
export function finalizeProblems(f: FinalizeFacts): string[] {
  const out: string[] = [];
  if (f.exercise.isPractice) out.push("Practice exercises do not get a signed report.");
  if (f.exercise.status === "abandoned") out.push("Abandoned exercises do not get a signed report.");
  else if (f.exercise.status !== "ended") out.push("End the exercise first.");
  if (f.aar.status === "final") out.push("This report is already final.");
  else if (f.aar.status !== "review") out.push("Move the report to review first.");
  if (!f.aar.isLatest) out.push("A newer version of this report exists.");
  if (!f.sectionsReadable) out.push("The report sections could not be read. Fix the draft first.");
  if (f.unresolvedAfiCount > 0) {
    out.push(
      plural(
        f.unresolvedAfiCount,
        "One area for improvement is still proposed. Accept or reject it on the Findings tab.",
        "{n} areas for improvement are still proposed. Accept or reject them on the Findings tab.",
      ),
    );
  }
  if (f.acceptedWithoutFollowUp) {
    out.push(
      plural(
        f.acceptedWithoutFollowUp,
        "One accepted area for improvement has no work item or no action reason.",
        "{n} accepted areas for improvement have no work item or no action reason.",
      ),
    );
  }
  if (f.unratedObjectives) {
    out.push(
      plural(
        f.unratedObjectives,
        "One objective has no evaluator rating. Rate it or mark it not evaluated with a reason.",
        "{n} objectives have no evaluator rating. Rate them or mark them not evaluated with a reason.",
      ),
    );
  }
  if (f.incompleteAfis) {
    out.push(
      plural(
        f.incompleteAfis,
        "One accepted area for improvement has no observation, analysis or recommendation. Complete it.",
        "{n} accepted areas for improvement have no observation, analysis or recommendation. Complete them.",
      ),
    );
  }
  if (f.executiveSummaryEmpty) out.push("Write the executive summary first.");
  if (f.meetingMissing && f.meetingMissing.length) out.push("Record the after-action meeting date, attendees and when the improvement plan was agreed.");
  if (f.unconfirmedAttendance) {
    out.push(
      plural(
        f.unconfirmedAttendance,
        "One participant has no confirmed attendance. Confirm it on the roster.",
        "{n} participants have no confirmed attendance. Confirm them on the roster.",
      ),
    );
  }
  return out;
}

/** Signatures this organization requires, in signing order. */
export function requiredRoles(requireSponsorSignoff: boolean): SignerRole[] {
  return requireSponsorSignoff ? ["facilitator", "sponsor"] : ["facilitator"];
}

/** The next role to sign, or null when complete. Pure. */
export function nextSignerRole(signed: string[], requireSponsorSignoff: boolean): SignerRole | null {
  for (const r of requiredRoles(requireSponsorSignoff)) if (!signed.includes(r)) return r;
  return null;
}

interface LoadedFacts {
  aar: {
    id: string;
    exerciseId: string;
    version: number;
    status: string;
    sections: unknown;
    contentHash: string | null;
    finalizedAt: Date | null;
    canonical: string | null;
    previousId: string | null;
    aamAt: Date | null;
    aamAttendees: string | null;
    ipAgreedAt: Date | null;
    editLog: unknown;
  };
  exercise: { id: string; status: string; isPractice: boolean; createdById: string | null; plan: unknown };
  isLatest: boolean;
  unresolved: AfiRef[];
  sectionsReadable: boolean;
  sections: AarSections | null;
  requireSponsorSignoff: boolean;
  unconfirmedAttendance: number;
}

async function loadFacts(aarId: string, client: DbClient): Promise<LoadedFacts> {
  const aar = await client.afterActionReport.findUnique({
    where: { id: aarId },
    select: {
      id: true,
      exerciseId: true,
      version: true,
      status: true,
      sections: true,
      contentHash: true,
      finalizedAt: true,
      canonical: true,
      previousId: true,
      aamAt: true,
      aamAttendees: true,
      ipAgreedAt: true,
      editLog: true,
      exercise: { select: { id: true, status: true, isPractice: true, createdById: true, plan: true } },
    },
  });
  if (!aar) throw new ServiceError(404, "Report not found.");
  const [newer, items, instance, unconfirmedAttendance] = await Promise.all([
    client.afterActionReport.findFirst({ where: { exerciseId: aar.exerciseId, version: { gt: aar.version } }, select: { id: true } }),
    client.actionItem.findMany({ where: { exerciseId: aar.exerciseId }, select: { id: true, evidence: true } }),
    getExerciseSettings(client),
    client.participant.count({ where: { exerciseId: aar.exerciseId, removedAt: null, attendance: null } }),
  ]);
  const sections = parseSections(aar.sections);
  const { exercise, ...rest } = aar;
  return {
    aar: rest,
    exercise,
    isLatest: !newer,
    sectionsReadable: Boolean(sections),
    sections,
    unresolved: sections ? unresolvedAfis(sections, items) : [],
    requireSponsorSignoff: instance?.requireSponsorSignoff ?? true,
    unconfirmedAttendance,
  };
}

function problemsOf(f: LoadedFacts): string[] {
  return finalizeProblems({
    exercise: f.exercise,
    aar: { status: f.aar.status, isLatest: f.isLatest },
    sectionsReadable: f.sectionsReadable,
    unresolvedAfiCount: f.unresolved.filter((a) => a.status === "proposed").length,
    acceptedWithoutFollowUp: f.unresolved.filter((a) => a.status !== "proposed").length,
    ...sectionFacts(f.sections),
    meetingMissing: meetingMissing(f.aar),
    unconfirmedAttendance: f.unconfirmedAttendance,
  });
}

// ---------------------------------------------------------------------------
// Sign-off state (for the SignoffPanel)
// ---------------------------------------------------------------------------

export interface SignoffState {
  aarId: string;
  exerciseId: string;
  version: number;
  status: string;
  isLatest: boolean;
  isPractice: boolean;
  problems: string[];
  unresolvedAfis: Array<{ id: string; title: string; objectiveText: string; status: string }>;
  required: SignerRole[];
  next: SignerRole | null;
  signatures: Array<{
    role: string;
    name: string;
    title: string | null;
    signedAt: string;
    userId: string | null;
    accountName: string | null;
    keyId: string;
    enteredBy?: { userId: string; name: string };
  }>;
  contentHash: string | null;
  keyId: string | null;
  finalizedAt: string | null;
  previousId: string | null;
  /** documentBodyHash of the report as it stands. The sign request must send it back. */
  bodyHash: string | null;
  /** What every signer approves. */
  approval: string;
  /** overview.sponsor, for the name check in the sign form. */
  overviewSponsor: string;
  timezone: string;
}

export async function signoffState(aarId: string, client: DbClient = db): Promise<SignoffState> {
  const f = await loadFacts(aarId, client);
  const sigs = orderSigners(await client.aarSignature.findMany({ where: { aarId }, include: { user: { select: { name: true } } } }));
  const instance = await getExerciseSettings(client);
  let bodyHash: string | null = null;
  if (f.aar.status !== "final" && f.sectionsReadable) bodyHash = documentBodyHash(await buildLiveDocument(aarId, { client }));
  const signedAccounts = new Map((parseStoredEnvelope(f.aar.canonical)?.document.signers ?? []).map((x) => [x.role, x.accountName ?? null]));
  const env = f.aar.status === "final" ? parseStoredEnvelope(f.aar.canonical) : null;
  const enteredBy = new Map((env?.document.signers ?? []).filter((s) => s.enteredBy).map((s) => [s.role, s.enteredBy!]));
  const problems = f.aar.status === "final" ? [] : problemsOf(f);
  return {
    aarId,
    exerciseId: f.aar.exerciseId,
    version: f.aar.version,
    status: f.aar.status,
    isLatest: f.isLatest,
    isPractice: f.exercise.isPractice,
    problems,
    unresolvedAfis: f.unresolved.map((a) => ({ id: a.id, title: a.title, objectiveText: a.objectiveText, status: a.status })),
    required: requiredRoles(f.requireSponsorSignoff),
    next: f.aar.status === "final" ? null : nextSignerRole(sigs.map((s) => s.role), f.requireSponsorSignoff),
    signatures: sigs.map((s) => ({
      role: s.role,
      name: s.name,
      title: s.title,
      signedAt: s.signedAt.toISOString(),
      userId: s.userId,
      accountName: signedAccounts.get(s.role as SignerRole) ?? (s.userId ? (s.user?.name ?? null) : null),
      keyId: s.keyId,
      ...(enteredBy.get(s.role as SignerRole) ? { enteredBy: enteredBy.get(s.role as SignerRole) } : {}),
    })),
    contentHash: f.aar.contentHash,
    keyId: env?.keyId ?? null,
    finalizedAt: f.aar.finalizedAt?.toISOString() ?? null,
    previousId: f.aar.previousId,
    bodyHash,
    approval: APPROVAL_STATEMENT,
    overviewSponsor: f.sections?.overview.sponsor ?? "",
    timezone: instance?.timezone ?? "UTC",
  };
}

// ---------------------------------------------------------------------------
// Review status
// ---------------------------------------------------------------------------

/**
 * Move between draft and review. Sending to review needs an ended,
 * non-practice exercise and the latest version. Returning to draft clears any
 * signatures.
 */
export async function setReviewStatus(aarId: string, to: "review" | "draft"): Promise<{ from: string; to: string; clearedSignatures: number }> {
  return db.$transaction(async (tx) => {
    await lockAarRow(tx, aarId);
    const f = await loadFacts(aarId, tx);
    if (f.aar.status === "final") throw new ServiceError(409, "This report is final. Amend it to make changes.");
    if (!f.isLatest) throw new ServiceError(409, "A newer version of this report exists.");
    if (f.exercise.isPractice) throw new ServiceError(409, "Practice exercises do not get an after-action report.");
    if (f.exercise.status !== "ended") throw new ServiceError(409, "End the exercise first.");
    if (f.aar.status === to) return { from: to, to, clearedSignatures: 0 };
    let cleared = 0;
    if (to === "draft") cleared = (await tx.aarSignature.deleteMany({ where: { aarId } })).count;
    if (to === "review") {
      // The report signers review carries exactly the evaluator record.
      const row = await tx.afterActionReport.findUnique({ where: { id: aarId }, select: { id: true, sections: true, editLog: true } });
      if (row) await applyRatingsToRow(tx, row, f.aar.exerciseId);
    }
    await tx.afterActionReport.update({ where: { id: aarId }, data: { status: to } });
    return { from: f.aar.status, to, clearedSignatures: cleared };
  });
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function attestationPayload(a: { aarId: string; version: number; role: string; name: string; title: string | null; signedAt: string; keyId: string; bodyHash: string }): Buffer {
  return Buffer.from(canonicalize({ ...a, approval: APPROVAL_STATEMENT }), "utf8");
}

function verifyAttestation(
  sig: { role: string; name: string; title: string | null; signedAt: Date; keyId: string; signature: string },
  aar: { id: string; version: number },
  bodyHash: string,
  publicKeyPem: string,
): boolean {
  try {
    const payload = attestationPayload({
      aarId: aar.id,
      version: aar.version,
      role: sig.role,
      name: sig.name,
      title: sig.title,
      signedAt: sig.signedAt.toISOString(),
      keyId: sig.keyId,
      bodyHash,
    });
    return edVerify(null, payload, createPublicKey({ key: publicKeyPem, format: "pem" }), Buffer.from(sig.signature, "base64"));
  } catch {
    return false;
  }
}

async function canDrive(client: DbClient, exercise: { id: string; createdById: string | null }, actor: SignActor): Promise<boolean> {
  if (managesAllExercises(actor.accountRole) || exercise.createdById === actor.userId) return true;
  const p = await client.participant.findFirst({
    where: { exerciseId: exercise.id, userId: actor.userId, removedAt: null },
    select: { roles: true },
  });
  return Boolean(p?.roles.some((r) => r === "lead_facilitator" || r === "controller"));
}

/**
 * In-person sponsor signature: the designated sponsor account (plan
 * sponsorUserId), or a driver or admin who is not a player in this exercise.
 */
async function canSignAsSponsor(client: DbClient, exercise: { id: string; createdById: string | null; plan: unknown }, actor: SignActor): Promise<boolean> {
  if (readPlan(exercise.plan).sponsorUserId === actor.userId) return true;
  const p = await client.participant.findFirst({ where: { exerciseId: exercise.id, userId: actor.userId, removedAt: null }, select: { roles: true } });
  if (p?.roles.includes("player")) return false;
  return canDrive(client, exercise, actor);
}

export interface SignResult {
  role: SignerRole;
  final: boolean;
  contentHash: string | null;
  keyId: string;
  enteredBy?: { userId: string; name: string };
}

/**
 * Add one signature. Refuses when the rules fail, the order is wrong, or the
 * signer is not allowed. Lands final when the last required signature is in.
 * `key` is injectable for tests; the default is the export signing key.
 */
export async function signAar(input: SignInput, actor: SignActor, opts: { now?: Date; key?: LoadedSigningKey } = {}): Promise<SignResult> {
  const key = opts.key ?? readSigningKey();
  if (!key) throw new ServiceError(503, "No signing key is set up. Set EXPORT_SIGNING_PRIVATE_KEY, then try again.");
  const now = opts.now ?? new Date();

  return db.$transaction(
    async (tx) => {
      await lockAarRow(tx, input.aarId);
      const f = await loadFacts(input.aarId, tx);
      const problems = problemsOf(f);
      if (problems.length) throw new ServiceError(409, problems[0]);

      const existing = orderSigners(await tx.aarSignature.findMany({ where: { aarId: input.aarId }, include: { user: { select: { name: true } } } }));
      const next = nextSignerRole(existing.map((s) => s.role), f.requireSponsorSignoff);
      if (input.role === "sponsor" && !f.requireSponsorSignoff) throw new ServiceError(400, "This organization does not require a sponsor signature.");
      if (existing.some((s) => s.role === input.role)) throw new ServiceError(409, "That signature is already recorded.");
      if (next === null) throw new ServiceError(409, "Every required signature is recorded. Return the report to draft, then sign again.");
      if (next !== input.role) throw new ServiceError(409, "The facilitator signs first.");

      let userId: string | null = actor.userId;
      let enteredBy: { userId: string; name: string } | undefined;
      if (input.role === "facilitator") {
        if (input.onBehalf) throw new ServiceError(400, "The facilitator signs in person.");
        if (!(await canDrive(tx, f.exercise, actor))) {
          throw new ServiceError(403, "Only the lead facilitator, a controller, the exercise owner or an admin can sign as facilitator.");
        }
      } else if (input.onBehalf) {
        if (!(await canDrive(tx, f.exercise, actor))) throw new ServiceError(403, "Only a facilitator can enter the sponsor's signature.");
        const signedAsFacilitator = existing.find((x) => x.role === "facilitator");
        if (signedAsFacilitator?.userId && signedAsFacilitator.userId === actor.userId) {
          throw new ServiceError(409, "You signed as facilitator. Ask another facilitator to enter the sponsor's signature.");
        }
        const hasAccount = await tx.user.findFirst({
          where: { isActive: true, name: { equals: input.name.trim(), mode: "insensitive" } },
          select: { id: true },
        });
        if (hasAccount) throw new ServiceError(409, "The sponsor has an account. Ask the sponsor to sign in and sign.");
        userId = null;
        enteredBy = { userId: actor.userId, name: actor.name };
      } else if (!(await canSignAsSponsor(tx, f.exercise, actor))) {
        throw new ServiceError(403, "Sign as sponsor from the designated sponsor account, a facilitator account or an admin account. Players cannot sign as sponsor.");
      }
      const facilitator = existing.find((s) => s.role === "facilitator");
      if (input.role === "sponsor" && facilitator?.userId && facilitator.userId === actor.userId && !input.onBehalf) {
        throw new ServiceError(409, "The sponsor signature needs a different person.");
      }

      const signedAt = now.toISOString();
      const newEntry: SignerEntry = signerEntryFor(
        { role: input.role, name: input.name.trim(), title: input.title.trim() || null, signedAt: now, userId },
        userId ? actor.name : null,
        enteredBy,
      );
      const signers: SignerEntry[] = [...existing.map((x) => signerEntryFor(x, x.user?.name ?? null)), newEntry];
      const doc = await buildLiveDocument(input.aarId, { client: tx, signers, now });
      const bodyHash = documentBodyHash(doc);
      // The signer approves what was on screen: the hash sent with the request.
      if (bodyHash !== input.bodyHash) {
        throw new ServiceError(409, "The report changed since you opened it. Reload it, review it, then sign.");
      }

      // The facilitator approved a body; make sure it has not changed since.
      if (facilitator) {
        const pem = (await tx.signingKey.findUnique({ where: { keyId: facilitator.keyId }, select: { publicKeyPem: true } }))?.publicKeyPem;
        if (!pem || !verifyAttestation(facilitator, f.aar, bodyHash, pem)) {
          await tx.aarSignature.delete({ where: { id: facilitator.id } });
          // Commit the removal, then report: the caller sees a 409 and the facilitator signs again.
          return { stale: true as const };
        }
      }

      await tx.signingKey.upsert({
        where: { keyId: key.keyId },
        create: { keyId: key.keyId, publicKeyPem: key.publicKeyPem },
        update: {},
      });
      const attestation = edSign(
        null,
        attestationPayload({ aarId: f.aar.id, version: f.aar.version, role: input.role, name: newEntry.name, title: newEntry.title, signedAt, keyId: key.keyId, bodyHash }),
        key.privateKey,
      ).toString("base64");

      const isLast = nextSignerRole([...existing.map((s) => s.role), input.role], f.requireSponsorSignoff) === null;
      if (!isLast) {
        await tx.aarSignature.create({
          data: { aarId: input.aarId, role: input.role, name: newEntry.name, title: newEntry.title, userId, signedAt: now, keyId: key.keyId, signature: attestation },
        });
        return { stale: false as const, result: { role: input.role, final: false, contentHash: null, keyId: key.keyId, enteredBy } };
      }

      const envelope = signDocument(doc, { keyId: key.keyId, privateKey: key.privateKey }, now);
      await tx.aarSignature.create({
        data: { aarId: input.aarId, role: input.role, name: newEntry.name, title: newEntry.title, userId, signedAt: now, keyId: key.keyId, signature: envelope.signature },
      });
      const done = await tx.afterActionReport.updateMany({
        where: { id: input.aarId, status: "review" },
        data: { status: "final", finalizedAt: now, contentHash: envelope.contentHash, canonical: canonicalize(envelope) },
      });
      if (done.count !== 1) throw new ServiceError(409, "The report changed while signing. Reload and try again.");
      return { stale: false as const, result: { role: input.role, final: true, contentHash: envelope.contentHash, keyId: key.keyId, enteredBy } };
    },
    { timeout: 20_000 },
  ).then(async (r) => {
    if (r.stale) throw new ServiceError(409, "The report changed after the facilitator signed. The facilitator needs to sign again.");
    if (r.result.final) {
      // Keep the exact PDF a reader gets. A failure here is retried on first export.
      await ensureFinalPdf(input.aarId).catch((err) => console.error(`[aar] final PDF for ${input.aarId} not stored:`, err));
    }
    return r.result;
  });
}

// ---------------------------------------------------------------------------
// Amend
// ---------------------------------------------------------------------------

/**
 * Start an amendment: a new draft version linked to the final one, with the
 * same sections and no signatures. Improvement plan rows move to the new
 * version; the final version keeps its signed snapshot.
 */
export const amendInputSchema = z.object({
  aarId: z.string().min(1).max(40),
  reason: z.string().trim().min(5, "Say why the report is amended.").max(1000, "Use 1000 characters or fewer."),
});

export async function amendAar(aarId: string, reason: string): Promise<{ id: string; version: number }> {
  const why = reason.trim();
  if (why.length < 5) throw new ServiceError(400, "Say why the report is amended.");
  return db.$transaction(async (tx) => {
    await lockAarRow(tx, aarId);
    const aar = await tx.afterActionReport.findUnique({ where: { id: aarId } });
    if (!aar) throw new ServiceError(404, "Report not found.");
    if (aar.status !== "final") throw new ServiceError(409, "Only a final report can be amended.");
    const newer = await tx.afterActionReport.findFirst({ where: { exerciseId: aar.exerciseId, version: { gt: aar.version } }, select: { id: true } });
    if (newer) throw new ServiceError(409, "An amendment already exists. Open the latest version.");
    const created = await tx.afterActionReport.create({
      data: {
        exerciseId: aar.exerciseId,
        version: aar.version + 1,
        previousId: aar.id,
        status: "draft",
        sections: aar.sections as Prisma.InputJsonValue,
        // Provenance carries over; the amendment adds its own entries.
        editLog: (Array.isArray(aar.editLog) ? aar.editLog : []) as Prisma.InputJsonValue,
        sourceDocSha: aar.sourceDocSha,
        amendReason: why.slice(0, 1000),
        aamAt: aar.aamAt,
        aamAttendees: aar.aamAttendees,
        ipAgreedAt: aar.ipAgreedAt,
      },
      select: { id: true, version: true },
    });
    await tx.actionItem.updateMany({ where: { aarId: aar.id }, data: { aarId: created.id } });
    return created;
  });
}
