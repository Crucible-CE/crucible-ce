// AAR services behind /api/exercises/{id}/aar/**. Routes do access checks
// and auditing; these functions enforce the report rules:
//   - practice, abandoned and unfinished exercises never get a report;
//   - only the latest version, in draft or review, changes;
//   - every human edit appends an edit log entry (origin human).
//
// The record sections (overview, decision log, clocks, roster, required roles,
// control mapping, methodology, parking lot) fill from the exercise. People
// write the executive summary, strengths and areas for improvement.

import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { gatherAarInputs, type AarInputs } from "./inputs";
import { applyRatings, buildControlMapping, buildDeterministicSections, SYSTEM_SECTIONS } from "./draft";
import { AarEditError, appendEditLog, applySectionEdit, isHumanEdited, isSectionKey, logPath, protectedFieldChange, readEditLog, readSections, sectionOrigins, type SectionOrigin } from "./edit";
import { AAR_SECTION_KEYS, aarSectionsSchema, type AarSectionKey, type AarSections, type EditLogEntry } from "./schema";
import { assertDraft, assertEditable, latestAar, lockAar } from "./store";
import { evidenceOptions, type EvidenceOption } from "./evidence";
import { setReviewStatus } from "./finalize";
import { findingsEditProblem } from "./findings";
import { proposeFindings } from "./proposals";

/** "afi_3f9a1c20b7". */
export function newFindingId(): string {
  return `afi_${randomBytes(5).toString("hex")}`;
}

export const sectionEditSchema = z.object({
  section: z.enum(AAR_SECTION_KEYS),
  path: z.string().max(120).nullable().optional(),
  value: z.unknown(),
});
export type SectionEditInput = z.infer<typeof sectionEditSchema>;

export const refreshSchema = z.object({
  sections: z.array(z.enum(SYSTEM_SECTIONS)).max(SYSTEM_SECTIONS.length).optional(),
  force: z.boolean().optional(),
});

export const statusSchema = z.object({ status: z.enum(["draft", "review"]) });

const isoDateTime = z.string().datetime({ offset: true });
/** After-action meeting record. Required before signing. */
export const meetingSchema = z.object({
  aamAt: isoDateTime.nullable(),
  aamAttendees: z.string().trim().max(4000, "Use 4000 characters or fewer."),
  ipAgreedAt: isoDateTime.nullable(),
});
export type MeetingInput = z.infer<typeof meetingSchema>;

/** Why this exercise cannot get a report, or null. */
export function reportBlockedReason(ex: { status: string; isPractice: boolean }): string | null {
  if (ex.isPractice) return "Practice runs do not get an after-action report.";
  if (ex.status === "abandoned") return "Abandoned exercises do not get an after-action report.";
  if (ex.status !== "ended") return "End the exercise before drafting the report.";
  return null;
}

/** Refuse practice, abandoned and unfinished exercises. */
export async function assertReportable(exerciseId: string): Promise<{ mode: string; title: string }> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true, isPractice: true, mode: true, title: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  const blocked = reportBlockedReason(ex);
  if (blocked) throw new ServiceError(409, blocked);
  return ex;
}

/** Create draft v1 from the record. Evaluators then write the narrative. */
export async function createAar(exerciseId: string): Promise<{ aarId: string }> {
  await assertReportable(exerciseId);
  if (await latestAar(exerciseId)) throw new ServiceError(409, "A report already exists.");
  const inputs = await gatherAarInputs(exerciseId);
  const proposed = proposeFindings(inputs, buildDeterministicSections(inputs), newFindingId);
  const sections = proposed.sections;
  const at = new Date().toISOString();
  let log: EditLogEntry[] = [];
  for (const key of SYSTEM_SECTIONS) log = appendEditLog(log, { section: key, origin: "system", byUserId: null, at, note: "Built from the record" });
  if (proposed.added.length) log = appendEditLog(log, { section: "analysis", path: "analysis.findings", origin: "system", byUserId: null, at, note: `Proposed ${proposed.added.length} findings from the record` });
  try {
    const row = await db.afterActionReport.create({
      data: {
        exerciseId,
        version: 1,
        status: "draft",
        sections: sections as unknown as Prisma.InputJsonValue,
        editLog: log as unknown as Prisma.InputJsonValue,
        sourceDocSha: inputs.sourceDocument?.sha256 ?? null,
      },
      select: { id: true },
    });
    return { aarId: row.id };
  } catch (e) {
    // Two callers raced (ENDEX hook and a facilitator): the unique version wins once.
    if ((e as { code?: string })?.code === "P2002") throw new ServiceError(409, "A report already exists.");
    throw e;
  }
}

