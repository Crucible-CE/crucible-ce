// Exercise schedule: planned exercises and recurring series. Route handlers
// call these. One org, wall time in ExerciseSettings.timezone and the RRULE subset in ./recurrence.
//
// A schedule entry never starts an exercise by itself. "Create exercise"
// makes a draft through createExercise, the same path as POST /api/exercises.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/exercise/auth/session";
import { FRAMEWORKS } from "@/lib/exercise/content/frameworks";
import { canReadTemplateSecrets } from "@/lib/exercise/access";
import { createExercise } from "@/lib/exercise/create";
import { ServiceError } from "@/lib/exercise/errors";
import { updateExercise } from "@/lib/exercise/lobby";
import { formatInZone } from "@/lib/exercise/time";
import { joinLink, publicBaseUrl } from "@/lib/exercise/invite";
import { findMode } from "@/lib/exercise/modes/registry";
import { MODES, type Mode } from "@/lib/exercise/runtime/types";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { buildIcsCalendar, markdownToPlain, type IcsEvent } from "./ics";
import {
  RECURRENCES,
  RECURRENCE_LABELS,
  buildRrule,
  currentOccurrence,
  instantOf,
  occurrencesBetween,
  parseRrule,
  parseWallTime,
  recurrenceOf,
  wallDateTimeStrings,
  type Recurrence,
} from "./recurrence";

export const MODE_NAMES: Record<Mode, string> = { crisissim: "Crisis Sim", document: "Playbook Exercise", strategic: "Strategic TTX" };

const FRAMEWORK_IDS = FRAMEWORKS.map((f) => f.id) as string[];
const FRAMEWORK_LABEL = new Map(FRAMEWORKS.map((f) => [f.id as string, f.label]));

/** How far ahead calendars list occurrences of a series. */
const HORIZON_MS = 400 * 86_400_000;
const MAX_OCCURRENCES_PER_ENTRY = 12;
const MAX_FEED_EVENTS = 500;

const id = z.string().trim().min(1).max(64);

export const scheduleInputSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a title.").max(200),
    mode: z.enum(MODES),
    templateId: id.nullable().default(null),
    /** Wall date and time in ExerciseSettings.timezone. */
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time."),
    durationMin: z.number().int().min(15, "Use 15 minutes or more.").max(24 * 60, "Use 24 hours or less."),
    recurrence: z.enum(RECURRENCES).default("none"),
    teams: z.array(z.string().trim().min(1, "Name every team.").max(60)).max(10).default([]),
    documentIds: z.array(id).max(10).default([]),
    frameworkKeys: z
      .array(z.string().refine((k) => FRAMEWORK_IDS.includes(k), "Pick a listed framework."))
      .max(FRAMEWORK_IDS.length)
      .default([]),
    briefMd: z.string().max(6000, "Use 6000 characters or fewer.").nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .strict();
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export const scheduleToggleSchema = z.object({ isActive: z.boolean() }).strict();

export interface ScheduleView {
  id: string;
  title: string;
  mode: Mode;
  modeLabel: string;
  templateId: string | null;
  templateTitle: string | null;
  templateStatus: string | null;
  /** Series start (or the one-off date) as wall time in the organization zone. */
  startDate: string;
  startTime: string;
  durationMin: number;
  recurrence: Recurrence;
  recurrenceLabel: string;
  /** The occurrence this entry points at now, ISO. Null for a past one-off. */
  nextAt: string | null;
  nextLabel: string | null;
  /** Up to three upcoming occurrences, ISO. */
  upcoming: string[];
  isPast: boolean;
  teams: string[];
  documents: Array<{ id: string; title: string }>;
  frameworks: Array<{ key: string; label: string }>;
  briefMd: string | null;
  isActive: boolean;
  timezone: string;
}

type Row = Prisma.ExerciseScheduleGetPayload<{ include: { template: { select: { title: true; status: true } } } }>;

function strings(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];
}

export async function instanceTimezone(): Promise<string> {
  const i = await getExerciseSettings();
  return i?.timezone ?? "UTC";
}

/** The occurrence an entry points at now. Computed from the rule so it does not wait for the cron. */
export function effectiveNext(row: Pick<Row, "rrule" | "nextAt" | "durationMin">, now: Date): Date | null {
  const rule = parseRrule(row.rrule);
  if (rule) return currentOccurrence(rule, now, row.durationMin);
  return row.nextAt;
}

/** Upcoming occurrences within the calendar horizon. A one-off gives its single date when it has not ended. */
export function upcomingOccurrences(row: Pick<Row, "rrule" | "nextAt" | "durationMin">, now: Date, max: number): Date[] {
  const rule = parseRrule(row.rrule);
  const from = new Date(now.getTime() - row.durationMin * 60_000);
  if (rule) return occurrencesBetween(rule, from, new Date(now.getTime() + HORIZON_MS), max);
  return row.nextAt && row.nextAt.getTime() > from.getTime() ? [row.nextAt] : [];
}

