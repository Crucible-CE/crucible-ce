// Rank the organization's playbook documents for an incident, by rules (no
// AI). Pure. Signals, strongest first:
//   - the incident category: its keywords (category aliases, as in Cloud's
//     rankPlaybooks) in the document title (100) or its opening text (40)
//   - incident tags: ATT&CK technique ids (T1486, T1566.001) the document mentions (20 each)
//   - keywords: words shared by the incident title and description and the
//     document title (12 each) or headings (4 each, at most 5)
// Only documents scoring above zero are returned, highest first.

export interface PlaybookDocCandidate {
  id: string;
  title: string;
  text: string;
  scope: string;
  collection: string | null;
  headings: string[];
}

export interface IncidentSignals {
  title: string;
  description?: string | null;
  category: string | null;
  /** ATT&CK technique ids on the incident (mitreJson). */
  tags?: string[];
}

export interface RankedPlaybookDoc {
  id: string;
  title: string;
  scope: string;
  collection: string | null;
  score: number;
  reasons: string[];
}

// Incident category (CE's list) to words a playbook for it would use.
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  ransomware: ["ransomware", "ransom", "extortion", "encrypt", "encryption"],
  malware: ["malware", "ransomware", "wiper", "trojan", "infection"],
  phishing: ["phishing", "vishing", "social engineering", "help desk", "business email compromise", "bec", "wire fraud"],
  data_breach: ["data breach", "breach", "exfiltration", "data theft", "notification", "pii", "phi"],
  unauthorized_access: ["identity", "account takeover", "compromise", "credential", "unauthorized access", "help desk", "mfa"],
  dos_ddos: ["ddos", "denial of service", "outage", "availability"],
  insider_threat: ["insider", "misconduct", "employee"],
  supply_chain: ["supply chain", "vendor", "third party", "saas"],
  misconfiguration: ["misconfiguration", "exposure", "cloud", "storage"],
  other: [],
};

const STOP = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "our", "your", "are", "was", "has", "have",
  "incident", "response", "playbook", "plan", "attack", "cyber", "critical", "high", "medium", "low",
  "data", "system", "systems", "on", "of", "to", "in", "a", "an", "at", "by", "or", "is",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const p = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!p) return false;
  return ` ${haystack} `.includes(` ${p} `);
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

const TECHNIQUE = /^T\d{4}(?:\.\d{3})?$/i;

export function rankPlaybookDocuments(incident: IncidentSignals, docs: PlaybookDocCandidate[]): RankedPlaybookDoc[] {
  const category = (incident.category ?? "").toLowerCase().trim();
  const keywords = CATEGORY_KEYWORDS[category] ?? (category ? [category.replace(/_/g, " ")] : []);
  const incTokens = new Set([...tokenize(incident.title), ...tokenize(incident.description ?? "")]);
  const techniques = (incident.tags ?? []).map((t) => t.trim().toUpperCase()).filter((t) => TECHNIQUE.test(t));

  const out: RankedPlaybookDoc[] = [];
  for (const d of docs) {
    let score = 0;
    const reasons: string[] = [];
    const title = norm(`${d.title} ${d.collection ?? ""}`);
    const opening = norm(d.text.slice(0, 3000));

    const inTitle = keywords.find((k) => hasPhrase(title, k));
    const inOpening = inTitle ? undefined : keywords.find((k) => hasPhrase(opening, k));
    if (inTitle) {
      score += 100;
      reasons.push(`Title matches ${category.replace(/_/g, " ")}`);
    } else if (inOpening) {
      score += 40;
      reasons.push(`Covers ${category.replace(/_/g, " ")}`);
    }

    const upper = d.text.toUpperCase();
    const hits = techniques.filter((t) => new RegExp(`\\b${t.replace(".", "\\.")}\\b`).test(upper));
    if (hits.length) {
      score += 20 * hits.length;
      reasons.push(`Mentions ${hits.join(", ")}`);
    }

    const titleTokens = new Set(tokenize(d.title));
    const shared = [...incTokens].filter((t) => titleTokens.has(t));
    if (shared.length) {
      score += 12 * shared.length;
      reasons.push(`Title shares ${shared.slice(0, 3).join(", ")}`);
    }
    const headingTokens = new Set(d.headings.flatMap(tokenize));
    const inHeadings = [...incTokens].filter((t) => !titleTokens.has(t) && headingTokens.has(t)).slice(0, 5);
    if (inHeadings.length) {
      score += 4 * inHeadings.length;
      reasons.push(`Sections mention ${inHeadings.slice(0, 3).join(", ")}`);
    }

    if (score > 0) out.push({ id: d.id, title: d.title, scope: d.scope, collection: d.collection, score, reasons });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return out;
}
