// Local-timezone helpers for HTML <input type="date"> / <input type="datetime-local">.
//
// datetime-local and date input values are LOCAL wall-clock strings — the browser
// interprets/emits them in the viewer's timezone, never UTC. Building those values
// via `date.toISOString().slice(...)` therefore shows/saves the WRONG wall-clock time
// for anyone not at UTC+0 (and shifts by the viewer's offset on every round-trip).
//
// Always build these strings from local getters (getFullYear/Month/Date/Hours/Minutes),
// and convert to UTC only at the API boundary via toIsoOrNull().

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** "YYYY-MM-DDTHH:mm" in LOCAL time, for <input type="datetime-local">. "" for null/invalid. */
export function toDatetimeLocalValue(d: Date | string | null | undefined): string {
  const parsed = toDate(d);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/** Interprets a "YYYY-MM-DDTHH:mm" (or similar) datetime-local value as LOCAL time. null for ""/invalid. */
export function fromDatetimeLocalValue(v: string): Date | null {
  if (!v) return null;
  // Constructing `new Date("YYYY-MM-DDTHH:mm")` (no timezone/offset suffix) is
  // specified by ECMA-262 to parse as LOCAL time — exactly what we want here.
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** "YYYY-MM-DD" in LOCAL time, for <input type="date">. "" for null/invalid. */
export function toDateInputValue(d: Date | string | null | undefined): string {
  const parsed = toDate(d);
  if (!parsed) return "";
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** Local midnight of a "YYYY-MM-DD" date-input value. null for ""/invalid. */
export function fromDateInputValue(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** "YYYY-MM-DD" in local time (calendar day key). Same shape as parseYmdLocal's input. */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse a "YYYY-MM-DD" day key as LOCAL midnight (the off-by-one fix).
 * `new Date("2026-07-03")` (date-only, no time) parses as UTC midnight per spec,
 * which renders as the previous day for any viewer west of UTC. Appending a local
 * time-of-day component forces local-time parsing instead.
 */
export function parseYmdLocal(ymd: string): Date {
  return new Date(`${ymd}T00:00`);
}

/** fromDatetimeLocalValue(v) -> ISO string for POST/PATCH bodies; null for ""/invalid. */
export function toIsoOrNull(v: string): string | null {
  const d = fromDatetimeLocalValue(v);
  return d ? d.toISOString() : null;
}