function toView(row: Row, docs: Map<string, string>, tz: string, now: Date): ScheduleView {
  const rule = parseRrule(row.rrule);
  const next = effectiveNext(row, now);
  const startWall = rule
    ? { date: `${rule.start.y}-${String(rule.start.m).padStart(2, "0")}-${String(rule.start.d).padStart(2, "0")}`, time: `${String(rule.start.h).padStart(2, "0")}:${String(rule.start.mi).padStart(2, "0")}` }
    : row.nextAt
      ? wallDateTimeStrings(row.nextAt, tz)
      : { date: "", time: "" };
  const isPast = !next || next.getTime() + row.durationMin * 60_000 <= now.getTime();
  const recurrence = recurrenceOf(row.rrule);
  const mode = (MODES as readonly string[]).includes(row.mode) ? (row.mode as Mode) : "crisissim";
  return {
    id: row.id,
    title: row.title,
    mode,
    modeLabel: MODE_NAMES[mode],
    templateId: row.templateId,
    templateTitle: row.template?.title ?? null,
    templateStatus: row.template?.status ?? null,
    startDate: startWall.date,
    startTime: startWall.time,
    durationMin: row.durationMin,
    recurrence,
    recurrenceLabel: RECURRENCE_LABELS[recurrence],
    nextAt: next?.toISOString() ?? null,
    nextLabel: next ? formatInZone(next, rule?.tz ?? tz) : null,
    upcoming: upcomingOccurrences(row, now, 3).map((d) => d.toISOString()),
    isPast,
    teams: strings(row.teams, 10),
    documents: strings(row.documents, 10).map((d) => ({ id: d, title: docs.get(d) ?? "Removed document" })),
    frameworks: row.frameworkKeys.map((k) => ({ key: k, label: FRAMEWORK_LABEL.get(k) ?? k })),
    briefMd: row.briefMd,
    isActive: row.isActive,
    timezone: rule?.tz ?? tz,
  };
}

async function documentTitles(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.sourceDocument.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
  return new Map(rows.map((r) => [r.id, r.title]));
}

const INCLUDE = { template: { select: { title: true, status: true } } } as const;

/** Every entry, upcoming first, then past one-offs, then paused ones. */
export async function listSchedules(now = new Date()): Promise<ScheduleView[]> {
  const rows = await db.exerciseSchedule.findMany({ include: INCLUDE, orderBy: { nextAt: "asc" }, take: 500 });
  const tz = await instanceTimezone();
  const docs = await documentTitles([...new Set(rows.flatMap((r) => strings(r.documents, 10)))]);
  const views = rows.map((r) => toView(r, docs, tz, now));
  const rank = (v: ScheduleView) => (!v.isActive ? 2 : v.isPast ? 1 : 0);
  const at = (v: ScheduleView) => (v.nextAt ? Date.parse(v.nextAt) : 0);
  // Upcoming soonest first; past one-offs most recent first.
  return views.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? at(b) - at(a) : at(a) - at(b)));
}

export async function getSchedule(scheduleId: string, now = new Date()): Promise<ScheduleView> {
  const row = await db.exerciseSchedule.findUnique({ where: { id: scheduleId }, include: INCLUDE });
  if (!row) throw new ServiceError(404, "Schedule entry not found.");
  const tz = await instanceTimezone();
  return toView(row, await documentTitles(strings(row.documents, 10)), tz, now);
}

/** The template's executive brief, the default pre-read. */
export async function templateBrief(templateId: string): Promise<string | null> {
  const t = await db.exerciseTemplate.findUnique({ where: { id: templateId }, select: { config: true } });
  const brief = (t?.config as { executiveBriefMd?: unknown } | null)?.executiveBriefMd;
  return typeof brief === "string" && brief.trim() ? brief.slice(0, 6000) : null;
}

