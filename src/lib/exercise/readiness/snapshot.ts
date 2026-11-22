// Daily readiness snapshots and the 12-month trend. One row per day: a rerun
// on the same day replaces that day's row. No next/* imports (boot path).

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { installOrgId } from "@/lib/exercise/settings";
import { addMonths } from "@/lib/exercise/program/report";
import { currentReadiness } from "./inputs";
import type { ReadinessResult } from "./score";

/** Midnight UTC of the day `now` falls on. */
export function snapshotDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Store a result as the snapshot for its day. Null before setup (no organization). */
export async function saveReadinessSnapshot(result: ReadinessResult, now: Date = new Date()): Promise<{ id: string; day: Date } | null> {
  const organizationId = await installOrgId();
  if (!organizationId) return null;
  const day = snapshotDay(now);
  const data = {
    score: result.score,
    rubricVersion: result.rubricVersion,
    components: result.components as unknown as Prisma.InputJsonValue,
  };
  const row = await db.readinessSnapshot.upsert({
    where: { organizationId_day: { organizationId, day } },
    create: { organizationId, day, ...data },
    update: data,
    select: { id: true, day: true },
  });
  return row;
}

/** Compute today's readiness and store it. */
export async function takeReadinessSnapshot(now: Date = new Date()): Promise<{ id: string; day: Date; score: number } | null> {
  const result = await currentReadiness(now);
  const row = await saveReadinessSnapshot(result, now);
  return row ? { ...row, score: result.score } : null;
}

export interface ReadinessTrendPoint {
  day: string;
  score: number;
}

/** Daily scores for the last 12 months, oldest first. */
export async function readinessTrend(now: Date = new Date()): Promise<ReadinessTrendPoint[]> {
  const rows = await db.readinessSnapshot.findMany({
    where: { day: { gte: snapshotDay(addMonths(now, -12)) } },
    orderBy: { day: "asc" },
    select: { day: true, score: true },
    take: 400,
  });
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), score: r.score }));
}
