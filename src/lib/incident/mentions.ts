// Parse @mentions out of a war-room chat message and resolve them to org-member
// ids so the mentioned people can be notified. Matching is deliberately strict
// (exact first name, compacted full name, or email local-part) to avoid
// over-notifying on loose substring matches.

export interface MentionMember {
  id: string;
  name: string | null;
  email: string;
}

// Negative lookbehind so an "@" inside an email address (e.g. alice@acme.com)
// or mid-token is not treated as a mention — only "@handle" at a word boundary.
const MENTION_RE = /(?<![a-zA-Z0-9._-])@([a-zA-Z0-9._-]+)/g;

export function parseMentions(text: string, members: MentionMember[]): string[] {
  const tokens = Array.from(text.matchAll(MENTION_RE)).map((m) => m[1].toLowerCase());
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);

  const ids = new Set<string>();
  for (const m of members) {
    const name = (m.name ?? "").trim().toLowerCase();
    const first = name.split(/\s+/)[0] ?? "";
    const compact = name.replace(/\s+/g, "");
    const local = (m.email.split("@")[0] ?? "").toLowerCase();
    if ((first && tokenSet.has(first)) || (compact && tokenSet.has(compact)) || (local && tokenSet.has(local))) {
      ids.add(m.id);
    }
  }
  return Array.from(ids);
}
