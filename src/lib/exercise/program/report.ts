// Program report: exercise history, last test date
// per framework control, cadence against policy, required-role coverage,
// open and overdue action items, remediation aging. Pure helpers are exported
// for tests; buildProgramReport reads the database.
//
// Cadence rule: an exercise tests a framework when its final AAR maps at least
// one control of that framework. A cadence control (for example PCI DSS
// 12.10.2, "test the IR plan every 12 months") counts as tested on the latest
// such exercise, or on the latest exercise that maps that control directly.

import { db } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { getFramework, listCadenceControls, type Control } from "@/lib/exercise/content/frameworks";
import { aarSectionsSchema } from "@/lib/exercise/aar/schema";
import { findingCounts } from "@/lib/exercise/aar/findings";
import { cadenceMonths, readPolicy } from "./policy";

/** An ended exercise this many days old should have a draft report. */
export const AAR_DRAFT_DUE_DAYS = 30;
/** And a final report by this many days. */
export const AAR_FINAL_DUE_DAYS = 90;

export interface AarOverdue {
  id: string;
  title: string;
  endedAt: string;
  days: number;
  missing: "draft" | "final";
}

/** Exercises ended over 30 days ago with no report, or over 90 days ago with no final report. Pure. */
export function overdueReports(
  exercises: Array<{ id: string; title: string; endedAt: Date | null; aars: Array<{ status: string }> }>,
  now: Date,
): AarOverdue[] {
  const out: AarOverdue[] = [];
  for (const e of exercises) {
    if (!e.endedAt) continue;
    const days = Math.floor((now.getTime() - e.endedAt.getTime()) / DAY_MS);
    const hasFinal = e.aars.some((a) => a.status === "final");
    if (e.aars.length === 0 && days > AAR_DRAFT_DUE_DAYS) out.push({ id: e.id, title: e.title, endedAt: e.endedAt.toISOString(), days, missing: "draft" });
    else if (!hasFinal && days > AAR_FINAL_DUE_DAYS) out.push({ id: e.id, title: e.title, endedAt: e.endedAt.toISOString(), days, missing: "final" });
  }
  return out.sort((a, b) => b.days - a.days);
}

/**
 * Controls a final report counts as tested: its control mapping, plus the
 * requirements its plan named (tested unless the mapping shows a gap). Pure.
 */
export function finalReportControls(sections: {
  controlMapping: Array<{ framework: string; controlId: string; title: string; status: "tested" | "gap" }>;
  overview: { requirements?: Array<{ framework: string; controlId: string; title: string }> };
}): Array<{ framework: string; controlId: string; title: string; status: "tested" | "gap" }> {
  const out = new Map(sections.controlMapping.map((c) => [`${c.framework}:${c.controlId}`, c]));
  for (const r of sections.overview.requirements ?? []) {
    const key = `${r.framework}:${r.controlId}`;
    if (!out.has(key)) out.set(key, { framework: r.framework, controlId: r.controlId, title: r.title, status: "tested" });
  }
  return [...out.values()];
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DUE_SOON_DAYS = 30;

/** Add calendar months in UTC, clamping to the last day of the target month. */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

export type CadenceStatus = "current" | "due_soon" | "overdue" | "never";

export interface CadenceResult {
  lastTested: Date | null;
  dueAt: Date | null;
  status: CadenceStatus;
  daysLeft: number | null;
}

export function cadenceStatus(lastTested: Date | null, months: number, now: Date): CadenceResult {
  if (!lastTested) return { lastTested: null, dueAt: null, status: "never", daysLeft: null };
  const dueAt = addMonths(lastTested, months);
  const daysLeft = Math.floor((dueAt.getTime() - now.getTime()) / DAY_MS);
  const status: CadenceStatus = dueAt.getTime() < now.getTime() ? "overdue" : daysLeft <= DUE_SOON_DAYS ? "due_soon" : "current";
  return { lastTested, dueAt, status, daysLeft };
}

/** "PCI DSS v4.0 12.10.2 last tested 2026-03-04, due 2027-03-04" */
export function cadenceSentence(label: string, r: CadenceResult): string {
  if (!r.lastTested || !r.dueAt) return `${label} has not been tested`;
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return `${label} last tested ${d(r.lastTested)}, due ${d(r.dueAt)}`;
}

export const AGING_BUCKETS = [
  { key: "0-30", label: "0 to 30 days", max: 30 },
  { key: "31-60", label: "31 to 60 days", max: 60 },
  { key: "61-90", label: "61 to 90 days", max: 90 },
  { key: "90+", label: "Over 90 days", max: Number.POSITIVE_INFINITY },
] as const;

/** Count open items by age since they were opened (startDate, else createdAt). */
export function agingBuckets(items: Array<{ status: string; createdAt: Date; startDate?: Date | null }>, now: Date): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0]));
  for (const it of items) {
    if (it.status !== "open" && it.status !== "in_progress") continue;
    const from = it.startDate && it.startDate.getTime() <= now.getTime() ? it.startDate : it.createdAt;
    const age = Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS));
    const bucket = AGING_BUCKETS.find((b) => age <= b.max)!;
    out[bucket.key]++;
  }
  return out;
}

