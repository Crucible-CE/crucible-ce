// Capability maturity over time (/after-action-reports/maturity). Evaluator
// objective ratings (P, S, M, U) from ended exercises, the latest rating per
// objective, grouped by capability: the rating's own capability, else the
// objective's capabilities. "Not evaluated" is left out. Practice exercises
// never count.

import { db } from "@/lib/db";
import { RATINGS, type Rating } from "./schema";

/** P = 4 down to U = 1. */
export const RATING_SCORE: Record<Rating, number> = { P: 4, S: 3, M: 2, U: 1 };

export interface MaturityInput {
  objectiveId: string;
  objectiveText: string;
  exerciseId: string;
  exerciseTitle: string;
  endedAt: Date;
  rating: string;
  capabilityIds: string[];
}

export interface MaturityPoint {
  exerciseId: string;
  exerciseTitle: string;
  endedAt: string;
  objectiveText: string;
  rating: Rating;
}

export interface MaturityExercise {
  exerciseId: string;
  exerciseTitle: string;
  endedAt: string;
  /** Mean of the objective scores in this exercise, 1 to 4. */
  score: number;
}

export type MaturityTrend = "improving" | "declining" | "stable";

export interface MaturityRow {
  capabilityId: string;
  key: string;
  name: string;
  points: MaturityPoint[];
  exercises: MaturityExercise[];
  latest: Rating;
  /** Null with one exercise. */
  trend: MaturityTrend | null;
}

export interface MaturityData {
  rows: MaturityRow[];
  exerciseCount: number;
  start: string | null;
  end: string | null;
}

function isRating(v: string): v is Rating {
  return (RATINGS as readonly string[]).includes(v);
}

/** The rating letter closest to a mean score. */
export function ratingFor(score: number): Rating {
  const r = Math.min(4, Math.max(1, Math.round(score)));
  return (Object.keys(RATING_SCORE) as Rating[]).find((k) => RATING_SCORE[k] === r)!;
}

/** A change of a quarter step or more between the last two exercises. */
export function trendOf(exercises: MaturityExercise[]): MaturityTrend | null {
  if (exercises.length < 2) return null;
  const d = exercises[exercises.length - 1].score - exercises[exercises.length - 2].score;
  if (d >= 0.25) return "improving";
  if (d <= -0.25) return "declining";
  return "stable";
}

/** Group ratings (already the latest per objective) by capability, oldest exercise first. */
export function buildMaturity(inputs: MaturityInput[], capabilities: Array<{ id: string; key: string; name: string; seq: number }>): MaturityData {
  const caps = new Map(capabilities.map((c) => [c.id, c]));
  const byCap = new Map<string, MaturityPoint[]>();
  const exerciseIds = new Set<string>();
  let start: number | null = null;
  let end: number | null = null;
  for (const r of inputs) {
    if (!isRating(r.rating)) continue;
    const ids = [...new Set(r.capabilityIds)].filter((id) => caps.has(id));
    if (ids.length === 0) continue;
    exerciseIds.add(r.exerciseId);
    const t = r.endedAt.getTime();
    start = start === null ? t : Math.min(start, t);
    end = end === null ? t : Math.max(end, t);
    for (const id of ids) {
      const list = byCap.get(id) ?? [];
      list.push({ exerciseId: r.exerciseId, exerciseTitle: r.exerciseTitle, endedAt: r.endedAt.toISOString(), objectiveText: r.objectiveText, rating: r.rating });
      byCap.set(id, list);
    }
  }
  const rows: MaturityRow[] = [];
  for (const [id, points] of byCap) {
    points.sort((a, b) => a.endedAt.localeCompare(b.endedAt) || a.exerciseId.localeCompare(b.exerciseId));
    const exercises: MaturityExercise[] = [];
    for (const p of points) {
      let ex = exercises.find((e) => e.exerciseId === p.exerciseId);
      if (!ex) {
        ex = { exerciseId: p.exerciseId, exerciseTitle: p.exerciseTitle, endedAt: p.endedAt, score: 0 };
        exercises.push(ex);
      }
    }
    for (const ex of exercises) {
      const mine = points.filter((p) => p.exerciseId === ex.exerciseId);
      ex.score = mine.reduce((s, p) => s + RATING_SCORE[p.rating], 0) / mine.length;
    }
    const cap = caps.get(id)!;
    rows.push({
      capabilityId: id,
      key: cap.key,
      name: cap.name,
      points,
      exercises,
      latest: ratingFor(exercises[exercises.length - 1].score),
      trend: trendOf(exercises),
    });
  }
  rows.sort((a, b) => (caps.get(a.capabilityId)!.seq - caps.get(b.capabilityId)!.seq) || a.key.localeCompare(b.key));
  return {
    rows,
    exerciseCount: exerciseIds.size,
    start: start === null ? null : new Date(start).toISOString(),
    end: end === null ? null : new Date(end).toISOString(),
  };
}

/** Maturity for the whole program. */
export async function loadMaturity(): Promise<MaturityData> {
  const rows = await db.capabilityRating.findMany({
    where: { source: "evaluator", exercise: { isPractice: false, status: "ended", endedAt: { not: null } } },
    orderBy: { createdAt: "desc" },
    select: {
      objectiveId: true,
      exerciseId: true,
      capabilityId: true,
      rating: true,
      objective: { select: { text: true, capabilityIds: true } },
      exercise: { select: { title: true, endedAt: true } },
    },
    take: 10_000,
  });
  // Ratings are append-only: the first row per objective is the latest.
  const seen = new Set<string>();
  const inputs: MaturityInput[] = [];
  for (const r of rows) {
    if (seen.has(r.objectiveId)) continue;
    seen.add(r.objectiveId);
    if (!r.exercise.endedAt) continue;
    inputs.push({
      objectiveId: r.objectiveId,
      objectiveText: r.objective.text,
      exerciseId: r.exerciseId,
      exerciseTitle: r.exercise.title,
      endedAt: r.exercise.endedAt,
      rating: r.rating,
      capabilityIds: r.capabilityId ? [r.capabilityId] : r.objective.capabilityIds,
    });
  }
  const ids = [...new Set(inputs.flatMap((i) => i.capabilityIds))];
  const capabilities = ids.length ? await db.capability.findMany({ where: { id: { in: ids } }, select: { id: true, key: true, name: true, seq: true } }) : [];
  return buildMaturity(inputs, capabilities);
}
