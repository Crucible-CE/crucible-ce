// Exercise settings for the install's organization. CE runs one organization
// per install; its Organization row holds the name and ExerciseSettings holds
// the exercise options (time zone, capability framework, HSEEP mode, sponsor
// sign-off, retention, policy). The row is created with defaults on first read.

import { z } from "zod";
import type { ExerciseSettings } from "@prisma/client";
import { db, type DbClient, type Tx } from "@/lib/db";

export const CAPABILITY_FRAMEWORKS = [
  { key: "fema", label: "FEMA core capabilities" },
  { key: "nist-csf", label: "NIST CSF 2.0" },
  { key: "custom", label: "Custom" },
] as const;
export type CapabilityFramework = (typeof CAPABILITY_FRAMEWORKS)[number]["key"];

/** Control frameworks findings can be mapped to. */
export const CONTROL_FRAMEWORKS = [
  { key: "nist-csf", label: "NIST CSF 2.0" },
  { key: "pci-dss", label: "PCI DSS 4.0" },
  { key: "hipaa", label: "HIPAA Security Rule" },
  { key: "gdpr", label: "GDPR" },
  { key: "soc2", label: "SOC 2" },
  { key: "iso-22301", label: "ISO 22301" },
  { key: "iso-27001", label: "ISO 27001" },
  { key: "sec", label: "SEC cyber disclosure" },
  { key: "nydfs", label: "NYDFS Part 500" },
] as const;
export type ControlFramework = (typeof CONTROL_FRAMEWORKS)[number]["key"];

const CAPABILITY_KEYS = CAPABILITY_FRAMEWORKS.map((f) => f.key) as [CapabilityFramework, ...CapabilityFramework[]];
const CONTROL_KEYS = CONTROL_FRAMEWORKS.map((f) => f.key) as [ControlFramework, ...ControlFramework[]];

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function timeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, "Pick a valid time zone.");

export const exerciseSettingsSchema = z.object({
  timezone: timeZoneSchema,
  capabilityFramework: z.enum(CAPABILITY_KEYS),
  enabledFrameworks: z.array(z.enum(CONTROL_KEYS)).max(CONTROL_KEYS.length).transform((a) => [...new Set(a)]),
  hseepMode: z.boolean(),
  requireSponsorSignoff: z.boolean(),
  retentionYears: z.number().int().min(1, "Use 1 to 50 years.").max(50, "Use 1 to 50 years."),
  showCloudNotes: z.boolean(),
});

/** Exercise settings plus the organization name. */
export type OrgExerciseSettings = ExerciseSettings & { name: string };

const g = globalThis as typeof globalThis & { __ceExerciseOrgId?: string };

/** The install's organization id (the oldest Organization row). Null before setup. */
export async function installOrgId(client: DbClient = db): Promise<string | null> {
  if (g.__ceExerciseOrgId) return g.__ceExerciseOrgId;
  const org = await client.organization.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  if (org) g.__ceExerciseOrgId = org.id;
  return org?.id ?? null;
}

/** Test-only: forget the cached organization id. */
export function __resetInstallOrgForTests(): void {
  delete g.__ceExerciseOrgId;
}

/** The settings row for the install's organization, created with defaults when missing. Null before setup. */
export async function getExerciseSettings(client: DbClient = db): Promise<OrgExerciseSettings | null> {
  const orgId = await installOrgId(client);
  if (!orgId) return null;
  const [org, row] = await Promise.all([
    client.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    client.exerciseSettings.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} }),
  ]);
  return { ...row, name: org?.name ?? "Crucible CE" };
}

/**
 * Lock the settings row for the rest of the transaction and return it (created
 * with defaults when missing). Null before setup. Use for read-modify-write of
 * the policy JSON.
 */
export async function lockExerciseSettings(tx: Tx): Promise<ExerciseSettings | null> {
  const orgId = await installOrgId(tx);
  if (!orgId) return null;
  await tx.exerciseSettings.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId }, update: {} });
  await tx.$queryRaw`SELECT "organizationId" FROM "ExerciseSettings" WHERE "organizationId" = ${orgId} FOR UPDATE`;
  return tx.exerciseSettings.findUnique({ where: { organizationId: orgId } });
}
