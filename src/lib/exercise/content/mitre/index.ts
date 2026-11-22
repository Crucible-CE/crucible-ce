import { z } from "zod";
import { ATTACK_CATALOG_ROWS } from "./catalog.generated";

/** ATT&CK Enterprise tactics in kill chain order. The catalog generator maps phases to these ids. @public */
export const ATTACK_TACTICS = [
  { id: "TA0043", name: "Reconnaissance" },
  { id: "TA0042", name: "Resource Development" },
  { id: "TA0001", name: "Initial Access" },
  { id: "TA0002", name: "Execution" },
  { id: "TA0003", name: "Persistence" },
  { id: "TA0004", name: "Privilege Escalation" },
  { id: "TA0005", name: "Defense Evasion" },
  { id: "TA0006", name: "Credential Access" },
  { id: "TA0007", name: "Discovery" },
  { id: "TA0008", name: "Lateral Movement" },
  { id: "TA0009", name: "Collection" },
  { id: "TA0011", name: "Command and Control" },
  { id: "TA0010", name: "Exfiltration" },
  { id: "TA0040", name: "Impact" },
] as const;

const TECHNIQUE_ID_RE = /^T\d{4}(?:\.\d{3})?$/;

export const attackTechniqueSchema = z.object({
  id: z.string().regex(TECHNIQUE_ID_RE),
  name: z.string().min(1),
  tactics: z.array(z.string().regex(/^TA\d{4}$/)).min(1),
  isSubtechnique: z.boolean(),
  parentId: z.string().regex(TECHNIQUE_ID_RE).optional(),
});

export type AttackTechnique = z.infer<typeof attackTechniqueSchema>;

export const ATTACK_TECHNIQUES: readonly AttackTechnique[] = ATTACK_CATALOG_ROWS.map(
  ([id, name, tactics]) => {
    const isSubtechnique = id.includes(".");
    return {
      id,
      name,
      tactics: tactics.split(","),
      isSubtechnique,
      ...(isSubtechnique ? { parentId: id.split(".")[0] } : {}),
    };
  },
);

const BY_ID: ReadonlyMap<string, AttackTechnique> = new Map(
  ATTACK_TECHNIQUES.map((t) => [t.id, t]),
);

/**
 * Normalizes a technique ID: trims, uppercases, and accepts "t1059.001" or
 * "T1059/001". Returns null when the input is not shaped like a technique ID.
 * Does not check that the technique exists; use isValidTechniqueId for that.
 */
export function normalizeTechniqueId(input: string): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toUpperCase().replace("/", ".");
  return TECHNIQUE_ID_RE.test(s) ? s : null;
}

/** True when the input normalizes to a technique in the catalog. */
export function isValidTechniqueId(input: string): boolean {
  const id = normalizeTechniqueId(input);
  return id !== null && BY_ID.has(id);
}

export function getTechnique(input: string): AttackTechnique | undefined {
  const id = normalizeTechniqueId(input);
  return id ? BY_ID.get(id) : undefined;
}

/** Full display name, e.g. "Command and Scripting Interpreter: PowerShell". */
export function getTechniqueFullName(input: string): string | undefined {
  const t = getTechnique(input);
  if (!t) return undefined;
  if (!t.parentId) return t.name;
  const parent = BY_ID.get(t.parentId);
  return parent ? `${parent.name}: ${t.name}` : t.name;
}

/** Most ATT&CK tags one inject carries. */
export const MAX_ATTACK_TAGS = 10;

/**
 * Tag list from stored JSON: normalized, deduplicated, only catalog IDs, at
 * most max. Anything else is dropped, so a stale or hand-edited tag never
 * breaks a template.
 */
export function cleanTechniqueIds(input: unknown, max = MAX_ATTACK_TAGS): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const id = normalizeTechniqueId(raw);
    if (id && BY_ID.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Catalog search by ID or name for the tag picker. An ID prefix ranks first,
 * then a name match. Empty query returns nothing.
 */
export function searchTechniques(query: string, limit = 20): AttackTechnique[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const id = q.toUpperCase().replace("/", ".");
  const byId: AttackTechnique[] = [];
  const byName: AttackTechnique[] = [];
  for (const t of ATTACK_TECHNIQUES) {
    if (t.id.startsWith(id)) byId.push(t);
    else if ((getTechniqueFullName(t.id) ?? t.name).toLowerCase().includes(q)) byName.push(t);
  }
  return [...byId, ...byName].slice(0, limit);
}
