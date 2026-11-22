// incident metrics engine. One pure(ish) computation behind the admin
// metrics API, the CSV export, the board report, and /metrics. Bucketing and
// rollups happen in JS (not SQL date_trunc) so the engine is testable and
// timezone-consistent (UTC bucket boundaries).

import { db } from "@/lib/db";
import { accessibleIncidentsWhere, type AccessUser } from "@/lib/incident/access";
import { isClosedStatus } from "@/lib/incident/status";

export type Bucket = "day" | "week" | "month";
export type GroupBy = "assignee" | "category" | "asset" | "severity" | "status";

export interface IncidentMetricsQuery {
  windowDays: number; // clamped 1..365 by callers' zod schema
  bucket?: Bucket;
  groupBy?: GroupBy;
}

export interface MetricsSeriesPoint {
  periodStart: string;
  opened: number;
  closed: number;
  mttrMinutes: number | null;
}

export interface MetricsGroup {
  key: string;
  label: string;
  count: number;
  openCount: number;
  closedCount: number;
  mttrMinutes: number | null;
  totalCostUsd: number;
}

export interface IncidentMetricsResult {
  windowDays: number;
  bucket: Bucket;
  total: number;
  open: number;
  closed: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  mttaMinutes: number | null;
  mttcMinutes: number | null;
  mttrMinutes: number | null;
  falsePositives: number;
  falsePositiveRate: number;
  series: MetricsSeriesPoint[];
  impact: {
    totalCostUsd: number;
    totalRecordsAffected: number;
    totalCustomersAffected: number;
    totalDowntimeMinutes: number;
    incidentsWithCost: number;
  };
  groups?: MetricsGroup[];
}

export function defaultBucket(windowDays: number): Bucket {
  if (windowDays <= 31) return "day";
  if (windowDays <= 180) return "week";
  return "month";
}

/** UTC bucket boundary for a date. day → midnight; week → ISO Monday; month → 1st. */
export function bucketStart(d: Date, bucket: Bucket): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  if (bucket === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  }
  if (bucket === "week") {
    const dow = utc.getUTCDay(); // 0=Sun
    const back = dow === 0 ? 6 : dow - 1; // to Monday
    utc.setUTCDate(utc.getUTCDate() - back);
  }
  return utc.toISOString().slice(0, 10);
}

/** Tolerant extractor: affectedSystems is free-form Json (string[] or {name}[]). */
export function extractAssets(affectedSystems: unknown): string[] {
  if (!Array.isArray(affectedSystems)) return [];
  const out: string[] = [];
  for (const entry of affectedSystems) {
    if (typeof entry === "string" && entry.trim()) out.push(entry.trim().slice(0, 80));
    else if (entry && typeof entry === "object") {
      const name = (entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).label;
      if (typeof name === "string" && name.trim()) out.push(name.trim().slice(0, 80));
    }
  }
  return out;
}

const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);

interface EngineIncident {
  severity: string;
  status: string;
  category: string | null;
  createdAt: Date;
  declaredAt: Date | null;
  containedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  closureDisposition: string | null;
  affectedSystems: unknown;
  estimatedCostUsd: number | null;
  recordsAffected: number | null;
  customersAffected: number | null;
  downtimeMinutes: number | null;
  assignedTo: { name: string | null } | null;
  assignedToId: string | null;
}

