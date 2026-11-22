// ---------------------------------------------------------------------------
// Minimal RFC 5545 (iCalendar) builder.
// ---------------------------------------------------------------------------
// Scope is deliberately small: UTC-only point events with a duration, PUBLISH
// method, no timezones (DTSTART in Z form renders correctly in Apple/Google/
// Outlook), no recurrence. Everything user-controlled passes through escape()
// and every emitted line is folded at 75 octets per the spec.

export interface IcsEvent {
  /** Stable unique id for the event (becomes UID@crucible). */
  uid: string;
  title: string;
  /** Event start. */
  start: Date;
  /** Minutes; defaults to 30 so point events render as visible blocks. */
  durationMinutes?: number;
  description?: string | null;
  /** Optional status hint rendered into the description, not STATUS: —
   *  calendar STATUS has enum semantics we don't want to fake. */
  meta?: string | null;
}

const CRLF = "\r\n";

/** Escape TEXT values per RFC 5545 §3.3.11. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets with a leading space on continuations. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // First segment gets 75 octets, continuations 74 (leading space costs 1).
    const take = start === 0 ? 75 : 74;
    let end = Math.min(start + take, bytes.length);
    // Never split inside a UTF-8 multibyte sequence: back up while the byte
    // at the split point is a continuation byte (10xxxxxx).
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join(CRLF);
}

function toIcsUtc(date: Date): string {
  // 20260916T142500Z
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildIcsCalendar(opts: {
  /** Calendar display name (X-WR-CALNAME). */
  name: string;
  events: IcsEvent[];
}): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Crucible//Incident Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(opts.name)}`,
  ];
  for (const e of opts.events) {
    const durationMs = Math.max(1, e.durationMinutes ?? 30) * 60_000;
    const description = [e.description, e.meta ? `Status: ${e.meta}` : null]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(e.uid)}@crucible`,
      `DTSTAMP:${toIcsUtc(now)}`,
      `DTSTART:${toIcsUtc(e.start)}`,
      `DTEND:${toIcsUtc(new Date(e.start.getTime() + durationMs))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";