export interface TestRecord {
  exerciseId: string;
  testedAt: Date;
  controls: Array<{ framework: string; controlId: string }>;
}

export interface CadenceRow {
  framework: string;
  frameworkLabel: string;
  controlId: string | null;
  controlTitle: string | null;
  months: number;
  lastTested: string | null;
  dueAt: string | null;
  status: CadenceStatus;
  daysLeft: number | null;
  sentence: string;
}

/** Cadence rows for the enabled frameworks. Pure. */
export function cadenceRows(
  enabledFrameworks: string[],
  policy: { cadence: Record<string, number> },
  tests: TestRecord[],
  now: Date,
  controlsFor: (fw: string) => Control[] = listCadenceControls,
): CadenceRow[] {
  const rows: CadenceRow[] = [];
  for (const fw of enabledFrameworks) {
    const months = cadenceMonths(policy, fw);
    if (!months) continue;
    const label = getFramework(fw)?.label ?? fw;
    const fwDates = tests.filter((t) => t.controls.some((c) => c.framework === fw)).map((t) => t.testedAt.getTime());
    const fwLast = fwDates.length ? Math.max(...fwDates) : null;
    const controls = controlsFor(fw);
    const targets: Array<{ controlId: string | null; title: string | null; months: number }> = controls.length
      ? controls.map((c) => ({ controlId: c.controlId, title: c.title, months: policy.cadence[fw] ?? c.testCadence?.months ?? months }))
      : [{ controlId: null, title: null, months }];
    for (const t of targets) {
      const direct = t.controlId
        ? tests.filter((x) => x.controls.some((c) => c.framework === fw && c.controlId === t.controlId)).map((x) => x.testedAt.getTime())
        : [];
      const candidates = [...direct, ...(fwLast !== null ? [fwLast] : [])];
      const last = candidates.length ? new Date(Math.max(...candidates)) : null;
      const r = cadenceStatus(last, t.months, now);
      const name = t.controlId ? `${label} ${t.controlId}` : label;
      rows.push({
        framework: fw,
        frameworkLabel: label,
        controlId: t.controlId,
        controlTitle: t.title,
        months: t.months,
        lastTested: r.lastTested?.toISOString() ?? null,
        dueAt: r.dueAt?.toISOString() ?? null,
        status: r.status,
        daysLeft: r.daysLeft,
        sentence: cadenceSentence(name, r),
      });
    }
  }
  return rows;
}

