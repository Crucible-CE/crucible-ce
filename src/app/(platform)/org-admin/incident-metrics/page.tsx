"use client";

import { useEffect, useState } from "react";
import { ChartNoAxesCombined, Loader2, Lock } from "lucide-react";

interface Metrics {
  windowDays: number; total: number; open: number; closed: number;
  bySeverity: Record<string, number>; byStatus: Record<string, number>;
  mttaMinutes: number | null; mttcMinutes: number | null; mttrMinutes: number | null;
  falsePositiveRate: number; falsePositives: number;
}

function dur(min: number | null): string {
  if (min == null) return "n/a";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}
const SEV_COLOR: Record<string, string> = { critical: "var(--mist-danger)", high: "var(--mist-amber)", medium: "var(--mist-indigo)", low: "var(--color-muted-foreground)" };

export default function IncidentMetricsPage() {
  const [d, setD] = useState<Metrics | null>(null);
  const [days, setDays] = useState(90);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/incident-metrics?days=${days}`).then((r) => { if (r.status === 403) { setForbidden(true); return null; } return r.ok ? r.json() : null; }).then((j) => { if (j) setD(j); setLoading(false); }).catch(() => setLoading(false));
  }, [days]);

  if (forbidden) return (
    <div className="mx-auto max-w-lg rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-8 text-center">
      <Lock className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 text-base font-semibold">Restricted</h2>
      <p className="mt-1 text-sm text-muted-foreground">Requires the <span className="font-mono">admin.access</span> permission.</p>
    </div>
  );

  const card = (label: string, value: string, sub?: string) => (
    <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--mist-indigo)]/15 text-[color:var(--mist-indigo)]"><ChartNoAxesCombined className="h-5 w-5" /></div>
          <div><h1 className="text-lg font-semibold">Incident metrics</h1><p className="text-sm text-muted-foreground">Incident counts and response times.</p></div>
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2 py-1.5 text-sm">
          <option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option>
        </select>
      </div>

      {loading || !d ? <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {card("Incidents", String(d.total), `${d.open} open · ${d.closed} closed`)}
            {card("MTTA", dur(d.mttaMinutes), "Declared to acknowledged")}
            {card("MTTC", dur(d.mttcMinutes), "Declared to contained")}
            {card("MTTR", dur(d.mttrMinutes), "Declared to resolved")}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {card("False-positive rate", `${d.falsePositiveRate}%`, `${d.falsePositives} of ${d.closed} closed`)}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
              <div className="mb-3 text-sm font-medium">By severity</div>
              {["critical", "high", "medium", "low"].map((s) => {
                const n = d.bySeverity[s] ?? 0; const pct = d.total ? (n / d.total) * 100 : 0;
                return (
                  <div key={s} className="mb-2">
                    <div className="flex justify-between text-xs"><span className="capitalize">{s}</span><span className="text-muted-foreground">{n}</span></div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--color-muted)]"><div className="h-full" style={{ width: `${pct}%`, backgroundColor: SEV_COLOR[s] }} /></div>
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4">
              <div className="mb-3 text-sm font-medium">By status</div>
              {Object.entries(d.byStatus).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                <div key={s} className="flex justify-between border-b border-[color:var(--color-border)] py-1.5 text-xs last:border-0"><span className="capitalize">{s}</span><span className="font-medium">{n}</span></div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
