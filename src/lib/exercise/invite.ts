// Invite participants: email list parsing, the join link, the start time
// an invite names, and the invite text. Pure, safe for client components
// (the lobby builds the mailto fallback with the same text the server sends).

export const MAX_INVITES = 200;
export const INVITE_NOTE_MAX = 1000;
/** Raw text the email box accepts. 200 long addresses plus separators. */
export const INVITE_RAW_MAX = 60_000;

// Local part without spaces, quotes, brackets or separators; a dotted domain
// of LDH labels. Strict on purpose: these go into an SMTP envelope.
const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

export function isValidEmail(value: string): boolean {
  if (value.length > 254) return false;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at !== value.indexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!LOCAL_RE.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => LABEL_RE.test(l))) return false;
  return /^[A-Za-z]{2,63}$|^xn--[A-Za-z0-9-]{1,59}$/.test(labels[labels.length - 1]!);
}

export type ParsedEmails = { ok: true; emails: string[] } | { ok: false; error: string };

/** Comma, semicolon or newline separated addresses. Deduplicated, case-insensitive. */
export function parseInviteEmails(raw: string): ParsedEmails {
  if (raw.length > INVITE_RAW_MAX) return { ok: false, error: `Use ${MAX_INVITES} addresses or fewer.` };
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "Enter at least one email address." };
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const p of parts) {
    if (!isValidEmail(p)) return { ok: false, error: `${p.slice(0, 80)} is not a valid email address.` };
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(p);
  }
  if (emails.length > MAX_INVITES) return { ok: false, error: `Use ${MAX_INVITES} addresses or fewer.` };
  return { ok: true, emails };
}

/** PUBLIC_URL as an http(s) origin, or null. */
export function publicBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function joinLink(base: string, code: string): string {
  return `${base.replace(/\/+$/, "")}/join/${encodeURIComponent(code)}`;
}

/**
 * The real-world start an invite names: the facilitator's start time, else
 * the scenario start when it is still ahead (a past scenario start is a
 * simulated time, not a meeting time). Null when neither applies.
 */
export function inviteStart(startsAt: string | Date | null | undefined, scenarioStartAt: string | Date | null | undefined, now: Date = new Date()): Date | null {
  if (startsAt) {
    const d = new Date(startsAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (scenarioStartAt) {
    const d = new Date(scenarioStartAt);
    if (!Number.isNaN(d.getTime()) && d.getTime() > now.getTime()) return d;
  }
  return null;
}

export interface InviteText {
  title: string;
  /** Start already formatted in the instance zone, or null. */
  startLabel: string | null;
  joinUrl: string;
  code: string;
  note?: string | null;
}

export function inviteSubject(title: string): string {
  return `Invitation: ${title}`.replace(/[\r\n]+/g, " ").slice(0, 200);
}

/** Plain-text invite body. */
export function inviteBody(v: InviteText): string {
  const lines = [`You are invited to the exercise ${v.title}.`, ""];
  if (v.startLabel) lines.push(`Start: ${v.startLabel}`);
  lines.push(`Join: ${v.joinUrl}`, `Code: ${v.code}`, "", "The link works once the facilitator opens the lobby.");
  const note = v.note?.trim();
  if (note) lines.push("", note);
  return lines.join("\n");
}

/** mailto: with every address in Bcc, so recipients do not see each other. */
export function inviteMailto(emails: string[], v: InviteText): string {
  const q = [
    emails.length ? `bcc=${encodeURIComponent(emails.join(","))}` : null,
    `subject=${encodeURIComponent(inviteSubject(v.title))}`,
    `body=${encodeURIComponent(inviteBody(v))}`,
  ].filter(Boolean);
  return `mailto:?${q.join("&")}`;
}
