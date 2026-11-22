// ExerciseSettings.policy: exercise cadence per framework, required roles, the
// confidentiality marking printed in report headers, and objectives suggested
// for the next exercise (carried from open AFIs).
// Parsed tolerantly: a broken or old policy reads as defaults, never throws.

import { z } from "zod";
import { db, type DbClient } from "@/lib/db";
import { getExerciseSettings } from "@/lib/exercise/settings";
import { defaultCadence } from "@/lib/exercise/content/frameworks";

export const suggestedObjectiveSchema = z.object({
  id: z.string().max(40),
  text: z.string().max(1000),
  capabilityKey: z.string().max(60).nullable().default(null),
  sourceExerciseId: z.string().max(40).nullable().default(null),
  sourceAarId: z.string().max(40).nullable().default(null),
  afiId: z.string().max(40).nullable().default(null),
  createdAt: z.string().max(40),
});
export type SuggestedObjective = z.infer<typeof suggestedObjectiveSchema>;

export const cadenceSchema = z.record(z.string().max(40), z.number().int().min(1).max(60));

export const policySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Months between exercises, per control framework. Overrides defaultCadence. */
  cadence: cadenceSchema.default({}),
  /** Functional roles every exercise should have in the room, for example "Legal". */
  requiredRoles: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  /** Printed in the header of report PDFs and DOCX files, for example "Confidential". Empty prints nothing. */
  confidentialityMarking: z.string().trim().max(120).default(""),
  /** Email domains action-owner reminders may go to (src/improvement/reminders.ts). Empty allows none. */
  reminderDomains: z.array(z.string().trim().max(253)).max(50).default([]),
  suggestedObjectives: z.array(suggestedObjectiveSchema).max(200).default([]),
});
export type Policy = z.infer<typeof policySchema>;

/** What the settings page may change. Suggested objectives are kept as they are. */
export const policyUpdateSchema = z.object({
  cadence: cadenceSchema,
  requiredRoles: z
    .array(z.string().trim().min(1, "Role names cannot be empty.").max(80, "Use 80 characters or fewer."))
    .max(20, "Use 20 roles or fewer.")
    .transform((a) => [...new Set(a)]),
  confidentialityMarking: z
    .string()
    .trim()
    .max(120, "Use 120 characters or fewer.")
    .regex(/^[^\u0000-\u001f\u007f]*$/, "Use plain text on one line.")
    .optional(),
  reminderDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Use domain names such as example.com."),
    )
    .max(50, "Use 50 domains or fewer.")
    .transform((a) => [...new Set(a)])
    .optional(),
});

export function readPolicy(raw: unknown): Policy {
  const parsed = policySchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Keep what still parses, field by field.
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cadence = cadenceSchema.safeParse(r.cadence);
  const roles = z.array(z.string().max(80)).max(20).safeParse(r.requiredRoles);
  const suggested = z.array(suggestedObjectiveSchema).max(200).safeParse(r.suggestedObjectives);
  const marking = z.string().max(120).safeParse(r.confidentialityMarking);
  const domains = z.array(z.string().max(253)).max(50).safeParse(r.reminderDomains);
  return {
    schemaVersion: 1,
    cadence: cadence.success ? cadence.data : {},
    requiredRoles: roles.success ? roles.data : [],
    confidentialityMarking: marking.success ? marking.data.trim() : "",
    reminderDomains: domains.success ? domains.data : [],
    suggestedObjectives: suggested.success ? suggested.data : [],
  };
}

/** The confidentiality marking for report headers, or "". Never throws. */
export async function confidentialityMarking(client: DbClient = db): Promise<string> {
  try {
    return (await getPolicy(client)).confidentialityMarking;
  } catch {
    return "";
  }
}

export async function getPolicy(client: DbClient = db): Promise<Policy> {
  const i = await getExerciseSettings(client);
  return readPolicy(i?.policy);
}

/** Months between exercises for a framework: policy first, then the built-in default. Null when neither sets one. */
export function cadenceMonths(policy: Pick<Policy, "cadence">, framework: string): number | null {
  const set = policy.cadence[framework];
  if (typeof set === "number" && set > 0) return set;
  return (defaultCadence as Record<string, number | undefined>)[framework] ?? null;
}
