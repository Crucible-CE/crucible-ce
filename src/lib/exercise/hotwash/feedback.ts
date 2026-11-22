// HSEEP Participant Feedback Form. One row per participant per exercise,
// editable until the exercise's AAR is final. Guests and users who took part
// fill it from /play/[id]/feedback. Control sees a summary without names.

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";

export const FEEDBACK_SCALES = [
  { key: "overall", label: "Overall, the exercise was worth my time." },
  { key: "realism", label: "The scenario was realistic." },
  { key: "relevance", label: "The exercise was relevant to my job." },
  { key: "roleClarity", label: "My role was clear." },
] as const;
export type FeedbackScale = (typeof FEEDBACK_SCALES)[number]["key"];

const score = z.number().int().min(1, "Pick 1 to 5.").max(5, "Pick 1 to 5.");

export const feedbackInputSchema = z.object({
  overall: score,
  realism: score,
  relevance: score,
  roleClarity: score,
  strengths: z.string().trim().max(2000, "Use 2000 characters or fewer.").default(""),
  improvements: z.string().trim().max(2000, "Use 2000 characters or fewer.").default(""),
  comments: z.string().trim().max(2000, "Use 2000 characters or fewer.").default(""),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

const storedRatingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  overall: score,
  realism: score,
  relevance: score,
  roleClarity: score,
  strengths: z.string().default(""),
  improvements: z.string().default(""),
});

export interface FeedbackView extends FeedbackInput {
  updatedAt: string;
}

function toView(row: { ratings: unknown; comments: string | null; createdAt: Date }): FeedbackView | null {
  const r = storedRatingsSchema.safeParse(row.ratings);
  if (!r.success) return null;
  return {
    overall: r.data.overall,
    realism: r.data.realism,
    relevance: r.data.relevance,
    roleClarity: r.data.roleClarity,
    strengths: r.data.strengths,
    improvements: r.data.improvements,
    comments: row.comments ?? "",
    updatedAt: row.createdAt.toISOString(),
  };
}

/** Why feedback cannot be given or changed now, or null when it can. */
export async function feedbackClosedReason(exerciseId: string): Promise<string | null> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { status: true } });
  if (!ex) return "Exercise not found.";
  if (ex.status === "abandoned") return "This exercise was stopped. Feedback is closed.";
  if (ex.status !== "ended") return "Feedback opens after the exercise ends.";
  const latest = await db.afterActionReport.findFirst({ where: { exerciseId }, orderBy: { version: "desc" }, select: { status: true } });
  if (latest?.status === "final") return "The after-action report is final. Feedback is closed.";
  return null;
}

export async function getFeedback(exerciseId: string, participantId: string): Promise<FeedbackView | null> {
  const row = await db.feedback.findUnique({ where: { exerciseId_participantId: { exerciseId, participantId } } });
  return row ? toView(row) : null;
}

/** Create or replace this participant's feedback. One row per participant. */
export async function saveFeedback(exerciseId: string, participantId: string, input: FeedbackInput): Promise<{ created: boolean }> {
  const closed = await feedbackClosedReason(exerciseId);
  if (closed) throw new ServiceError(409, closed);
  const p = await db.participant.findFirst({ where: { id: participantId, exerciseId, removedAt: null }, select: { id: true } });
  if (!p) throw new ServiceError(403, "Join the exercise first.");
  const ratings = {
    schemaVersion: 1,
    overall: input.overall,
    realism: input.realism,
    relevance: input.relevance,
    roleClarity: input.roleClarity,
    strengths: input.strengths,
    improvements: input.improvements,
  } as Prisma.InputJsonValue;
  const existing = await db.feedback.findUnique({ where: { exerciseId_participantId: { exerciseId, participantId } }, select: { id: true } });
  await db.feedback.upsert({
    where: { exerciseId_participantId: { exerciseId, participantId } },
    create: { exerciseId, participantId, ratings, comments: input.comments || null },
    // createdAt doubles as "last saved" so the summary shows fresh edits.
    update: { ratings, comments: input.comments || null, createdAt: new Date() },
  });
  return { created: !existing };
}

export interface FeedbackSummary {
  responses: number;
  participants: number;
  averages: Record<FeedbackScale, number | null>;
  distribution: Record<FeedbackScale, number[]>;
  strengths: string[];
  improvements: string[];
  comments: string[];
}

/** Pure aggregation over parsed feedback. Comments carry no names. */
export function summarizeFeedback(rows: FeedbackView[], participants: number): FeedbackSummary {
  const keys = FEEDBACK_SCALES.map((s) => s.key);
  const averages = {} as Record<FeedbackScale, number | null>;
  const distribution = {} as Record<FeedbackScale, number[]>;
  for (const k of keys) {
    const vals = rows.map((r) => r[k]);
    averages[k] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    distribution[k] = [1, 2, 3, 4, 5].map((n) => vals.filter((v) => v === n).length);
  }
  const texts = (f: (r: FeedbackView) => string) => rows.map(f).map((t) => t.trim()).filter(Boolean);
  return {
    responses: rows.length,
    participants,
    averages,
    distribution,
    strengths: texts((r) => r.strengths),
    improvements: texts((r) => r.improvements),
    comments: texts((r) => r.comments),
  };
}

export async function feedbackSummary(exerciseId: string): Promise<FeedbackSummary> {
  const [rows, participants] = await Promise.all([
    db.feedback.findMany({ where: { exerciseId }, orderBy: { createdAt: "asc" } }),
    db.participant.count({ where: { exerciseId, removedAt: null, joinedAt: { not: null } } }),
  ]);
  return summarizeFeedback(rows.map(toView).filter((x): x is FeedbackView => Boolean(x)), participants);
}