/** Draft v1 at ENDEX when the exercise gets a report and none exists yet. Never throws. */
export async function createAarAtEndex(exerciseId: string): Promise<boolean> {
  try {
    const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true, isPractice: true } });
    if (!ex || reportBlockedReason(ex)) return false;
    if (await latestAar(exerciseId)) return false;
    await createAar(exerciseId);
    return true;
  } catch (e) {
    if (e instanceof ServiceError && e.status === 409) return false;
    console.error(`[aar] draft at ENDEX failed for ${exerciseId}:`, e);
    return false;
  }
}

/** Fresh values for the record sections. Pure. */
export function recordSections(inputs: AarInputs, current: AarSections): Partial<AarSections> {
  const fresh = buildDeterministicSections(inputs);
  return {
    overview: fresh.overview,
    decisionLog: fresh.decisionLog,
    clocks: fresh.clocks,
    methodology: fresh.methodology,
    roster: fresh.roster,
    requiredRoles: fresh.requiredRoles,
    parkingLot: fresh.parkingLot,
    controlMapping: buildControlMapping(current.analysis, inputs),
  };
}

/**
 * Rebuild the record sections from the exercise. A section a person edited
 * stays unless forced. Evaluator ratings are refreshed in every case. New
 * proposed findings are added. The executive summary, strengths, existing
 * findings and decisions are never touched.
 */
export async function refreshFromRecord(
  exerciseId: string,
  input: z.infer<typeof refreshSchema> = {},
  userId: string | null = null,
): Promise<{ aarId: string; changed: AarSectionKey[]; proposed: number }> {
  const inputs = await gatherAarInputs(exerciseId);
  return db.$transaction(async (tx) => {
    const latest = await latestAar(exerciseId, tx);
    const aar = await assertDraft(tx, latest ? await lockAar(tx, latest.id) : null);
    const current = readSections(aar.sections) ?? buildDeterministicSections(inputs);
    let log = readEditLog(aar.editLog);
    const targets = input.sections && input.sections.length ? input.sections : SYSTEM_SECTIONS;
    const fresh = recordSections(inputs, current);
    const out: Record<string, unknown> = { ...current, analysis: applyRatings(current.analysis, inputs) };
    const changed: AarSectionKey[] = [];
    const at = new Date().toISOString();
    for (const key of targets) {
      if (!input.force && isHumanEdited(log, key)) continue;
      const value = fresh[key];
      if (value === undefined || JSON.stringify(value) === JSON.stringify(current[key])) continue;
      out[key] = value;
      changed.push(key);
      log = appendEditLog(log, { section: key, origin: "system", byUserId: userId, at, note: "Refreshed from the record" });
    }
    // New proposed findings from the record. Existing findings and decisions stay.
    const proposed = proposeFindings(inputs, aarSectionsSchema.parse(out), newFindingId);
    const sections = proposed.sections;
    if (proposed.added.length || proposed.linked.length) {
      log = appendEditLog(log, { section: "analysis", path: "analysis.findings", origin: "system", byUserId: userId, at, note: `Proposed ${proposed.added.length} findings from the record` });
    }
    await tx.afterActionReport.update({
      where: { id: aar.id },
      data: {
        sections: sections as unknown as Prisma.InputJsonValue,
        editLog: log as unknown as Prisma.InputJsonValue,
        sourceDocSha: inputs.sourceDocument?.sha256 ?? aar.sourceDocSha,
      },
    });
    return { aarId: aar.id, changed, proposed: proposed.added.length };
  });
}

/** Propose findings from the record that the report does not have yet. Draft only. Decisions stay. */
export async function collectFindings(exerciseId: string, userId: string | null): Promise<{ aarId: string; proposed: number; linked: number }> {
  const inputs = await gatherAarInputs(exerciseId);
  return db.$transaction(async (tx) => {
    const latest = await latestAar(exerciseId, tx);
    const aar = await assertDraft(tx, latest ? await lockAar(tx, latest.id) : null);
    const current = readSections(aar.sections);
    if (!current) throw new ServiceError(409, "The report has no valid content yet. Refresh it from the record first.");
    const r = proposeFindings(inputs, current, newFindingId);
    if (!r.added.length && !r.linked.length) return { aarId: aar.id, proposed: 0, linked: 0 };
    const log = appendEditLog(readEditLog(aar.editLog), {
      section: "analysis",
      path: "analysis.findings",
      origin: "system",
      byUserId: userId,
      note: `Proposed ${r.added.length} findings from the record`,
    });
    await tx.afterActionReport.update({
      where: { id: aar.id },
      data: { sections: r.sections as unknown as Prisma.InputJsonValue, editLog: log as unknown as Prisma.InputJsonValue },
    });
    return { aarId: aar.id, proposed: r.added.length, linked: r.linked.length };
  });
}

