// Names become roles in AAR text. HSEEP reports are no-fault: generated
// text refers to people by title or exercise role. Names stay in the roster.

export const ROLE_LABELS: Record<string, string> = {
  lead_facilitator: "Lead facilitator",
  controller: "Controller",
  evaluator: "Evaluator",
  scribe: "Scribe",
  player: "Player",
  observer: "Observer",
};

export interface NamedPerson {
  participantId: string;
  name: string;
  /** Other names the person is known by (account name). */
  aliases?: string[];
  title: string | null;
  team: string | null;
  roles: string[];
}

/** The label used in place of a person's name. */
export function roleLabelFor(p: Pick<NamedPerson, "title" | "team" | "roles">): string {
  const title = p.title?.trim();
  if (title) return title;
  const control = p.roles.find((r) => r !== "player" && ROLE_LABELS[r]);
  if (control) return ROLE_LABELS[control];
  if (p.team) return `${p.team} team member`;
  return "Participant";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short words that are also common English; never replaced on their own. */
const COMMON = new Set(["will", "may", "mark", "bill", "grant", "chase", "hope", "joy", "sue", "art", "max", "page", "rich", "lee"]);

interface Pattern {
  re: RegExp;
  label: string;
  len: number;
}

/**
 * Build a replacer for a roster. Full names and aliases are always replaced.
 * A first name alone is replaced when it is at least 3 letters, capitalized
 * in the text, unique in the roster, and not a common word.
 */
export function makeNameReplacer(people: NamedPerson[]): (text: string) => string {
  const patterns: Pattern[] = [];
  const firstCounts = new Map<string, number>();
  const firstOf = (n: string) => n.trim().split(/\s+/)[0] ?? "";
  for (const p of people) {
    const f = firstOf(p.name).toLowerCase();
    if (f) firstCounts.set(f, (firstCounts.get(f) ?? 0) + 1);
  }
  for (const p of people) {
    const label = roleLabelFor(p);
    const names = [p.name, ...(p.aliases ?? [])].map((n) => n.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter((n) => n.length >= 3);
    for (const n of new Set(names)) {
      patterns.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu"), label, len: n.length });
      const parts = n.split(/\s+/);
      if (parts.length > 1) {
        // "Lee, Dana" style (Teams).
        const swapped = `${parts.slice(1).join(" ")}, ${parts[0]}`;
        patterns.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(swapped)}(?![\\p{L}\\p{N}])`, "giu"), label, len: swapped.length });
      }
      const first = parts[0];
      if (
        parts.length > 1 &&
        first.length >= 3 &&
        /^\p{Lu}/u.test(first) &&
        firstCounts.get(first.toLowerCase()) === 1 &&
        !COMMON.has(first.toLowerCase())
      ) {
        // Case-sensitive: only the capitalized first name.
        patterns.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(first)}(?![\\p{L}\\p{N}])`, "gu"), label, len: first.length });
      }
    }
  }
  patterns.sort((a, b) => b.len - a.len);
  return (text: string) => {
    if (!text) return text;
    let out = text;
    for (const p of patterns) out = out.replace(p.re, p.label);
    return out;
  };
}

/** Apply a string transform to every string inside a JSON-like value. */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  if (typeof value === "string") return fn(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn)) as unknown as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = mapStrings(v, fn);
    return out as T;
  }
  return value;
}
