import { z } from "zod";

export const FRAMEWORK_IDS = [
  "nist-csf",
  "pci-dss",
  "hipaa",
  "gdpr",
  "soc2",
  "iso-22301",
  "iso-27001",
  "sec",
  "nydfs",
  "nist-800-61",
  "nist-800-84",
] as const;
export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

export const frameworkIdSchema = z.enum(FRAMEWORK_IDS);

export const FRAMEWORK_KINDS = ["regulation", "standard", "guidance"] as const;

export const frameworkSchema = z.object({
  id: frameworkIdSchema,
  label: z.string().min(1),
  kind: z.enum(FRAMEWORK_KINDS),
  sourceUrl: z.string().url().optional(),
});
export type Framework = z.infer<typeof frameworkSchema>;

export const testCadenceSchema = z.object({
  months: z.number().int().positive(),
  note: z.string().min(1),
});
export type TestCadence = z.infer<typeof testCadenceSchema>;

export const controlSchema = z.object({
  framework: frameworkIdSchema,
  frameworkLabel: z.string().min(1),
  controlId: z.string().min(1),
  title: z.string().min(1),
  /** One plain sentence in our own words. Not the official text. */
  summary: z.string().min(1),
  testCadence: testCadenceSchema.optional(),
});
export type Control = z.infer<typeof controlSchema>;