/** Apply one human edit at section[.path], validate the whole report, and log it. */
export async function editSection(exerciseId: string, input: SectionEditInput, userId: string | null): Promise<{ aarId: string; before: unknown }> {
  if (!isSectionKey(input.section)) throw new ServiceError(400, "Unknown section.");
  // Control mapping follows the findings: read the record's tested controls before the lock.
  const inputs = input.section === "analysis" ? await gatherAarInputs(exerciseId) : null;
  return db.$transaction(async (tx) => {
    const latest = await latestAar(exerciseId, tx);
    const aar = await assertDraft(tx, latest ? await lockAar(tx, latest.id) : null);
    const sections = readSections(aar.sections);
    if (!sections) throw new ServiceError(409, "The report has no valid content yet. Refresh it from the record first.");
    const before = input.path ? undefined : sections[input.section];
    let next: AarSections;
    try {
      next = applySectionEdit(sections, input.section, input.path ?? null, input.value);
    } catch (e) {
      if (e instanceof AarEditError) throw new ServiceError(e.status, e.message);
      throw e;
    }
    const blocked = protectedFieldChange(sections, next) ?? findingsEditProblem(sections, next);
    if (blocked) throw new ServiceError(400, blocked);
    let log = appendEditLog(readEditLog(aar.editLog), {
      section: input.section,
      path: logPath(input.section, input.path),
      origin: "human",
      byUserId: userId,
    });
    if (inputs && !isHumanEdited(log, "controlMapping")) {
      const mapping = buildControlMapping(next.analysis, inputs);
      if (JSON.stringify(mapping) !== JSON.stringify(next.controlMapping)) {
        next = { ...next, controlMapping: mapping };
        log = appendEditLog(log, { section: "controlMapping", path: "controlMapping.afis", origin: "system", byUserId: null, note: "Follows the findings" });
      }
    }
    await tx.afterActionReport.update({
      where: { id: aar.id },
      data: { sections: next as unknown as Prisma.InputJsonValue, editLog: log as unknown as Prisma.InputJsonValue },
    });
    return { aarId: aar.id, before: before === undefined ? null : before };
  });
}

/**
 * Draft to review (after-action meeting) and back. Final is set by sign-off.
 * Same rules as the sign-off panel: returning to draft clears signatures.
 */
export async function setAarStatus(exerciseId: string, status: "draft" | "review"): Promise<{ aarId: string; from: string; to: string; clearedSignatures: number }> {
  const latest = await latestAar(exerciseId);
  const aar = await assertEditable(db, latest);
  const r = await setReviewStatus(aar.id, status);
  return { aarId: aar.id, ...r };
}

/**
 * Record the after-action meeting. Allowed in draft and review until someone
 * signs; after a signature, return the report to draft first.
 */
