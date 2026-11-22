// Executive dashboard: incident KPIs, the exercise program, the improvement
// plan and the readiness score on one page. Plain aggregation, no AI. The
// route checks the viewer (reports.view); incident numbers count only the
// incidents that viewer can see.

import { db } from "@/lib/db";
import { accessibleIncidentsWhere, type AccessUser } from "@/lib/incident/access";
import { isClosedStatus } from "@/lib/incident/status";
import { computeIncidentMetrics } from "@/lib/metrics/incident-metrics";
import { loadSlaHeadlines } from "@/lib/ops-room/sla-summary";
import { buildProgramReport, type CadenceRow, type ProgramReport } from "./report";
import { currentReadiness, readinessWindow } from "@/lib/exercise/readiness/inputs";
import { readinessTrend, type ReadinessTrendPoint } from "@/lib/exercise/readiness/snapshot";
import type { ReadinessResult } from "@/lib/exercise/readiness/score";

/** MTTA and MTTR cover incidents opened in this many days. */
export const INCIDENT_WINDOW_DAYS = 90;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;

export interface ExecutiveDashboard {
  generatedAt: string;
  instanceName: string;
  marking: string;
  window: { from: string; to: string };
  incidents: {
    open: number;
    bySeverity: Record<string, number>;
    slaBreached: number;
    windowDays: number;
    mttaMinutes: number | null;
    mttrMinutes: number | null;
  };
  program: {
    lastExerciseAt: string | null;
    exercises: number;
    byMode: Record<string, number>;
    cadence: CadenceRow[];
    cadenceSummary: { current: number; dueSoon: number; overdue: number };
    roles: ProgramReport["roles"];
  };
  improvement: {
    open: number;
    overdue: number;
    openHigh: number;
    aging: Record<string, number>;
    findings: ProgramReport["findings"];
  };
  readiness: ReadinessResult;
  trend: ReadinessTrendPoint[];
}

/** "2 h 05 min", "45 min", or "None". */
export function minutesText(m: number | null): string {
  if (m === null) return "None";
  const total = Math.round(m);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  return `${h} h ${String(total % 60).padStart(2, "0")} min`;
}

/** Count by key. Pure. */
export function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[key(it)] = (out[key(it)] ?? 0) + 1;
  return out;
}

/** Current, due soon, and overdue or never tested. Pure. */
export function cadenceSummary(rows: Array<{ status: string }>): { current: number; dueSoon: number; overdue: number } {
  return {
    current: rows.filter((r) => r.status === "current").length,
    dueSoon: rows.filter((r) => r.status === "due_soon").length,
    overdue: rows.filter((r) => r.status === "overdue" || r.status === "never").length,
  };
}

async function incidentKpis(user: AccessUser, now: Date): Promise<ExecutiveDashboard["incidents"]> {
  const [openRows, metrics] = await Promise.all([
    db.incident.findMany({
      where: { ...accessibleIncidentsWhere(user, { excludeTraining: true }), status: { not: "closed" } },
      select: { id: true, status: true, severity: true, createdAt: true, declaredAt: true, containedAt: true, resolvedAt: true, closedAt: true },
      take: 2000,
    }),
    computeIncidentMetrics(user, { windowDays: INCIDENT_WINDOW_DAYS }),
  ]);
  const open = openRows.filter((i) => !isClosedStatus(i.status));
  const bySeverity: Record<string, number> = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const i of open) bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  const sla = user.organizationId ? await loadSlaHeadlines(user.organizationId, open, now) : new Map();
  return {
    open: open.length,
    bySeverity,
    slaBreached: [...sla.values()].filter((h) => h.state === "breached").length,
    windowDays: INCIDENT_WINDOW_DAYS,
    mttaMinutes: metrics.mttaMinutes,
    mttrMinutes: metrics.mttrMinutes,
  };
}

export async function buildExecutiveDashboard(user: AccessUser, now: Date = new Date()): Promise<ExecutiveDashboard> {
  const report = await buildProgramReport(readinessWindow(now), now);
  const [incidents, readiness, trend] = await Promise.all([incidentKpis(user, now), currentReadiness(now, report), readinessTrend(now)]);
  return {
    generatedAt: now.toISOString(),
    instanceName: report.instanceName,
    marking: report.marking,
    window: report.window,
    incidents,
    program: {
      lastExerciseAt: report.lastTestedAt,
      exercises: report.exercises.length,
      byMode: countBy(report.exercises, (e) => e.mode),
      cadence: report.cadence,
      cadenceSummary: cadenceSummary(report.cadence),
      roles: report.roles,
    },
    improvement: {
      open: report.actionItems.open,
      overdue: report.actionItems.overdue,
      openHigh: report.actionItems.openHigh,
      aging: report.actionItems.aging,
      findings: report.findings,
    },
    readiness,
    trend,
  };
}
