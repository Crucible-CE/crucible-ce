// Improvement plan (HSEEP IP matrix). One ActionItem row per corrective
// action. Rows tied to an AAR follow its lock: once that version is final,
// only live tracking fields (status, closure evidence, rejection reason) can
// change. The signed snapshot keeps what was signed.

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { ServiceError } from "@/lib/exercise/errors";
import { csvCell } from "@/lib/exercise/msel";
import { assertAarEditable, lockAarRow, AAR_LOCKED_MESSAGE } from "@/lib/exercise/aar/lock";
import { evidenceAfiId, listAfis, parseSections, resolveAfi } from "./afis";

export { resolveAfi } from "./afis";

export const POETE = ["planning", "organization", "equipment", "training", "exercise"] as const;
export const POETE_LABELS: Record<(typeof POETE)[number], string> = {
  planning: "Planning",
  organization: "Organization",
  equipment: "Equipment",
  training: "Training",
  exercise: "Exercise",
};
export const ACTION_STATUSES = ["open", "in_progress", "done", "rejected"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};
export const PRIORITIES = ["low", "medium", "high"] as const;
export const PRIORITY_LABELS: Record<(typeof PRIORITIES)[number], string> = { low: "Low", medium: "Medium", high: "High" };

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer.`)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .optional();

const optDate = z
  .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "Use a date like 2026-12-31."), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v) : null))
  .optional();

const optId = z.string().max(40).nullable().optional();

export const actionItemFieldsSchema = z.object({
  capabilityId: optId,
  objectiveId: optId,
  afi: z.string().trim().min(1, "Describe the area for improvement.").max(2000),
  correctiveAction: z.string().trim().min(1, "Describe the corrective action.").max(2000),
  poete: z.enum(POETE).nullable().optional(),
  responsibleOrg: optText(200),
  poc: optText(200),
  pocEmail: z
    .union([z.string().trim().email("Use a valid email address.").max(200), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null))
    .optional(),
  startDate: optDate,
  dueDate: optDate,
  status: z.enum(ACTION_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  closureEvidence: optText(4000),
  rejectedReason: optText(1000),
});

export const actionItemCreateSchema = actionItemFieldsSchema.extend({
  exerciseId: optId,
  aarId: optId,
  afiId: optId,
});
export type ActionItemCreate = z.infer<typeof actionItemCreateSchema>;

export const actionItemUpdateSchema = actionItemFieldsSchema.partial();
export type ActionItemUpdate = z.infer<typeof actionItemUpdateSchema>;

/** Fields that stay editable after the AAR version is final (live tracking). */
export const LIVE_FIELDS = ["status", "closureEvidence", "rejectedReason"] as const;

export interface ActionItemRow {
  id: string;
  exerciseId: string | null;
  exerciseTitle: string | null;
  aarId: string | null;
  aarVersion: number | null;
  aarStatus: string | null;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityName: string | null;
  objectiveId: string | null;
  objectiveText: string | null;
  afiId: string | null;
  afi: string;
  correctiveAction: string;
  poete: string | null;
  responsibleOrg: string | null;
  poc: string | null;
  pocEmail: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: ActionStatus;
  priority: string;
  closureEvidence: string | null;
  rejectedReason: string | null;
  overdue: boolean;
  /** Tracking only: the AAR version is final. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export function isOpenStatus(status: string): boolean {
  return status === "open" || status === "in_progress";
}

export function isOverdue(item: { status: string; dueDate: Date | string | null }, now: Date): boolean {
  if (!item.dueDate || !isOpenStatus(item.status)) return false;
  return new Date(item.dueDate).getTime() < now.getTime();
}

function checkStatusFields(status: string | undefined, closureEvidence: string | null | undefined, rejectedReason: string | null | undefined) {
  if (status === "rejected" && !rejectedReason) throw new ServiceError(400, "Give a reason for the rejection.");
  if (status === "done" && !closureEvidence) throw new ServiceError(400, "Add closure evidence before marking this done.");
}

async function assertExerciseAllowsPlan(client: DbClient, exerciseId: string) {
  const ex = await client.exercise.findUnique({ where: { id: exerciseId }, select: { isPractice: true, status: true } });
  if (!ex) throw new ServiceError(404, "Exercise not found.");
  if (ex.isPractice) throw new ServiceError(409, "Practice exercises do not get an improvement plan.");
  if (ex.status === "abandoned") throw new ServiceError(409, "Abandoned exercises do not get an improvement plan.");
}

async function checkLinks(client: DbClient, exerciseId: string | null, input: { capabilityId?: string | null; objectiveId?: string | null }) {
  if (input.capabilityId) {
    const c = await client.capability.findUnique({ where: { id: input.capabilityId }, select: { id: true } });
    if (!c) throw new ServiceError(400, "That capability does not exist.");
  }
  if (input.objectiveId) {
    const o = await client.objective.findFirst({
      where: { id: input.objectiveId, ...(exerciseId ? { exerciseId } : {}) },
      select: { id: true },
    });
    if (!o) throw new ServiceError(400, "That objective is not part of this exercise.");
  }
}

/**
 * Create an action item. With aarId the AAR must be editable; with afiId the
 * AFI is marked resolved in the AAR sections in the same transaction.
 */
export async function createActionItem(input: ActionItemCreate, byUserId: string | null): Promise<{ id: string }> {
  return db.$transaction(async (tx) => {
    let exerciseId = input.exerciseId ?? null;
    const aarId = input.aarId ?? null;
    if (input.afiId && !aarId) throw new ServiceError(400, "An area for improvement needs its report.");
    if (aarId) {
      if (input.afiId) await lockAarRow(tx, aarId);
      const aar = await assertAarEditable(aarId, tx);
      if (exerciseId && exerciseId !== aar.exerciseId) throw new ServiceError(400, "That report belongs to another exercise.");
      exerciseId = aar.exerciseId;
      if (input.afiId) {
        const sections = parseSections(aar.sections);
        const ref = sections ? listAfis(sections).find((f) => f.id === input.afiId) : undefined;
        if (!ref) throw new ServiceError(404, "That area for improvement is not in this report.");
        if (ref.actionItemId) {
          const linked = await tx.actionItem.findUnique({ where: { id: ref.actionItemId }, select: { id: true } });
          if (linked) throw new ServiceError(409, "That area for improvement already has an action.");
        }
      }
    }
    if (exerciseId) await assertExerciseAllowsPlan(tx, exerciseId);
    await checkLinks(tx, exerciseId, input);
    const status = input.status ?? "open";
    checkStatusFields(status, input.closureEvidence, input.rejectedReason);
    const row = await tx.actionItem.create({
      data: {
        exerciseId,
        aarId,
        capabilityId: input.capabilityId ?? null,
        objectiveId: input.objectiveId ?? null,
        afi: input.afi,
        correctiveAction: input.correctiveAction,
        poete: input.poete ?? null,
        responsibleOrg: input.responsibleOrg ?? null,
        poc: input.poc ?? null,
        pocEmail: input.pocEmail ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        status,
        priority: input.priority ?? "medium",
        closureEvidence: input.closureEvidence ?? null,
        rejectedReason: status === "rejected" ? (input.rejectedReason ?? null) : null,
        evidence: (input.afiId ? { afiId: input.afiId } : {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    if (aarId && input.afiId) await resolveAfi(aarId, input.afiId, { actionItemId: row.id }, byUserId, tx);
    return row;
  });
}

/**
 * Update an action item. When its AAR version is final, only status, closure
 * evidence and rejection reason may change. Returns the fields that changed
 * (before and after) for the audit record.
 */
export async function updateActionItem(
  id: string,
  input: ActionItemUpdate,
): Promise<{ changed: string[]; before: Record<string, unknown> }> {
  const row = await db.actionItem.findUnique({ where: { id }, include: { aar: { select: { status: true } } } });
  if (!row) throw new ServiceError(404, "Work item not found.");
  const keys = (Object.keys(input) as Array<keyof ActionItemUpdate>).filter((k) => input[k] !== undefined);
  if (row.aar?.status === "final") {
    const blocked = keys.filter((k) => !(LIVE_FIELDS as readonly string[]).includes(k));
    if (blocked.length) throw new ServiceError(409, `${AAR_LOCKED_MESSAGE} Status and closure evidence can still change.`);
  }
  if (row.exerciseId && keys.some((k) => !(LIVE_FIELDS as readonly string[]).includes(k))) {
    await assertExerciseAllowsPlan(db, row.exerciseId);
  }
  await checkLinks(db, row.exerciseId, input);
  const status = input.status ?? row.status;
  const closureEvidence = input.closureEvidence !== undefined ? input.closureEvidence : row.closureEvidence;
  const rejectedReason = input.rejectedReason !== undefined ? input.rejectedReason : row.rejectedReason;
  if (input.status !== undefined || input.closureEvidence !== undefined || input.rejectedReason !== undefined) {
    checkStatusFields(status, closureEvidence, rejectedReason);
  }
  const data: Prisma.ActionItemUncheckedUpdateInput = {};
  const before: Record<string, unknown> = {};
  for (const k of keys) {
    const value = input[k];
    (data as Record<string, unknown>)[k] = value;
    before[k] = (row as unknown as Record<string, unknown>)[k];
  }
  if (input.status !== undefined && input.status !== "rejected" && row.rejectedReason) data.rejectedReason = null;
  if (keys.length) await db.actionItem.update({ where: { id }, data });
  return { changed: keys, before };
}

export interface ActionItemFilters {
  /** open = open or in progress; overdue = open and past due; all = everything. */
  status?: "open" | "overdue" | "done" | "rejected" | "in_progress" | "all";
  exerciseId?: string;
  aarId?: string;
  capabilityId?: string;
  priority?: string;
  /** Only items whose POC email is this address (a reader sees their own). */
  ownerEmail?: string;
}

export const actionItemFiltersSchema = z.object({
  status: z.enum(["open", "overdue", "done", "rejected", "in_progress", "all"]).optional(),
  exerciseId: z.string().max(40).optional(),
  aarId: z.string().max(40).optional(),
  capabilityId: z.string().max(40).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export function filtersFromSearch(params: URLSearchParams): ActionItemFilters {
  const raw: Record<string, string> = {};
  for (const k of ["status", "exerciseId", "aarId", "capabilityId", "priority"]) {
    const v = params.get(k);
    if (v) raw[k] = v;
  }
  return actionItemFiltersSchema.parse(raw);
}

function whereFor(f: ActionItemFilters, now: Date): Prisma.ActionItemWhereInput {
  const where: Prisma.ActionItemWhereInput = {};
  if (f.exerciseId) where.exerciseId = f.exerciseId;
  if (f.aarId) where.aarId = f.aarId;
  if (f.capabilityId) where.capabilityId = f.capabilityId;
  if (f.priority) where.priority = f.priority;
  if (f.ownerEmail !== undefined) {
    if (f.ownerEmail.trim()) where.pocEmail = { equals: f.ownerEmail.trim(), mode: "insensitive" };
    else where.id = { in: [] };
  }
  switch (f.status) {
    case "open":
      where.status = { in: ["open", "in_progress"] };
      break;
    case "overdue":
      where.status = { in: ["open", "in_progress"] };
      where.dueDate = { lt: now };
      break;
    case "done":
    case "rejected":
    case "in_progress":
      where.status = f.status;
      break;
    default:
      break;
  }
  return where;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listActionItems(filters: ActionItemFilters = {}, now = new Date()): Promise<ActionItemRow[]> {
  const rows = await db.actionItem.findMany({
    where: whereFor(filters, now),
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 2000,
    include: {
      exercise: { select: { title: true } },
      aar: { select: { version: true, status: true } },
      capability: { select: { key: true, name: true } },
      objective: { select: { text: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    exerciseId: r.exerciseId,
    exerciseTitle: r.exercise?.title ?? null,
    aarId: r.aarId,
    aarVersion: r.aar?.version ?? null,
    aarStatus: r.aar?.status ?? null,
    capabilityId: r.capabilityId,
    capabilityKey: r.capability?.key ?? null,
    capabilityName: r.capability?.name ?? null,
    objectiveId: r.objectiveId,
    objectiveText: r.objective?.text ?? null,
    afiId: evidenceAfiId(r.evidence),
    afi: r.afi,
    correctiveAction: r.correctiveAction,
    poete: r.poete,
    responsibleOrg: r.responsibleOrg,
    poc: r.poc,
    pocEmail: r.pocEmail,
    startDate: iso(r.startDate),
    dueDate: iso(r.dueDate),
    status: r.status as ActionStatus,
    priority: r.priority,
    closureEvidence: r.closureEvidence,
    rejectedReason: r.rejectedReason,
    overdue: isOverdue(r, now),
    locked: r.aar?.status === "final",
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

const day = (s: string | null) => (s ? s.slice(0, 10) : "");

export const IP_CSV_HEADER = [
  "Capability",
  "Objective",
  "Area for improvement",
  "Corrective action",
  "POETE element",
  "Responsible organization",
  "Point of contact",
  "Start date",
  "Due date",
  "Status",
  "Priority",
  "Closure evidence",
  "Rejection reason",
  "Exercise",
];

export interface IpCsvRow {
  capabilityKey?: string | null;
  capabilityName?: string | null;
  objectiveText?: string | null;
  afi: string;
  correctiveAction: string;
  poete: string | null;
  responsibleOrg: string | null;
  poc: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  closureEvidence: string | null;
  rejectedReason: string | null;
  exerciseTitle?: string | null;
}

export function actionItemsCsv(rows: IpCsvRow[]): string {
  const lines = [IP_CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        [r.capabilityKey, r.capabilityName].filter(Boolean).join(" "),
        r.objectiveText ?? "",
        r.afi,
        r.correctiveAction,
        r.poete ? (POETE_LABELS[r.poete as keyof typeof POETE_LABELS] ?? r.poete) : "",
        r.responsibleOrg ?? "",
        r.poc ?? "",
        day(r.startDate),
        day(r.dueDate),
        ACTION_STATUS_LABELS[r.status as ActionStatus] ?? r.status,
        PRIORITY_LABELS[r.priority as keyof typeof PRIORITY_LABELS] ?? r.priority,
        r.closureEvidence ?? "",
        r.rejectedReason ?? "",
        r.exerciseTitle ?? "",
      ]
        .map((v) => csvCell(String(v)))
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