/** Pure computation over already-loaded rows — unit-testable without a DB. */
export function computeFromIncidents(
  incidents: EngineIncident[],
  q: IncidentMetricsQuery,
): IncidentMetricsResult {
  const bucket = q.bucket ?? defaultBucket(q.windowDays);

  const bySeverity: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const mtta: number[] = [], mttc: number[] = [], mttr: number[] = [];
  let closed = 0, falsePositives = 0, open = 0;

  const seriesMap = new Map<string, { opened: number; closed: number; mttr: number[] }>();
  const impact = {
    totalCostUsd: 0,
    totalRecordsAffected: 0,
    totalCustomersAffected: 0,
    totalDowntimeMinutes: 0,
    incidentsWithCost: 0,
  };
  const groupMap = new Map<string, { label: string; count: number; openCount: number; closedCount: number; mttr: number[]; totalCostUsd: number }>();

  const bucketEntry = (key: string) => {
    let e = seriesMap.get(key);
    if (!e) { e = { opened: 0, closed: 0, mttr: [] }; seriesMap.set(key, e); }
    return e;
  };
  const groupEntry = (key: string, label: string) => {
    let e = groupMap.get(key);
    if (!e) { e = { label, count: 0, openCount: 0, closedCount: 0, mttr: [], totalCostUsd: 0 }; groupMap.set(key, e); }
    return e;
  };

  for (const i of incidents) {
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
    byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    const isClosed = isClosedStatus(i.status);
    if (isClosed) closed += 1; else open += 1;
    if (i.closureDisposition === "false_positive") falsePositives += 1;

    // MTTx — same formulas the legacy route used.
    const base = i.declaredAt ?? i.createdAt;
    if (i.declaredAt) mtta.push((i.declaredAt.getTime() - i.createdAt.getTime()) / 60_000);
    if (i.containedAt) mttc.push((i.containedAt.getTime() - base.getTime()) / 60_000);
    const end = i.resolvedAt ?? i.closedAt;
    const resolveMinutes = end ? (end.getTime() - base.getTime()) / 60_000 : null;
    if (resolveMinutes !== null) mttr.push(resolveMinutes);

    // Series: opened by createdAt; closed by closedAt ?? resolvedAt.
    bucketEntry(bucketStart(i.createdAt, bucket)).opened += 1;
    const closeStamp = i.closedAt ?? i.resolvedAt;
    if (isClosed && closeStamp) {
      const e = bucketEntry(bucketStart(closeStamp, bucket));
      e.closed += 1;
      if (resolveMinutes !== null) e.mttr.push(resolveMinutes);
    }

    // Impact rollup — nulls ignored; coverage counted separately.
    if (i.estimatedCostUsd !== null) { impact.totalCostUsd += i.estimatedCostUsd; impact.incidentsWithCost += 1; }
    if (i.recordsAffected !== null) impact.totalRecordsAffected += i.recordsAffected;
    if (i.customersAffected !== null) impact.totalCustomersAffected += i.customersAffected;
    if (i.downtimeMinutes !== null) impact.totalDowntimeMinutes += i.downtimeMinutes;

    // Group-by. Asset is multi-valued (count-with-repetition, documented).
    if (q.groupBy) {
      const keys: Array<[string, string]> =
        q.groupBy === "assignee"
          ? [[i.assignedToId ?? "__unassigned__", i.assignedTo?.name ?? (i.assignedToId ? i.assignedToId : "Unassigned")]]
          : q.groupBy === "category"
            ? [[i.category ?? "__none__", i.category ?? "Uncategorized"]]
            : q.groupBy === "severity"
              ? [[i.severity, i.severity]]
              : q.groupBy === "status"
                ? [[i.status, i.status]]
                : extractAssets(i.affectedSystems).map((a) => [a, a] as [string, string]);
      for (const [key, label] of keys) {
        const g = groupEntry(key, label);
        g.count += 1;
        if (isClosed) { g.closedCount += 1; if (resolveMinutes !== null) g.mttr.push(resolveMinutes); }
        else g.openCount += 1;
        if (i.estimatedCostUsd !== null) g.totalCostUsd += i.estimatedCostUsd;
      }
    }
  }

  const series: MetricsSeriesPoint[] = Array.from(seriesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodStart, e]) => ({ periodStart, opened: e.opened, closed: e.closed, mttrMinutes: avg(e.mttr) }));

  let groups: MetricsGroup[] | undefined;
  if (q.groupBy) {
    const sorted = Array.from(groupMap.entries())
      .map(([key, g]) => ({ key, label: g.label, count: g.count, openCount: g.openCount, closedCount: g.closedCount, mttrMinutes: avg(g.mttr), totalCostUsd: g.totalCostUsd }))
      .sort((a, b) => b.count - a.count);
    // Cap to top 12 + an "Other" rollup so free-form asset buckets stay legible.
    if (sorted.length > 12) {
      const top = sorted.slice(0, 12);
      const rest = sorted.slice(12);
      top.push({
        key: "__other__",
        label: `Other (${rest.length})`,
        count: rest.reduce((s, g) => s + g.count, 0),
        openCount: rest.reduce((s, g) => s + g.openCount, 0),
        closedCount: rest.reduce((s, g) => s + g.closedCount, 0),
        mttrMinutes: null,
        totalCostUsd: rest.reduce((s, g) => s + g.totalCostUsd, 0),
      });
      groups = top;
    } else {
      groups = sorted;
    }
  }

  return {
    windowDays: q.windowDays,
    bucket,
    total: incidents.length,
    open,
    closed,
    bySeverity,
    byStatus,
    mttaMinutes: avg(mtta),
    mttcMinutes: avg(mttc),
    mttrMinutes: avg(mttr),
    falsePositives,
    falsePositiveRate: closed > 0 ? Math.round((falsePositives / closed) * 100) : 0,
    series,
    impact,
    groups,
  };
}

/** DB wrapper: loads accessible incidents in the window and computes. */
export async function computeIncidentMetrics(
  user: AccessUser,
  q: IncidentMetricsQuery,
): Promise<IncidentMetricsResult> {
  const since = new Date(Date.now() - q.windowDays * 86_400_000);
  const incidents = await db.incident.findMany({
    where: { ...accessibleIncidentsWhere(user, { excludeTraining: true }), createdAt: { gte: since } },
    select: {
      severity: true, status: true, category: true, createdAt: true,
      declaredAt: true, containedAt: true, resolvedAt: true, closedAt: true,
      closureDisposition: true, affectedSystems: true,
      estimatedCostUsd: true, recordsAffected: true, customersAffected: true,
      downtimeMinutes: true,
      assignedToId: true, assignedTo: { select: { name: true } },
    },
  });
  return computeFromIncidents(incidents, q);
}
