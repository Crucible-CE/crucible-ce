// Minimal RFC 5545 (iCalendar) builder. Pure.
//
// UTC point events with a start and an end, METHOD
// PUBLISH, no VTIMEZONE and no RRULE: a recurring schedule entry is written
// as one event per upcoming occurrence, so daylight saving never shifts it.
// Every user-controlled value passes through escapeIcsText and every line is
// folded at 75 octets.
//
// Changes from the source: bare CR is treated as a line break, other control
// characters are dropped (RFC 5545 TEXT allows none but HTAB), and the
// calendar carries refresh hints for subscribed feeds.

export interface IcsEvent {
  /** Stable unique id, without the domain part. */
  uid: string;
  title: string;
  start: Date;
  /** Minutes. At least 1. */
  durationMinutes: number;
  description?: string | null;
  url?: string | null;
}

export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";
const CRLF = "\r\n";
const UID_DOMAIN = "crucible-ce";

/** Escape a TEXT value (RFC 5545 section 3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Fold a content line at 75 octets. Continuations start with one space. Never splits a UTF-8 sequence. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const take = start === 0 ? 75 : 74;
    let end = Math.min(start + take, bytes.length);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join(CRLF);
}

/** 20261031T080000Z */
export function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Markdown to plain text for DESCRIPTION: drop heading marks, emphasis and link syntax, keep the words. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildIcsCalendar(opts: { name: string; events: IcsEvent[]; now?: Date; refreshHours?: number }): string {
  const now = opts.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Crucible CE//Exercise schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(opts.name)}`,
  ];
  if (opts.refreshHours) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshHours}H`, `X-PUBLISHED-TTL:PT${opts.refreshHours}H`);
  }
  for (const e of opts.events) {
    const durationMs = Math.max(1, Math.round(e.durationMinutes)) * 60_000;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(e.uid)}@${UID_DOMAIN}`,
      `DTSTAMP:${toIcsUtc(now)}`,
      `DTSTART:${toIcsUtc(e.start)}`,
      `DTEND:${toIcsUtc(new Date(e.start.getTime() + durationMs))}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
    );
    if (e.description?.trim()) lines.push(`DESCRIPTION:${escapeIcsText(e.description.trim())}`);
    // URI values are not TEXT: no escaping, but nothing that could end the line.
    if (e.url && /^https?:\/\/[^\s"<>\\]+$/.test(e.url)) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