export interface ProgramReport {
  window: { from: string; to: string };
  generatedAt: string;
  instanceName: string;
  timezone: string;
  exercises: Array<{
    id: string;
    title: string;
    mode: string;
    startedAt: string | null;
    endedAt: string | null;
    participants: number;
    aarStatus: string | null;
    aarVersion: number | null;
    openItems: number;
  }>;
  lastTestedAt: string | null;
  controls: Array<{ framework: string; frameworkLabel: string; controlId: string; title: string; lastTested: string; result: "tested" | "gap" }>;
  cadence: CadenceRow[];
  roles: Array<{ role: string; present: number; total: number; lastPresentAt: string | null }>;
  roleWindow: { from: string; to: string };
  actionItems: { open: number; overdue: number; openHigh: number; done: number; rejected: number; aging: Record<string, number> };
  /** Findings in final reports of exercises in the window: accepted, with an action item, with "No action needed", rejected. */
  findings: { accepted: number; actionItems: number; noAction: number; rejected: number };
  overdueItems: Array<{ id: string; correctiveAction: string; poc: string | null; dueDate: string | null; priority: string; exerciseTitle: string | null }>;
  participantsInWindow: number;
  /** Reports past due: no draft 30 days after ENDEX, no final 90 days after. */
  aarOverdue: AarOverdue[];
  /** Signing keys, current and past. Bundles verify against these IDs. */
  signingKeys: Array<{ keyId: string; createdAt: string; retiredAt: string | null }>;
  /** Organization confidentiality marking for exports. */
  marking: string;
}

function roleMatches(role: string, p: { title: string | null; roles: string[] }): boolean {
  const r = role.trim().toLowerCase();
  if (!r) return false;
  if (p.roles.some((x) => x.toLowerCase() === r || x.replace(/_/g, " ").toLowerCase() === r)) return true;
  return Boolean(p.title && p.title.toLowerCase().includes(r));
}

