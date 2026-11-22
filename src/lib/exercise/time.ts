// Time formatting for exercises. Pure; used by server routes and client views.
// All wall and scenario times display in Instance.timezone with the zone label.

function parts(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone, hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC", hourCycle: "h23" });
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  if (out.timeZoneName) out.timeZoneName = normalizeZoneName(out.timeZoneName);
  return out;
}

/**
 * Node and browsers ship different ICU data: one says "GMT", the other
 * "GMT+0" for the same zone and date. Use one spelling so server and client
 * render the same text (no hydration mismatch).
 */
export function normalizeZoneName(name: string): string {
  return /^(GMT|UTC)[+-]0(:00)?$/.test(name) ? name.slice(0, 3) : name;
}

/** Short zone label for a date in a zone, e.g. "EDT" or "GMT+2". */
export function zoneLabel(date: Date, timeZone: string): string {
  return parts(date, timeZone, { timeZoneName: "short" }).timeZoneName ?? timeZone;
}

/** "2026-10-20 14:05 EDT" */
export function formatInZone(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.timeZoneName ?? ""}`.trim();
}

/** "Sat 02:10 EDT" */
export function formatDayTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return `${p.weekday} ${p.hour}:${p.minute} ${p.timeZoneName ?? ""}`.trim();
}

/** "14:05" */
export function formatClock(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}

/** "T+6h 10m" from the scenario start. Negative offsets show as T-. */
export function scenarioOffset(time: Date, start: Date): string {
  const diffMin = Math.round((time.getTime() - start.getTime()) / 60_000);
  const sign = diffMin < 0 ? "-" : "+";
  const abs = Math.abs(diffMin);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  return d > 0 ? `T${sign}${d}d ${h}h ${m}m` : `T${sign}${h}h ${m}m`;
}

/** "T+6h 10m, Sat 02:10 EDT". Without a start, the day and time only. */
export function scenarioLabel(time: Date | string | null | undefined, start: Date | string | null | undefined, timeZone: string): string | null {
  if (!time) return null;
  const t = new Date(time);
  const day = formatDayTime(t, timeZone);
  return start ? `${scenarioOffset(t, new Date(start))}, ${day}` : day;
}

/** Wall clock run time minus pauses. */
export function elapsedMs(
  ex: { startedAt: Date | string | null; pausedAt: Date | string | null; pausedMsTotal: number; endedAt?: Date | string | null },
  now: number,
): number {
  if (!ex.startedAt) return 0;
  const end = ex.endedAt ? new Date(ex.endedAt).getTime() : now;
  const pausedNow = ex.pausedAt && !ex.endedAt ? Math.max(0, now - new Date(ex.pausedAt).getTime()) : 0;
  return Math.max(0, end - new Date(ex.startedAt).getTime() - ex.pausedMsTotal - pausedNow);
}

/** "1:05:09" or "5:09". */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1h 5m" or "12m". */
export function formatMinutes(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Wall time in a zone minus UTC, in ms, at one instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a wall clock in a zone shows y-m-d h:mi. */
export function zonedWallTime(y: number, m: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - zoneOffsetMs(new Date(guess), timeZone);
  // A second pass settles instants near a daylight saving change.
  t = guess - zoneOffsetMs(new Date(t), timeZone);
  return new Date(t);
}

export interface ScenarioAnchor {
  /** 0 Sunday to 6 Saturday. */
  weekday: number;
  /** "HH:MM", 24 hour. */
  time: string;
}

/**
 * The next instant after `now` when the wall clock in `timeZone` shows the
 * anchor's weekday and time. Null when the anchor is malformed.
 */
export function nextAnchorDate(now: Date, anchor: ScenarioAnchor, timeZone: string): Date | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(anchor.time);
  if (!m || !Number.isInteger(anchor.weekday) || anchor.weekday < 0 || anchor.weekday > 6) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const today = parts(now, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const base = Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day));
  for (let add = 0; add <= 7; add++) {
    const day = new Date(base + add * 86_400_000);
    if (day.getUTCDay() !== anchor.weekday) continue;
    const at = zonedWallTime(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute, timeZone);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}
