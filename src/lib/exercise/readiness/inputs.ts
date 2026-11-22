// Readiness inputs from the database. The program report supplies cadence,
// required roles, work items and report timeliness; the rest is read here.
// Server only. No next/* imports: the nightly cron runs on the boot path.

import { db } from "@/lib/db";
import { attackTagsOf } from "@/lib/exercise/msel";
import { addMonths, buildProgramReport, type ProgramReport } from "@/lib/exercise/program/report";
import { computeReadiness, type ReadinessInputs, type ReadinessResult } from "./score";

/** The 12-month window ending now, as the program report reads it. */
export function readinessWindow(now: Date): { from: Date; to: Date } {
  return { from: addMonths(now, -12), to: now };
}

/** Inputs from a 12-month program report plus ratings, inject tags, and playbooks exercised or run on incidents. */
export async function readinessInputs(report: ProgramReport, now: Date = new Date()): Promise<ReadinessInputs> {
  const from = addMonths(now, -12);
  const ended = { isPractice: false, status: "ended", endedAt: { gte: from, lte: now } };

  const [ratingRows, injects, playbooks] = await Promise.all([
    db.capabilityRating.findMany({
      where: { source: "evaluator", exercise: ended },
      orderBy: { createdAt: "desc" },
      select: { objectiveId: true, rating: true, exercise: { select: { endedAt: true } } },
      take: 5000,
    }),
    db.inject.findMany({
      where: { openedAt: { not: null }, exercise: ended },
      select: { secret: true, templateInjectId: true },
      take: 5000,
    }),
    db.sourceDocument.findMany({ where: { kind: "playbook" }, select: { id: true, scope: true } }),
  ]);

  // Ratings are append-only: the first row per objective is the latest.
  const seen = new Set<string>();
  const ratings: ReadinessInputs["ratings"] = [];
  for (const r of ratingRows) {
    if (seen.has(r.objectiveId)) continue;
    seen.add(r.objectiveId);
    if (r.exercise.endedAt) ratings.push({ rating: r.rating, endedAt: r.exercise.endedAt });
  }

  // An inject without its own tags uses its template inject's, as in the report.
  const untagged = injects.filter((i) => attackTagsOf(i.secret).length === 0 && i.templateInjectId).map((i) => i.templateInjectId as string);
  const templateSecrets = untagged.length
    ? new Map((await db.templateInject.findMany({ where: { id: { in: [...new Set(untagged)] } }, select: { id: true, secret: true } })).map((t) => [t.id, t.secret]))
    : new Map<string, unknown>();
  const techniques = new Set<string>();
  for (const i of injects) {
    const own = attackTagsOf(i.secret);
    for (const id of own.length ? own : attackTagsOf(i.templateInjectId ? templateSecrets.get(i.templateInjectId) : undefined)) techniques.add(id);
  }

  const own = playbooks.filter((p) => p.scope === "local").map((p) => p.id);
  const [exercisedRows, runRows] = own.length
    ? await Promise.all([
        db.exercise.findMany({ where: { ...ended, sourceDocumentId: { in: own } }, select: { sourceDocumentId: true }, distinct: ["sourceDocumentId"] }),
        db.incidentPlaybookRun.findMany({
          where: { documentId: { in: own }, createdAt: { gte: from, lte: now }, incident: { deletedAt: null, isTraining: false } },
          select: { documentId: true },
          distinct: ["documentId"],
        }),
      ])
    : [[], []];
  const exercised = new Set(exercisedRows.map((r) => r.sourceDocumentId as string));
  const run = new Set(runRows.map((r) => r.documentId as string));

  const inWindow = (iso: string) => new Date(iso).getTime() >= from.getTime();
  return {
    cadence: report.cadence,
    exercisesLast12: report.exercises.length,
    roles: report.roles,
    ratings,
    workItems: {
      open: report.actionItems.open,
      overdue: report.actionItems.overdue,
      openHigh: report.actionItems.openHigh,
      stale: report.actionItems.aging["90+"] ?? 0,
    },
    aar: { ended: report.exercises.length, overdue: report.aarOverdue.filter((a) => inWindow(a.endedAt)).length },
    techniques: techniques.size,
    playbooks: { total: playbooks.length, own: own.length, exercised: exercised.size, run: run.size, used: new Set([...exercised, ...run]).size },
  };
}

/** Today's readiness, from a fresh 12-month program report unless one is passed. */
export async function currentReadiness(now: Date = new Date(), report?: ProgramReport): Promise<ReadinessResult> {
  const r = report ?? (await buildProgramReport(readinessWindow(now), now));
  return computeReadiness(await readinessInputs(r, now), now);
}