async function toData(input: ScheduleInput, tz: string, now: Date) {
  const wall = parseWallTime(input.startDate, input.startTime);
  if (!wall) throw new ServiceError(400, "That date does not exist. Pick another date.");
  if (input.templateId) {
    const t = await db.exerciseTemplate.findUnique({ where: { id: input.templateId }, select: { mode: true, status: true } });
    if (!t) throw new ServiceError(404, "Template not found.");
    if (t.mode !== input.mode) throw new ServiceError(400, "That template is for a different exercise type.");
    if (t.status === "archived") throw new ServiceError(409, "That template is archived. Pick another one.");
  }
  const documentIds = [...new Set(input.documentIds)];
  if (documentIds.length) {
    const found = await db.sourceDocument.count({ where: { id: { in: documentIds } } });
    if (found !== documentIds.length) throw new ServiceError(400, "A document in the list does not exist.");
  }
  const teams = [...new Set(input.teams.map((t) => t.trim()))];
  if (teams.length !== input.teams.length) throw new ServiceError(400, "Give every team a different name.");
  const rrule = buildRrule(input.recurrence, wall, tz);
  const rule = parseRrule(rrule);
  const nextAt = rule ? currentOccurrence(rule, now, input.durationMin) : instantOf(wall, tz);
  let briefMd = input.briefMd?.trim() ? input.briefMd.trim() : null;
  if (!briefMd && input.templateId) briefMd = await templateBrief(input.templateId);
  return {
    title: input.title,
    mode: input.mode,
    templateId: input.templateId,
    rrule,
    nextAt,
    durationMin: input.durationMin,
    teams,
    documents: documentIds,
    frameworkKeys: [...new Set(input.frameworkKeys)],
    briefMd,
    isActive: input.isActive,
  };
}

export async function createSchedule(input: ScheduleInput, now = new Date()): Promise<string> {
  const tz = await instanceTimezone();
  const row = await db.exerciseSchedule.create({ data: await toData(input, tz, now), select: { id: true } });
  return row.id;
}

export async function updateSchedule(scheduleId: string, input: ScheduleInput | { isActive: boolean }, now = new Date()): Promise<void> {
  const existing = await db.exerciseSchedule.findUnique({ where: { id: scheduleId }, select: { id: true, rrule: true } });
  if (!existing) throw new ServiceError(404, "Schedule entry not found.");
  if (!("title" in input)) {
    await db.exerciseSchedule.update({ where: { id: scheduleId }, data: { isActive: input.isActive } });
    return;
  }
  // A series keeps its own zone when it is edited; a new one takes the organization zone.
  const tz = parseRrule(existing.rrule)?.tz ?? (await instanceTimezone());
  await db.exerciseSchedule.update({ where: { id: scheduleId }, data: await toData(input, tz, now) });
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  const r = await db.exerciseSchedule.deleteMany({ where: { id: scheduleId } });
  if (r.count === 0) throw new ServiceError(404, "Schedule entry not found.");
}

// ---------------------------------------------------------------------------
// Create an exercise from an entry
// ---------------------------------------------------------------------------

/**
 * Make a draft exercise from a schedule entry with createExercise (the
 * POST /api/exercises path). The entry's teams apply only when the template
 * brings none, so template team names (quality tables, variants) stay intact.
 */
