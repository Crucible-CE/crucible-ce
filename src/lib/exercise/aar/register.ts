// The after-action reports list (/after-action-reports) and who may read a
// report read only.
//
//   Program users (administrators, exercise directors, contributors): every
//   report of every exercise, the latest version, any status.
//   Readers: final versions only, of exercises they took part in.
//
// Practice exercises never appear. Exports (PDF, evidence bundle) stay with
// the exercise's control team, as on the export route.

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { hasPermission, managesAllExercises } from "@/lib/exercise/auth/rbac";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { CONTROL_ROLES, MODES } from "@/lib/exercise/runtime/types";
import { readSections } from "./edit";
import { allFindings, findingStatusOf } from "./findings";
import { orderSigners } from "./document";

export const AAR_STATUSES = ["draft", "review", "final"] as const;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()));

export const aarListFiltersSchema = z.object({
  status: z.enum(AAR_STATUSES).optional().catch(undefined),
  mode: z.enum(MODES).optional().catch(undefined),
  from: day.optional().catch(undefined),
  to: day.optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(200)
    .optional()
    .catch(undefined)
    .transform((v) => (v ? v : undefined))
    .optional(),
});
export type AarListFilters = z.infer<typeof aarListFiltersSchema>;

/** Filters from page search params. Unknown or malformed values are dropped. */
export function aarFiltersFrom(params: Record<string, string | string[] | undefined>): AarListFilters {
  const raw: Record<string, string> = {};
  for (const k of ["status", "mode", "from", "to", "q"]) {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) raw[k] = s;
  }
  return aarListFiltersSchema.parse(raw);
}

export interface AarListRow {
  aarId: string;
  exerciseId: string;
  exerciseTitle: string;
  mode: string;
  endedAt: string | null;
  status: string;
  version: number;
  finalizedAt: string | null;
  signers: Array<{ role: string; name: string }>;
  acceptedFindings: number;
  workItems: number;
  /** The user is on the exercise's control team: PDF and bundle exports. */
  canExport: boolean;
}

/** Everyone but readers sees the whole program. */
export function seesAllReports(user: SessionUser): boolean {
  return hasPermission(user, "reports.view");
}

interface Seats {
  ids: Set<string>;
  control: Set<string>;
}

async function seatsOf(userId: string): Promise<Seats> {
  const rows = await db.participant.findMany({ where: { userId, removedAt: null }, select: { exerciseId: true, roles: true } });
  return {
    ids: new Set(rows.map((r) => r.exerciseId)),
    control: new Set(rows.filter((r) => r.roles.some((x) => (CONTROL_ROLES as readonly string[]).includes(x))).map((r) => r.exerciseId)),
  };
}

function canExportFor(user: SessionUser, seats: Seats, ex: { id: string; createdById: string | null }): boolean {
  return managesAllExercises(user.role) || ex.createdById === user.id || seats.control.has(ex.id);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function exerciseWhere(user: SessionUser, seats: Seats, f: AarListFilters): Prisma.ExerciseWhereInput {
  const where: Prisma.ExerciseWhereInput = { isPractice: false };
  if (f.mode) where.mode = f.mode;
  if (f.q) where.title = { contains: f.q, mode: "insensitive" };
  if (f.from || f.to) {
    where.endedAt = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
      ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + DAY_MS) } : {}),
    };
  }
  if (!seesAllReports(user)) where.OR = [{ id: { in: [...seats.ids] } }, { createdById: user.id }];
  return where;
}

function acceptedCount(raw: unknown): number {
  const sections = readSections(raw);
  return sections ? allFindings(sections).filter((f) => findingStatusOf(f.afi) === "accepted").length : 0;
}

/**
 * Reports the user may see, one row per exercise (its latest visible
 * version), newest exercise first.
 */
export async function listAarRows(user: SessionUser, filters: AarListFilters = {}): Promise<AarListRow[]> {
  const all = seesAllReports(user);
  const seats = await seatsOf(user.id);
  const versions = await db.afterActionReport.findMany({
    where: { exercise: exerciseWhere(user, seats, filters), ...(all ? {} : { status: "final" }) },
    orderBy: [{ exerciseId: "asc" }, { version: "desc" }],
    select: { id: true, exerciseId: true, status: true },
    take: 5000,
  });
  const latest = new Map<string, { id: string; status: string }>();
  for (const v of versions) if (!latest.has(v.exerciseId)) latest.set(v.exerciseId, v);
  const picked = [...latest.values()].filter((v) => !filters.status || v.status === filters.status).map((v) => v.id);
  if (picked.length === 0) return [];
  const rows = await db.afterActionReport.findMany({
    where: { id: { in: picked } },
    select: {
      id: true,
      exerciseId: true,
      version: true,
      status: true,
      sections: true,
      finalizedAt: true,
      createdAt: true,
      exercise: { select: { id: true, title: true, mode: true, endedAt: true, createdById: true } },
      signatures: { select: { role: true, name: true } },
      _count: { select: { actionItems: true } },
    },
  });
  const when = (r: (typeof rows)[number]) => (r.exercise.endedAt ?? r.createdAt).getTime();
  rows.sort((a, b) => when(b) - when(a) || b.createdAt.getTime() - a.createdAt.getTime());
  return rows.map((r) => ({
    aarId: r.id,
    exerciseId: r.exerciseId,
    exerciseTitle: r.exercise.title,
    mode: r.exercise.mode,
    endedAt: r.exercise.endedAt?.toISOString() ?? null,
    status: r.status,
    version: r.version,
    finalizedAt: r.finalizedAt?.toISOString() ?? null,
    signers: orderSigners(r.signatures).map((s) => ({ role: s.role, name: s.name })),
    acceptedFindings: acceptedCount(r.sections),
    workItems: r._count.actionItems,
    canExport: canExportFor(user, seats, r.exercise),
  }));
}

/**
 * The report version this user may read read only, or null. Program users:
 * the requested version or the latest. Readers who took part: the requested
 * final version or the latest final one.
 */
export async function readableAarVersion(user: SessionUser, exerciseId: string, version?: number | null): Promise<number | null> {
  const ex = await db.exercise.findUnique({ where: { id: exerciseId }, select: { id: true, isPractice: true, createdById: true } });
  if (!ex || ex.isPractice) return null;
  const all = seesAllReports(user);
  if (!all && ex.createdById !== user.id) {
    const seat = await db.participant.count({ where: { exerciseId, userId: user.id, removedAt: null } });
    if (seat === 0) return null;
  }
  const row = await db.afterActionReport.findFirst({
    where: { exerciseId, ...(version ? { version } : {}), ...(all ? {} : { status: "final" }) },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return row?.version ?? null;
}
