import { z } from "zod";

export const CAPABILITY_FRAMEWORK_IDS = ["fema", "nist-csf"] as const;
export type CapabilityFrameworkId = (typeof CAPABILITY_FRAMEWORK_IDS)[number];

export const FEMA_MISSION_AREAS = ["common", "prevention", "protection", "mitigation", "response", "recovery"] as const;
export type FemaMissionArea = (typeof FEMA_MISSION_AREAS)[number];

export const capabilitySchema = z.object({
  framework: z.enum(CAPABILITY_FRAMEWORK_IDS),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  seq: z.number().int().positive(),
  /** NIST CSF: the function key for a category, e.g. "RS" for "RS.MA". */
  parentKey: z.string().optional(),
  /** FEMA only. */
  missionAreas: z.array(z.enum(FEMA_MISSION_AREAS)).optional(),
});

export type Capability = z.infer<typeof capabilitySchema>;
