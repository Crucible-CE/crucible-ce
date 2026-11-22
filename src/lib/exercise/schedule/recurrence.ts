// Recurrence for the exercise schedule. Pure.
//
// Cadences include semiannual. The series is anchored in a wall time and
// IANA zone so a 09:00 exercise stays at 09:00 across daylight saving
// changes, and a day that does not exist in a month clamps to the month's
// last day (Jan 31 + 1 month is Feb 28 or 29, not March).
//
// Stored form (ExerciseSchedule.rrule) is an RFC 5545 subset:
//
//   DTSTART;TZID=Europe/Berlin:20261031T090000
//   RRULE:FREQ=MONTHLY;INTERVAL=3
//
// Only FREQ=MONTHLY with INTERVAL 1, 3 or 6 and FREQ=YEARLY with INTERVAL 1
// are accepted. Anything else parses to null. Clamping differs from RFC 5545,
// which skips months that lack the day; that is on purpose for exercises.

import { zonedWallTime } from "@/lib/exercise/time";

/** Same check as src/lib/exercise/settings.ts, kept here so this module stays client safe. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const RECURRENCES = ["none", "monthly", "quarterly", "semiannual", "annual"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: "Does not repeat",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Every 6 months",
  annual: "Annually",
};

export const RECURRENCE_MONTHS: Record<Exclude<Recurrence, "none">, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

export interface WallTime {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
}

export interface SeriesRule {
  tz: string;
  start: WallTime;
  months: number;
}

const MAX_STEPS = 2400;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** Wall clock parts of an instant in a zone. */
export function wallTimeOf(date: Date, tz: string): WallTime {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: isValidTimeZone(tz) ? tz : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute) };
}

/** "2026-10-31" and "09:00" for an instant in a zone. */
export function wallDateTimeStrings(date: Date, tz: string): { date: string; time: string } {
  const w = wallTimeOf(date, tz);
  return { date: `${w.y}-${pad(w.m)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}` };
}

/** Parse "YYYY-MM-DD" and "HH:MM". Null when either is malformed or the date does not exist. */
export function parseWallTime(date: string, time: string): WallTime | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!dm || !tm) return null;
  const w = { y: Number(dm[1]), m: Number(dm[2]), d: Number(dm[3]), h: Number(tm[1]), mi: Number(tm[2]) };
  if (w.y < 2000 || w.y > 2200 || w.m < 1 || w.m > 12 || w.d < 1 || w.d > daysInMonth(w.y, w.m)) return null;
  return w;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The instant of a wall time in a zone. */
export function instantOf(w: WallTime, tz: string): Date {
  return zonedWallTime(w.y, w.m, w.d, w.h, w.mi, isValidTimeZone(tz) ? tz : "UTC");
}

export function recurrenceMonths(r: Recurrence): number | null {
  return r === "none" ? null : RECURRENCE_MONTHS[r];
}

/** Serialize a series. Null for "none". */
export function buildRrule(recurrence: Recurrence, start: WallTime, tz: string): string | null {
  const months = recurrenceMonths(recurrence);
  if (!months) return null;
  const dt = `${start.y}${pad(start.m)}${pad(start.d)}T${pad(start.h)}${pad(start.mi)}00`;
  const rule = months === 12 ? "FREQ=YEARLY;INTERVAL=1" : `FREQ=MONTHLY;INTERVAL=${months}`;
  return `DTSTART;TZID=${tz}:${dt}\nRRULE:${rule}`;
}

/** Parse the stored subset. Null for anything outside it. */
export function parseRrule(raw: string | null | undefined): SeriesRule | null {
  if (!raw || raw.length > 300) return null;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 2) return null;
  const ds = /^DTSTART;TZID=([A-Za-z0-9_+\-/]{1,64}):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(lines[0]);
  if (!ds || !isValidTimeZone(ds[1])) return null;
  const start = parseWallTime(`${ds[2]}-${ds[3]}-${ds[4]}`, `${ds[5]}:${ds[6]}`);
  if (!start) return null;
  const rr = /^RRULE:(.+)$/.exec(lines[1]);
  if (!rr) return null;
  const parts = new Map<string, string>();
  for (const kv of rr[1].split(";")) {
    const [k, v, extra] = kv.split("=");
    if (!k || v === undefined || extra !== undefined || parts.has(k)) return null;
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = parts.get("FREQ");
  const interval = Number(parts.get("INTERVAL") ?? "1");
  for (const k of parts.keys()) if (k !== "FREQ" && k !== "INTERVAL") return null;
  let months: number;
  if (freq === "MONTHLY" && [1, 3, 6].includes(interval)) months = interval;
  else if (freq === "MONTHLY" && interval === 12) months = 12;
  else if (freq === "YEARLY" && interval === 1) months = 12;
  else return null;
  return { tz: ds[1], start, months };
}

/** The named cadence of a stored rule, or "none". */
export function recurrenceOf(raw: string | null | undefined): Recurrence {
  const rule = parseRrule(raw);
  if (!rule) return "none";
  const hit = (Object.entries(RECURRENCE_MONTHS) as Array<[Exclude<Recurrence, "none">, number]>).find(([, m]) => m === rule.months);
  return hit ? hit[0] : "none";
}

/** The k-th occurrence (k = 0 is the start). Days past the month's end clamp to its last day. */
export function occurrence(rule: SeriesRule, k: number): Date {
  const total = rule.start.m - 1 + k * rule.months;
  const y = rule.start.y + Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(rule.start.d, daysInMonth(y, m));
  return instantOf({ y, m, d, h: rule.start.h, mi: rule.start.mi }, rule.tz);
}

/** The first occurrence strictly after `after`. */
export function nextOccurrenceAfter(rule: SeriesRule, after: Date): Date {
  const w = wallTimeOf(after, rule.tz);
  const diffMonths = (w.y - rule.start.y) * 12 + (w.m - rule.start.m);
  let k = Math.max(0, Math.floor(diffMonths / rule.months) - 1);
  for (let i = 0; i < MAX_STEPS; i++, k++) {
    const at = occurrence(rule, k);
    if (at.getTime() > after.getTime()) return at;
  }
  return occurrence(rule, k);
}

/** Occurrences in [from, to), at most `max`. */
export function occurrencesBetween(rule: SeriesRule, from: Date, to: Date, max: number): Date[] {
  const out: Date[] = [];
  let at = nextOccurrenceAfter(rule, new Date(from.getTime() - 1));
  while (at.getTime() < to.getTime() && out.length < max) {
    out.push(at);
    at = nextOccurrenceAfter(rule, at);
  }
  return out;
}

/**
 * The occurrence a schedule entry points at now: the first one that has not
 * ended yet (start + duration after `now`). Keeps a running exercise visible
 * until its slot is over.
 */
export function currentOccurrence(rule: SeriesRule, now: Date, durationMin: number): Date {
  return nextOccurrenceAfter(rule, new Date(now.getTime() - Math.max(0, durationMin) * 60_000));
}
