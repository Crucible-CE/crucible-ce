// ---------------------------------------------------------------------------
// CSV import + vCard export helpers for the Escalation Matrix.
//
// CSV parsing tolerant of common quirks: optional header, quoted fields
// with embedded commas, BOM, CRLF / LF line endings. Field names are
// case-insensitive and accept several aliases (eg. "Mobile" → phone).
//
// vCard output emits version 3.0 — compatible with iOS Contacts,
// Android People, Outlook, Google Contacts. We deliberately avoid 4.0
// because Apple's Contacts.app still has rough edges with v4.
// ---------------------------------------------------------------------------

export interface CsvRow {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  alternatePhone?: string;
  tier: 1 | 2 | 3;
  severityLevel: "any" | "high" | "critical";
  role: "technical" | "executive" | "legal" | "pr" | "vendor" | "regulator" | "other";
  notes?: string;
}

export interface CsvParseResult {
  rows: CsvRow[];
  errors: Array<{ line: number; reason: string; original: string }>;
}

const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  name: "name",
  "full name": "name",
  contact: "name",
  title: "title",
  role_title: "title",
  position: "title",
  email: "email",
  "email address": "email",
  phone: "phone",
  mobile: "phone",
  "phone number": "phone",
  primary: "phone",
  altphone: "alternatePhone",
  "alt phone": "alternatePhone",
  "alternate phone": "alternatePhone",
  alternate: "alternatePhone",
  secondary: "alternatePhone",
  tier: "tier",
  level: "tier",
  severity: "severityLevel",
  "severity level": "severityLevel",
  role: "role",
  category: "role",
  notes: "notes",
  comment: "notes",
};

const ROLE_VALUES = new Set(["technical", "executive", "legal", "pr", "vendor", "regulator", "other"]);
const SEVERITY_VALUES = new Set(["any", "high", "critical"]);

// Minimal CSV tokenizer. Handles quoted fields with embedded commas
// and "" escapes. Doesn't try to handle multi-line quoted fields —
// users with that requirement should fall back to manual entry.
function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        out.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
  }
  out.push(buf);
  return out.map((s) => s.trim());
}

export function parseCsv(text: string): CsvParseResult {
  const rows: CsvRow[] = [];
  const errors: CsvParseResult["errors"] = [];
  if (!text) return { rows, errors };

  // Strip BOM, normalize newlines, drop empty trailing lines.
  const cleaned = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows, errors };

  // Detect header: if line 1 contains "name" or "email" we treat the
  // first row as a header; otherwise we assume a default column order
  // (name, title, email, phone, alt phone, role, tier, severity, notes).
  const first = tokenize(lines[0]).map((s) => s.toLowerCase());
  let header: Array<keyof CsvRow | null>;
  let bodyStart = 0;
  const looksLikeHeader = first.some((c) => HEADER_ALIASES[c]);
  if (looksLikeHeader) {
    header = first.map((c) => HEADER_ALIASES[c] ?? null);
    bodyStart = 1;
  } else {
    header = ["name", "title", "email", "phone", "alternatePhone", "role", "tier", "severityLevel", "notes"];
  }

  for (let i = bodyStart; i < lines.length; i++) {
    const original = lines[i];
    const cells = tokenize(original);
    const draft: Partial<CsvRow> = {};
    for (let c = 0; c < header.length && c < cells.length; c++) {
      const key = header[c];
      if (!key) continue;
      const raw = cells[c].trim();
      if (!raw) continue;
      if (key === "tier") {
        const n = parseInt(raw, 10);
        if (n === 1 || n === 2 || n === 3) draft.tier = n;
        else
          errors.push({ line: i + 1, reason: `Invalid tier "${raw}". Use 1, 2 or 3.`, original });
      } else if (key === "severityLevel") {
        const v = raw.toLowerCase();
        if (SEVERITY_VALUES.has(v)) draft.severityLevel = v as CsvRow["severityLevel"];
        else
          errors.push({
            line: i + 1,
            reason: `Invalid severity "${raw}". Use any, high or critical.`,
            original,
          });
      } else if (key === "role") {
        const v = raw.toLowerCase();
        if (ROLE_VALUES.has(v)) draft.role = v as CsvRow["role"];
        else
          errors.push({
            line: i + 1,
            reason: `Invalid role "${raw}". Use technical, executive, legal, pr, vendor, regulator or other.`,
            original,
          });
      } else {
        (draft as Record<string, unknown>)[key] = raw;
      }
    }
    if (!draft.name) {
      errors.push({ line: i + 1, reason: "Missing name.", original });
      continue;
    }
    rows.push({
      name: draft.name,
      title: draft.title,
      email: draft.email,
      phone: draft.phone,
      alternatePhone: draft.alternatePhone,
      tier: draft.tier ?? 1,
      severityLevel: draft.severityLevel ?? "any",
      role: draft.role ?? "other",
      notes: draft.notes,
    });
  }
  return { rows, errors };
}

// ---------------------------------------------------------------------------
// vCard 3.0 emission
// ---------------------------------------------------------------------------

export interface VCardInput {
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  notes?: string | null;
  organization?: string | null;
}

function vcfEscape(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function buildVCard(input: VCardInput): string {
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcfEscape(input.name)}`,
    // Apple wants N: too — fall back to last/first split on the last
    // space, else dump everything as the family-name component.
    nField(input.name),
  ];
  if (input.title) lines.push(`TITLE:${vcfEscape(input.title)}`);
  if (input.organization) lines.push(`ORG:${vcfEscape(input.organization)}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL,VOICE:${vcfEscape(input.phone)}`);
  if (input.alternatePhone) lines.push(`TEL;TYPE=WORK,VOICE:${vcfEscape(input.alternatePhone)}`);
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET:${vcfEscape(input.email)}`);
  if (input.notes) lines.push(`NOTE:${vcfEscape(input.notes)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

function nField(name: string): string {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return `N:${vcfEscape(parts[0])};;;;`;
  const last = parts.pop() ?? "";
  return `N:${vcfEscape(last)};${vcfEscape(parts.join(" "))};;;`;
}

/** Trigger a browser download of one or many vCards as a single .vcf file. */
export function downloadVCards(cards: VCardInput[], filename = "escalation-contacts.vcf"): void {
  if (typeof window === "undefined") return;
  const vcards = cards.map(buildVCard).join("\r\n");
  const blob = new Blob([vcards], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
