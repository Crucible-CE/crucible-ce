import { z } from "zod";

// Shared input-size limits for API request validation (OWASP ASVS L5 input
// bounds). Every free-text field a route accepts should carry a .max() from
// here (or a tighter one), so no single field can push megabytes into the DB,
// the ledger, notifications, or exports. Existing tighter limits stay as-is.
export const LIMITS = {
  ID: 100, // cuid / uuid / opaque ids
  TAG: 64, // categories, codes, short enum-like strings
  SHORT_LABEL: 100,
  TITLE: 200,
  NAME: 200,
  EMAIL: 320,
  PHONE: 30,
  PASSWORD: 256,
  URL: 2048,
  TIMEZONE: 64,
  REASON: 2_000,
  CHAT: 4_000,
  COMMENT: 4_000,
  DESCRIPTION: 20_000,
  NOTES: 20_000,
  BODY: 20_000,
  JSON_STRING: 20_000,
  /** Serialized size cap for free-form JSON values (z.record / z.any). */
  JSON_BYTES: 100_000,
  /** Postgres INTEGER ceiling (Prisma Int columns overflow → 500 above it). */
  INT32_MAX: 2_147_483_647,
  /** Default item cap for arrays of strings/objects. */
  ARRAY: 200,
} as const;

/** True when the serialized JSON value fits within `max` characters. */
export function jsonWithin(value: unknown, max: number = LIMITS.JSON_BYTES): boolean {
  if (value === undefined) return true;
  try {
    return JSON.stringify(value).length <= max;
  } catch {
    return false; // cyclic / non-serializable
  }
}

/** Wrap a free-form zod schema with a serialized-size cap. */
export function boundedJson<T extends z.ZodType>(schema: T, max: number = LIMITS.JSON_BYTES) {
  return schema.refine((v) => jsonWithin(v, max), { message: `JSON value exceeds ${max} characters` });
}

/** True when the string contains a NUL byte (Postgres text rejects \u0000). */
export function hasNul(s: string): boolean {
  return s.includes("\u0000");
}

/** Remove NUL bytes from text bound for a Prisma/Postgres text column. */
export function stripNul(s: string): string {
  return s.includes("\u0000") ? s.split("\u0000").join("") : s;
}