export async function updateMeeting(exerciseId: string, input: MeetingInput): Promise<{ aarId: string }> {
  return db.$transaction(async (tx) => {
    const latest = await latestAar(exerciseId, tx);
    const aar = await assertEditable(tx, latest ? await lockAar(tx, latest.id) : null);
    const signed = await tx.aarSignature.count({ where: { aarId: aar.id } });
    if (signed > 0) throw new ServiceError(409, "A signature is recorded. Move the report back to draft to change the meeting record.");
    const aamAt = input.aamAt ? new Date(input.aamAt) : null;
    const ipAgreedAt = input.ipAgreedAt ? new Date(input.ipAgreedAt) : null;
    if (aamAt && aamAt.getTime() > Date.now() + 24 * 3600_000) throw new ServiceError(400, "The meeting date is in the future.");
    await tx.afterActionReport.update({
      where: { id: aar.id },
      data: { aamAt, aamAttendees: input.aamAttendees || null, ipAgreedAt },
    });
    return { aarId: aar.id };
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface AarView {
  exercise: { id: string; title: string; mode: string; status: string; isPractice: boolean; timezone: string; startedAt: string | null; endedAt: string | null; scenarioStartAt: string | null };
  reportable: boolean;
  blockedReason: string | null;
  aar: {
    id: string;
    version: number;
    status: string;
    sections: AarSections | null;
    editLog: EditLogEntry[];
    origins: Record<AarSectionKey, SectionOrigin | null>;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
    finalizedAt: string | null;
    isLatest: boolean;
    editable: boolean;
    /** Content changes need draft; review freezes the report for signing. */
    contentEditable: boolean;
    meeting: { aamAt: string | null; aamAttendees: string; ipAgreedAt: string | null };
    signatureCount: number;
    amendReason: string | null;
    previous: { id: string; version: number; contentHash: string | null } | null;
  } | null;
  /** After-action tracker strip. */
  tracker: {
    hotwash: number;
    ratings: { done: number; total: number };
    feedback: { responses: number; participants: number };
    attendance: { confirmed: number; total: number };
    draft: boolean;
    meeting: boolean;
    final: boolean;
  };
  versions: Array<{ id: string; version: number; status: string; createdAt: string; finalizedAt: string | null }>;
  /** Record items evaluators can cite as evidence (observations, answers, entries, votes, decisions). */
  evidence: EvidenceOption[];
}

/** Counts for the after-action tracker strip. Ratings count evaluator ratings and "Not evaluated". */
async function trackerFor(exerciseId: string, versions: Array<{ status: string }>): Promise<AarView["tracker"]> {
  const [hotwash, objectives, ratings, feedback, participants, latest] = await Promise.all([
    db.hotwashItem.count({ where: { exerciseId } }),
    db.objective.findMany({ where: { exerciseId }, select: { id: true } }),
    db.capabilityRating.findMany({ where: { exerciseId, source: "evaluator" }, select: { objectiveId: true } }),
    db.feedback.count({ where: { exerciseId } }),
    db.participant.findMany({ where: { exerciseId, removedAt: null }, select: { joinedAt: true, attendance: true, noDevice: true } }),
    db.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { aamAt: true, ipAgreedAt: true, aamAttendees: true } }),
  ]);
  const rated = new Set(ratings.map((r) => r.objectiveId));
  return {
    hotwash,
    ratings: { done: objectives.filter((o) => rated.has(o.id)).length, total: objectives.length },
    feedback: { responses: feedback, participants: participants.filter((p) => !p.noDevice && (p.joinedAt || p.attendance === "attended" || p.attendance === "partial")).length },
    attendance: { confirmed: participants.filter((p) => p.attendance).length, total: participants.length },
    draft: versions.length > 0,
    meeting: Boolean(latest?.aamAt && latest.ipAgreedAt && latest.aamAttendees?.trim()),
    final: versions.some((v) => v.status === "final"),
  };
}

export async function getAarView(exerciseId: string, version?: number | null): Promise<AarView> {
  const ex = await db.exercise.findUnique({
    where: { id: exerciseId },
    select: { id: true, title: true, mode: true, status: true, isPractice: true, startedAt: true, endedAt: true, scenarioStartAt: true },
  });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  const settings = await getExerciseSettings();
  const versions = await db.afterActionReport.findMany({
    where: { exerciseId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, createdAt: true, finalizedAt: true },
  });
  const pick = version ? versions.find((v) => v.version === version) : versions[0];
  if (version && !pick) throw new ServiceError(404, "That version does not exist.");
  const row = pick
    ? await db.afterActionReport.findUnique({
        where: { id: pick.id },
        include: { previous: { select: { id: true, version: true, contentHash: true } }, _count: { select: { signatures: true } } },
      })
    : null;
  const latestId = versions[0]?.id ?? null;
  const blockedReason = reportBlockedReason(ex);
  const [tracker, evidence] = await Promise.all([
    trackerFor(exerciseId, versions),
    row && row.id === latestId && row.status === "draft" ? gatherAarInputs(exerciseId).then(evidenceOptions) : Promise.resolve([] as EvidenceOption[]),
  ]);

  const log = row ? readEditLog(row.editLog) : [];
  const isLatestRow = Boolean(row && row.id === latestId);
  return {
    exercise: {
      id: ex.id,
      title: ex.title,
      mode: ex.mode,
      status: ex.status,
      isPractice: ex.isPractice,
      timezone: settings?.timezone ?? "UTC",
      startedAt: ex.startedAt?.toISOString() ?? null,
      endedAt: ex.endedAt?.toISOString() ?? null,
      scenarioStartAt: ex.scenarioStartAt?.toISOString() ?? null,
    },
    reportable: blockedReason === null,
    blockedReason,
    aar: row
      ? {
          id: row.id,
          version: row.version,
          status: row.status,
          sections: readSections(row.sections),
          editLog: log,
          origins: sectionOrigins(log),
          lastError: row.lastError,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          finalizedAt: row.finalizedAt?.toISOString() ?? null,
          isLatest: isLatestRow,
          editable: isLatestRow && (row.status === "draft" || row.status === "review"),
          contentEditable: isLatestRow && row.status === "draft",
          meeting: { aamAt: row.aamAt?.toISOString() ?? null, aamAttendees: row.aamAttendees ?? "", ipAgreedAt: row.ipAgreedAt?.toISOString() ?? null },
          signatureCount: row._count.signatures,
          amendReason: row.amendReason,
          previous: row.previous ? { id: row.previous.id, version: row.previous.version, contentHash: row.previous.contentHash } : null,
        }
      : null,
    tracker,
    versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.createdAt.toISOString(), finalizedAt: v.finalizedAt?.toISOString() ?? null })),
    evidence,
  };
}
