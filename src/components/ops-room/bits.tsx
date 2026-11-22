"use client";

// Small shared pieces of the Ops Room: severity dot, section shell, and the
// live SLA chip (same headline rules as the server).

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { slaHeadlineText, type SlaHeadline } from "@/lib/ops-room/sla-headline";

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-[color:var(--mist-danger)]",
  high: "bg-[color:var(--mist-danger)]/70",
  medium: "bg-[color:var(--mist-warn)]",
  low: "bg-[color:var(--color-muted-foreground)]/40",
};

export function SeverityDot({ severity, className }: { severity: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[severity] ?? SEVERITY_DOT.low, className)}
    />
  );
}

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-lg)] bg-[color:var(--color-card)] shadow-[var(--elevation-1)]", className)}>
      {children}
    </div>
  );
}

const SLA_TONE: Record<SlaHeadline["state"], string> = {
  breached: "bg-[color:var(--mist-danger)]/12 text-[color:var(--mist-danger)]",
  at_risk: "bg-[color:var(--mist-warn)]/15 text-[color:var(--mist-warn)]",
  on_track: "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
  met: "bg-[color:var(--mist-ok)]/12 text-[color:var(--mist-ok)]",
  none: "",
};

/**
 * A clock that starts at the SERVER's render time (so hydration matches the
 * server HTML exactly) and then ticks with the real time.
 */
export function useClock(serverNow: string, intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "Contain due in 3h 12m" / "Acknowledge overdue 25m" against `now`. */
export function SlaChip({ sla, now, className }: { sla: SlaHeadline; now: Date; className?: string }) {
  if (sla.state === "none") return null;
  const remaining = sla.deadline ? Math.round((new Date(sla.deadline).getTime() - now.getTime()) / 60_000) : null;
  const state: SlaHeadline["state"] =
    sla.state === "met" ? "met" : remaining !== null && remaining < 0 ? "breached" : sla.state;
  const text = slaHeadlineText(sla, remaining);
  if (!text) return null;
  return (
    <span
      data-sla-state={state}
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
        SLA_TONE[state],
        className,
      )}
    >
      {text}
    </span>
  );
}

export function SectionTitle({ icon, children, aside }: { icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h2 className="eyebrow inline-flex min-w-0 items-center gap-1.5">
        {icon}
        {children}
      </h2>
      {aside}
    </div>
  );
}
