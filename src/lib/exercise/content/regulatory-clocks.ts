import { z } from "zod";
import { frameworkIdSchema } from "./frameworks/types";

// Regulatory clock presets for exercises. The clock starts at a scenario
// time chosen by the facilitator (usually when the trigger is reached in
// play). These are exercise aids, not legal advice. The SEC clock counts
// business days.

export const CLOCK_TRIGGERS = [
  "discovery",
  "awareness",
  "determination",
  "materiality_determination",
  "payment",
  "policy",
] as const;

export const regulatoryClockPresetSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1),
    durationHours: z.number().positive().optional(),
    businessDays: z.number().int().positive().optional(),
    trigger: z.enum(CLOCK_TRIGGERS),
    framework: frameworkIdSchema.optional(),
    citation: z.string().optional(),
    note: z.string().min(1),
  })
  .refine((p) => (p.durationHours === undefined) !== (p.businessDays === undefined), {
    message: "Set exactly one of durationHours or businessDays",
  });

export type RegulatoryClockPreset = z.infer<typeof regulatoryClockPresetSchema>;

export const REGULATORY_CLOCK_PRESETS: readonly RegulatoryClockPreset[] = [
  {
    key: "sec_8k",
    label: "SEC Form 8-K Item 1.05",
    businessDays: 4,
    trigger: "materiality_determination",
    framework: "sec",
    citation: "Form 8-K Item 1.05",
    note: "File within four business days after the company determines the incident is material.",
  },
  {
    key: "gdpr_72h",
    label: "GDPR supervisory authority notice",
    durationHours: 72,
    trigger: "awareness",
    framework: "gdpr",
    citation: "GDPR Art. 33",
    note: "Notify the lead supervisory authority within 72 hours of becoming aware of the breach.",
  },
  {
    key: "nydfs_72h",
    label: "NYDFS incident notice",
    durationHours: 72,
    trigger: "determination",
    framework: "nydfs",
    citation: "23 NYCRR 500.17(a)",
    note: "Notify the superintendent within 72 hours of determining a reportable incident occurred.",
  },
  {
    key: "nydfs_ransom_24h",
    label: "NYDFS extortion payment notice",
    durationHours: 24,
    trigger: "payment",
    framework: "nydfs",
    citation: "23 NYCRR 500.17(c)",
    note: "Report an extortion payment within 24 hours, then explain it in writing within 30 days.",
  },
  {
    key: "hipaa_60d",
    label: "HIPAA breach notice to individuals",
    durationHours: 60 * 24,
    trigger: "discovery",
    framework: "hipaa",
    citation: "45 CFR 164.404",
    note: "Notify affected individuals without unreasonable delay and no later than 60 days after discovery.",
  },
  {
    key: "pci_brand",
    label: "Card brand and acquirer notice",
    durationHours: 24,
    trigger: "discovery",
    framework: "pci-dss",
    citation: "PCI DSS 12.10.1 and card brand rules",
    note: "Card brand rules expect prompt notice through the acquirer. 24 hours is a common internal target.",
  },
  {
    key: "insurer_notice",
    label: "Cyber insurer notice",
    durationHours: 48,
    trigger: "discovery",
    note: "Most policies require notice as soon as practicable. Check the policy for the actual term and the breach hotline.",
  },
  {
    key: "state_ag",
    label: "State attorney general notice",
    durationHours: 30 * 24,
    trigger: "discovery",
    note: "Varies by state, commonly 30 to 60 days. Some states require notice before or with notice to residents.",
  },
  {
    key: "cisa_72h",
    label: "CISA covered incident report",
    durationHours: 72,
    trigger: "awareness",
    citation: "CIRCIA",
    note: "Covered entities report covered cyber incidents within 72 hours once the CIRCIA final rule is in effect. Confirm current status.",
  },
  {
    key: "cisa_ransom_24h",
    label: "CISA ransom payment report",
    durationHours: 24,
    trigger: "payment",
    citation: "CIRCIA",
    note: "Covered entities report ransom payments within 24 hours once the CIRCIA final rule is in effect. Confirm current status.",
  },
  {
    key: "nis2_24h",
    label: "NIS2 early warning",
    durationHours: 24,
    trigger: "awareness",
    citation: "Directive (EU) 2022/2555 Art. 23",
    note: "Send an early warning within 24 hours, an incident notification within 72 hours, and a final report within one month.",
  },
  {
    key: "dora_initial",
    label: "DORA major incident initial notice",
    durationHours: 24,
    trigger: "awareness",
    citation: "Regulation (EU) 2022/2554 Art. 19",
    note: "Initial notice is due within 4 hours of classifying the incident as major and no later than 24 hours after awareness.",
  },
  {
    key: "nerc_cip_008",
    label: "NERC CIP-008 initial notice to E-ISAC and CISA",
    durationHours: 1,
    trigger: "determination",
    citation: "NERC CIP-008-6 R4",
    note: "Initial notice within 1 hour of determining a Reportable Cyber Security Incident: compromise or disruption of an ESP, an EACMS (including an Intermediate System such as a jump server) or a BES Cyber System.",
  },
  {
    key: "nerc_cip_008_attempt",
    label: "NERC CIP-008 notice of an attempted compromise",
    durationHours: 24,
    trigger: "determination",
    citation: "NERC CIP-008-6 R4",
    note: "An attempt to compromise an ESP, EACMS or BES Cyber System is reported by the end of the next calendar day after the determination. The clock uses 24 hours as the earliest case.",
  },
  {
    key: "doe_oe417_1h",
    label: "DOE OE-417 emergency alert",
    durationHours: 1,
    trigger: "determination",
    citation: "DOE Form OE-417",
    note: "Report within 1 hour when a cyber event causes interruption of electrical system operations.",
  },
  {
    key: "doe_oe417_6h",
    label: "DOE OE-417 normal report",
    durationHours: 6,
    trigger: "determination",
    citation: "DOE Form OE-417",
    note: "Report within 6 hours when a cyber event could potentially affect electric power system adequacy or reliability.",
  },
];

/**
 * Adds business days (Monday to Friday, UTC) to a start time, keeping the
 * time of day. A start on a weekend counts from the next Monday. Holidays are
 * not modeled.
 */
export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

/** Deadline for a preset that starts at triggeredAt (scenario time). */
export function computeClockDeadline(
  preset: Pick<RegulatoryClockPreset, "durationHours" | "businessDays">,
  triggeredAt: Date,
): Date {
  if (preset.businessDays !== undefined) return addBusinessDays(triggeredAt, preset.businessDays);
  return new Date(triggeredAt.getTime() + (preset.durationHours ?? 0) * 3_600_000);
}
