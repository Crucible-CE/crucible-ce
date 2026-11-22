"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlaStatus {
  milestone: string; label: string; targetMinutes: number;
  deadline: string | null; completedAt: string | null;
  state: "on_track" | "at_risk" | "breached" | "met" | "met_late" | "pending" | "not_tracked";
  remainingMinutes: number | null;
}

const STATE_STYLE: Record<string, string> = {
  on_track: "border-[color:var(--color-border)] text-muted-foreground",
  at_risk: "border-[color:var(--mist-amber)]/40 bg-[color:var(--mist-amber)]/10 text-[color:var(--mist-amber)]",
  breached: "border-[color:var(--mist-danger)]/40 bg-[color:var(--mist-danger)]/10 text-[color:var(--mist-danger)]",
  met: "border-[color:var(--mist-emerald)]/40 bg-[color:var(--mist-emerald)]/10 text-[color:var(--mist-emerald)]",
  met_late: "border-[color:var(--mist-amber)]/40 bg-[color:var(--mist-amber)]/10 text-[color:var(--mist-amber)]",
};

function rel(min: number | null): string {
  if (min == null) return "";
  const a = Math.abs(min);
  const t = a < 60 ? `${a}m` : a < 1440 ? `${(a / 60).toFixed(a % 60 ? 1 : 0)}h` : `${(a / 1440).toFixed(a % 1440 ? 1 : 0)}d`;
  return min < 0 ? `${t} over` : `${t} left`;
}

export function SlaTimers({ incidentId }: { incidentId: string }) {
  const [statuses, setStatuses] = useState<SlaStatus[]>([]);

  useEffect(() => {
    let active = true;
    const load = () => fetch(`/api/incidents/${incidentId}/sla`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (active && d) setStatuses(d.statuses); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { active = false; clearInterval(t); };
  }, [incidentId]);

  const shown = statuses.filter((s) => s.state !== "not_tracked");
  if (shown.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground"><Timer className="h-3.5 w-3.5" /> Response SLAs</h3>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((s) => (
          <div key={s.milestone} className={cn("rounded-lg border px-2.5 py-1.5", STATE_STYLE[s.state] ?? STATE_STYLE.on_track)}>
            <div className="text-[11px] font-medium">{s.label}</div>
            <div className="text-[10px] opacity-80">
              {s.state === "met" ? "Met" : s.state === "met_late" ? "Met (late)" : s.state === "breached" ? rel(s.remainingMinutes) : s.state === "pending" ? "Pending" : rel(s.remainingMinutes)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