export async function buildProgramReport(window: { from: Date; to: Date }, now = new Date()): Promise<ProgramReport> {
  const instance = await getExerciseSettings();
  const policy = readPolicy(instance?.policy);
  const enabled = instance?.enabledFrameworks ?? [];
  const roleFrom = new Date(window.to.getTime() - 365 * DAY_MS);

  // Every non-practice ended exercise up to the window end: history drives cadence.
  const exercises = await db.exercise.findMany({
    where: { isPractice: false, status: "ended", endedAt: { lte: window.to } },
    orderBy: { endedAt: "desc" },
    select: {
      id: true,
      title: true,
      mode: true,
      startedAt: true,
      endedAt: true,
      participants: { where: { removedAt: null }, select: { joinedAt: true, title: true, roles: true } },
      aars: { orderBy: { version: "desc" }, select: { version: true, status: true, sections: true, finalizedAt: true } },
      actionItems: { where: { status: { in: ["open", "in_progress"] } }, select: { id: true } },
    },
    take: 2000,
  });

  const tests: TestRecord[] = [];
  const controlLast = new Map<string, { framework: string; controlId: string; title: string; at: Date; result: "tested" | "gap" }>();
  for (const ex of exercises) {
    const final = ex.aars.find((a) => a.status === "final");
    if (!final || !ex.endedAt) continue;
    const parsed = aarSectionsSchema.safeParse(final.sections);
    if (!parsed.success) continue;
    const mapped = finalReportControls(parsed.data).filter((c) => enabled.includes(c.framework));
    tests.push({ exerciseId: ex.id, testedAt: ex.endedAt, controls: mapped.map((c) => ({ framework: c.framework, controlId: c.controlId })) });
    for (const c of mapped) {
      const key = `${c.framework}|${c.controlId}`;
      const prev = controlLast.get(key);
      if (!prev || prev.at < ex.endedAt) controlLast.set(key, { framework: c.framework, controlId: c.controlId, title: c.title, at: ex.endedAt, result: c.status });
    }
  }

  const inWindow = exercises.filter((e) => e.endedAt && e.endedAt >= window.from && e.endedAt <= window.to);
  const inRoleWindow = exercises.filter((e) => e.endedAt && e.endedAt >= roleFrom && e.endedAt <= window.to);

  const roles = policy.requiredRoles.map((role) => {
    let present = 0;
    let last: Date | null = null;
    for (const ex of inRoleWindow) {
      const latest = ex.aars[0];
      const parsed = latest ? aarSectionsSchema.safeParse(latest.sections) : null;
      const fromAar = parsed?.success ? parsed.data.requiredRoles.find((r) => r.role.toLowerCase() === role.toLowerCase()) : undefined;
      const hit = fromAar ? fromAar.present : ex.participants.some((p) => p.joinedAt && roleMatches(role, p));
      if (hit) {
        present++;
        if (!last || (ex.endedAt && ex.endedAt > last)) last = ex.endedAt;
      }
    }
    return { role, present, total: inRoleWindow.length, lastPresentAt: last?.toISOString() ?? null };
  });

  const items = await db.actionItem.findMany({
    select: {
      id: true,
      status: true,
      priority: true,
      dueDate: true,
      startDate: true,
      createdAt: true,
      correctiveAction: true,
      poc: true,
      exercise: { select: { title: true, isPractice: true } },
    },
  });
  const live = items.filter((i) => !i.exercise?.isPractice);
  const open = live.filter((i) => i.status === "open" || i.status === "in_progress");
  const overdue = open.filter((i) => i.dueDate && i.dueDate < now);

  const findings = { accepted: 0, actionItems: 0, noAction: 0, rejected: 0 };
  for (const ex of inWindow) {
    const final = ex.aars.find((a) => a.status === "final");
    const parsed = final ? aarSectionsSchema.safeParse(final.sections) : null;
    if (!parsed?.success) continue;
    const c = findingCounts(parsed.data);
    findings.accepted += c.accepted;
    findings.actionItems += c.actionItems;
    findings.noAction += c.noAction;
    findings.rejected += c.rejected;
  }

  const lastTested = exercises.find((e) => e.endedAt)?.endedAt ?? null;
  const keys = await db.signingKey.findMany({ orderBy: { createdAt: "desc" }, select: { keyId: true, createdAt: true, retiredAt: true } });

  return {
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    generatedAt: now.toISOString(),
    instanceName: instance?.name ?? "Crucible CE",
    timezone: instance?.timezone ?? "UTC",
    exercises: inWindow.map((e) => ({
      id: e.id,
      title: e.title,
      mode: e.mode,
      startedAt: e.startedAt?.toISOString() ?? null,
      endedAt: e.endedAt?.toISOString() ?? null,
      participants: e.participants.filter((p) => p.joinedAt).length,
      aarStatus: e.aars[0]?.status ?? null,
      aarVersion: e.aars[0]?.version ?? null,
      openItems: e.actionItems.length,
    })),
    lastTestedAt: lastTested?.toISOString() ?? null,
    controls: [...controlLast.values()]
      .sort((a, b) => (a.framework === b.framework ? a.controlId.localeCompare(b.controlId) : a.framework.localeCompare(b.framework)))
      .map((c) => ({
        framework: c.framework,
        frameworkLabel: getFramework(c.framework)?.label ?? c.framework,
        controlId: c.controlId,
        title: c.title,
        lastTested: c.at.toISOString(),
        result: c.result,
      })),
    cadence: cadenceRows(enabled, policy, tests, now),
    roles,
    roleWindow: { from: roleFrom.toISOString(), to: window.to.toISOString() },
    actionItems: {
      open: open.length,
      overdue: overdue.length,
      openHigh: open.filter((i) => i.priority === "high").length,
      done: live.filter((i) => i.status === "done").length,
      rejected: live.filter((i) => i.status === "rejected").length,
      aging: agingBuckets(open, now),
    },
    findings,
    overdueItems: overdue
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0))
      .slice(0, 50)
      .map((i) => ({
        id: i.id,
        correctiveAction: i.correctiveAction,
        poc: i.poc,
        dueDate: i.dueDate?.toISOString() ?? null,
        priority: i.priority,
        exerciseTitle: i.exercise?.title ?? null,
      })),
    participantsInWindow: inWindow.reduce((n, e) => n + e.participants.filter((p) => p.joinedAt).length, 0),
    aarOverdue: overdueReports(exercises, now),
    signingKeys: keys.map((k) => ({ keyId: k.keyId, createdAt: k.createdAt.toISOString(), retiredAt: k.retiredAt?.toISOString() ?? null })),
    marking: policy.confidentialityMarking,
  };
}

/** Parse ?from=YYYY-MM-DD&to=YYYY-MM-DD. Defaults to the last 12 months. */
export function reportWindow(params: URLSearchParams, now = new Date()): { from: Date; to: Date } {
  const parse = (v: string | null, endOfDay: boolean) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(`${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const to = parse(params.get("to"), true) ?? now;
  const from = parse(params.get("from"), false) ?? addMonths(to, -12);
  return from <= to ? { from, to } : { from: to, to: from };
}
