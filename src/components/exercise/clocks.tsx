"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { elapsedMs, formatMinutes, formatTimer, scenarioLabel } from "@/lib/exercise/time";
import { CLOCK_STATUS_LABELS, type ClockEntry, type ExerciseInfo, type InjectHeader } from "./types";

/** Server-corrected "now", re-rendered every second. */
export function useNow(serverOffsetMs: number, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + serverOffsetMs);
  useEffect(() => {
    setNow(Date.now() + serverOffsetMs);
    const t = setInterval(() => setNow(Date.now() + serverOffsetMs), everyMs);
    return () => clearInterval(t);
  }, [serverOffsetMs, everyMs]);
  return now;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "danger" }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[color:var(--color-muted-foreground)]">{label}</div>
      <div
        className={cn(
          "truncate font-mono text-[15px] font-semibold tabular-nums",
          tone === "warn" && "text-[color:var(--mist-warn)]",
          tone === "danger" && "text-[color:var(--mist-danger)]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** Time left on the current inject, or null when it has no deadline. */
export function injectRemainingMs(inject: InjectHeader | null | undefined, exercise: ExerciseInfo, now: number): number | null {
  if (!inject || inject.status !== "open" || !inject.closesAt) return null;
  // While paused the deadline does not move; show the time left at the pause.
  const ref = exercise.pausedAt ? Date.parse(exercise.pausedAt) : now;
  return Date.parse(inject.closesAt) - ref;
}

export function ExerciseClocks({
  exercise,
  inject,
  timezone,
  now,
  showElapsed = true,
}: {
  exercise: ExerciseInfo;
  inject: InjectHeader | null | undefined;
  timezone: string;
  now: number;
  showElapsed?: boolean;
}) {
  const elapsed = elapsedMs(exercise, now);
  const boxLeft = exercise.timeboxMin ? exercise.timeboxMin * 60_000 - elapsed : null;
  const injectLeft = injectRemainingMs(inject, exercise, now);
  const scenario = scenarioLabel(inject?.scenarioTime ?? null, exercise.scenarioStartAt, timezone);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:flex sm:flex-wrap sm:items-end">
      {showElapsed && <Stat label="Elapsed" value={formatTimer(elapsed)} />}
      {boxLeft !== null && (
        <Stat label="Time box left" value={formatMinutes(boxLeft)} tone={boxLeft <= 0 ? "danger" : boxLeft < 5 * 60_000 ? "warn" : undefined} />
      )}
      {injectLeft !== null && (
        <Stat label="Inject closes in" value={formatTimer(injectLeft)} tone={injectLeft <= 0 ? "danger" : injectLeft < 60_000 ? "warn" : undefined} />
      )}
      {scenario && <Stat label="Scenario time" value={scenario} />}
    </div>
  );
}

/** Time box left, or null without a time box. Paused time never counts. */
export function timeboxLeftMs(exercise: ExerciseInfo, now: number): number | null {
  if (!exercise.timeboxMin || !exercise.startedAt) return null;
  return exercise.timeboxMin * 60_000 - elapsedMs(exercise, now);
}

/** Warning thresholds for the time box, in minutes. */
export const TIMEBOX_WARNINGS_MIN = [10, 5] as const;

/** The smallest threshold the time box has crossed, or null. */
export function timeboxWarning(leftMs: number | null): number | null {
  if (leftMs === null || leftMs <= 0) return null;
  let hit: number | null = null;
  for (const m of TIMEBOX_WARNINGS_MIN) if (leftMs <= m * 60_000) hit = m;
  return hit;
}

const CLOCK_TONE: Record<string, string> = {
  running: "text-[color:var(--mist-warn)]",
  met: "text-[color:var(--mist-ok)]",
  missed: "text-[color:var(--mist-danger)]",
};

/**
 * Regulatory clocks with their scenario deadlines. With onAction (drivers),
 * each clock gets Start, Met and Reset buttons; the server applies them at
 * the current inject's scenario time.
 */
export function RegulatoryClocks({
  clocks,
  scenarioStartAt,
  timezone,
  onAction,
  busyKey,
}: {
  clocks: ClockEntry[];
  scenarioStartAt: string | null;
  timezone: string;
  onAction?: (key: string, action: "trigger" | "met" | "reset") => void;
  busyKey?: string | null;
}) {
  if (clocks.length === 0) return null;
  return (
    <ul className="space-y-2" aria-label="Regulatory clocks">
      {clocks.map((c) => (
        <li key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[color:var(--color-muted)]/60 px-3 py-2 text-[13px]">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" title={c.label}>
              {c.label}
            </div>
            <div className="text-[12px] text-[color:var(--color-muted-foreground)]">
              <span className={cn("font-medium", CLOCK_TONE[c.status])}>{CLOCK_STATUS_LABELS[c.status] ?? c.status}</span>
              {c.deadlineAt && <span>. Due {scenarioLabel(c.deadlineAt, scenarioStartAt, timezone)}</span>}
              {c.metAt && <span>. Met {scenarioLabel(c.metAt, scenarioStartAt, timezone)}</span>}
            </div>
          </div>
          {onAction && (
            <div className="flex gap-1">
              {c.status === "pending" && (
                <Button size="xs" variant="outline" disabled={busyKey === c.key} aria-label={`Start ${c.label}`} onClick={() => onAction(c.key, "trigger")}>
                  Start
                </Button>
              )}
              {c.status === "running" && (
                <Button size="xs" variant="outline" disabled={busyKey === c.key} aria-label={`Mark ${c.label} met`} onClick={() => onAction(c.key, "met")}>
                  Met
                </Button>
              )}
              {c.status !== "pending" && (
                <Button size="xs" variant="ghost" disabled={busyKey === c.key} aria-label={`Reset ${c.label}`} onClick={() => onAction(c.key, "reset")}>
                  Reset
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
