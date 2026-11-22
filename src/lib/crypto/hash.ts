import { createHash } from "crypto";

/**
 * Deterministic JSON stringify with object keys sorted at every depth, so the
 * same logical value always serializes identically regardless of key insertion
 * order. Used for hashing ledger payloads (src/lib/ledger/append.ts).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