export async function launchFromSchedule(scheduleId: string, user: SessionUser): Promise<{ id: string }> {
  const s = await db.exerciseSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new ServiceError(404, "Schedule entry not found.");
  const mode = s.mode as Mode;
  if (!(MODES as readonly string[]).includes(mode)) throw new ServiceError(400, "This exercise type is not available.");
  const docs = strings(s.documents, 10);
  if ((mode === "crisissim" || mode === "strategic") && !s.templateId) throw new ServiceError(400, "Pick a template for this entry first.");
  if (mode === "document" && !s.templateId && docs.length === 0) throw new ServiceError(400, "Pick a template or a document for this entry first.");
  if (s.templateId && !(await canReadTemplateSecrets(user.id, s.templateId))) {
    throw new ServiceError(403, "You are playing in an exercise that uses this template.");
  }
  // The entry's start becomes the exercise start time for invites.
  const start = effectiveNext(s, new Date());
  const { id } = await createExercise(
    {
      mode,
      title: s.title,
      ...(start ? { plan: { startsAt: start.toISOString() } } : {}),
      ...(s.templateId ? { templateId: s.templateId } : {}),
      ...(mode === "document" && !s.templateId ? { sourceDocumentId: docs[0] } : {}),
    },
    user,
  );
  const teams = strings(s.teams, 10);
  if (teams.length && findMode(mode)?.caps.teams) {
    const existing = await db.team.count({ where: { exerciseId: id } });
    if (existing === 0) await updateExercise(id, { teams: teams.map((name) => ({ name })) });
  }
  return { id };
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

type JoinInfo = { url: string; code: string };

/** Plain text DESCRIPTION: the join link when an exercise exists, the pre-read brief, then the facts. */
export function eventDescription(
  v: Pick<ScheduleView, "briefMd" | "modeLabel" | "templateTitle" | "teams" | "documents" | "frameworks" | "durationMin">,
  join: JoinInfo | null = null,
): string {
  const head = join ? `Join: ${join.url}\nCode: ${join.code}\n\n` : "";
  const facts = [
    `Type: ${v.modeLabel}`,
    v.templateTitle ? `Template: ${v.templateTitle}` : null,
    `Duration: ${v.durationMin} minutes`,
    v.teams.length ? `Teams: ${v.teams.join(", ")}` : null,
    v.documents.length ? `Documents: ${v.documents.map((d) => d.title).join(", ")}` : null,
    v.frameworks.length ? `Frameworks: ${v.frameworks.map((f) => f.label).join(", ")}` : null,
  ].filter((x): x is string => Boolean(x));
  const brief = v.briefMd?.trim() ? `Pre-read\n\n${markdownToPlain(v.briefMd)}\n\n` : "";
  return `${head}${brief}${facts.join("\n")}`;
}

export function eventsFor(v: ScheduleView, row: Pick<Row, "rrule" | "nextAt" | "durationMin">, now: Date, join: JoinInfo | null = null): IcsEvent[] {
  const base = publicBaseUrl();
  const description = eventDescription(v, join);
  return upcomingOccurrences(row, now, MAX_OCCURRENCES_PER_ENTRY).map((start) => ({
    uid: `schedule-${v.id}-${start.toISOString().slice(0, 10).replace(/-/g, "")}`,
    title: v.title,
    start,
    durationMinutes: v.durationMin,
    description,
    url: base ? `${base}/schedule` : null,
  }));
}

/**
 * Join links for entries that already have an exercise: the newest one
 * launched from the entry (exercise.created audit rows carry the entry id)
 * that is not over and has join by code on. Needs PUBLIC_URL.
 */
export async function scheduleJoinLinks(scheduleIds: string[]): Promise<Map<string, JoinInfo>> {
  const out = new Map<string, JoinInfo>();
  const base = publicBaseUrl();
  if (!base || scheduleIds.length === 0) return out;
  const wanted = new Set(scheduleIds);
  const launches = await db.adminAuditLog.findMany({
    where: { action: "exercise.created", targetType: "Exercise" },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { targetId: true, metadataJson: true },
  });
  const bySchedule = new Map<string, string[]>();
  for (const l of launches) {
    const sid = (l.metadataJson as { scheduleId?: unknown } | null)?.scheduleId;
    if (typeof sid !== "string" || !wanted.has(sid) || !l.targetId) continue;
    bySchedule.set(sid, [...(bySchedule.get(sid) ?? []), l.targetId]);
  }
  const ids = [...new Set([...bySchedule.values()].flat())];
  if (ids.length === 0) return out;
  const open = await db.exercise.findMany({
    where: { id: { in: ids }, guestJoin: true, joinCode: { not: null }, status: { in: ["draft", "lobby", "live", "paused"] } },
    select: { id: true, joinCode: true },
  });
  const codes = new Map(open.map((e) => [e.id, e.joinCode!]));
  for (const [sid, exIds] of bySchedule) {
    const hit = exIds.find((x) => codes.has(x));
    if (hit) out.set(sid, { url: joinLink(base, codes.get(hit)!), code: codes.get(hit)! });
  }
  return out;
}

async function calendarName(): Promise<string> {
  const i = await getExerciseSettings();
  return `${i?.name ?? "Crucible CE"} exercises`;
}

/** One entry's upcoming occurrences as a calendar file. */
export async function scheduleIcs(scheduleId: string, now = new Date()): Promise<{ title: string; ics: string }> {
  const row = await db.exerciseSchedule.findUnique({ where: { id: scheduleId }, include: INCLUDE });
  if (!row) throw new ServiceError(404, "Schedule entry not found.");
  const tz = await instanceTimezone();
  const v = toView(row, await documentTitles(strings(row.documents, 10)), tz, now);
  const join = (await scheduleJoinLinks([row.id])).get(row.id) ?? null;
  const events = eventsFor(v, row, now, join);
  if (events.length === 0) throw new ServiceError(409, "This entry has no upcoming date. Edit the date first.");
  return { title: row.title, ics: buildIcsCalendar({ name: await calendarName(), events, now }) };
}

/** Every active entry's upcoming occurrences, for the subscription feed. */
export async function feedIcs(now = new Date()): Promise<string> {
  const rows = await db.exerciseSchedule.findMany({ where: { isActive: true }, include: INCLUDE, orderBy: { nextAt: "asc" }, take: 500 });
  const tz = await instanceTimezone();
  const docs = await documentTitles([...new Set(rows.flatMap((r) => strings(r.documents, 10)))]);
  const joins = await scheduleJoinLinks(rows.map((r) => r.id));
  const events: IcsEvent[] = [];
  for (const row of rows) {
    if (events.length >= MAX_FEED_EVENTS) break;
    events.push(...eventsFor(toView(row, docs, tz, now), row, now, joins.get(row.id) ?? null));
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return buildIcsCalendar({ name: await calendarName(), events: events.slice(0, MAX_FEED_EVENTS), now, refreshHours: 1 });
}
