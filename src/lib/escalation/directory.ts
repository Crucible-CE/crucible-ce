// ---------------------------------------------------------------------------
// External emergency-contact directory (mock).
//
// Pre-seeded list of federal, sector-regulator, and well-known
// incident-response retainers that any org can pull into their own
// EscalationContact table with one tap. This is a static catalog for
// now; eventually it would sync from a Crucible-curated platform-wide
// directory the same way PlatformTemplate distributes shared content.
// ---------------------------------------------------------------------------

export type DirectoryRole =
  | "regulator"
  | "vendor"
  | "other";

export interface DirectoryContact {
  /** Stable slug — used to skip duplicate imports. */
  slug: string;
  name: string;
  title: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  role: DirectoryRole;
  /** Default tier when added to an org's matrix. */
  tier: 1 | 2 | 3;
  /** Default severity gate. */
  severityLevel: "any" | "high" | "critical";
  /** Short body shown in the picker. */
  description: string;
  /** Optional category for grouping in the picker UI. */
  category: "Federal" | "Sector Regulator" | "Law Enforcement" | "IR Retainer";
  /** Optional notes pre-filled when imported. */
  notes?: string;
}

export const EXTERNAL_DIRECTORY: DirectoryContact[] = [
  // --- Federal ----------------------------------------------------------
  {
    slug: "cisa-24x7",
    name: "CISA Central (Cyber Incident Reporting)",
    title: "Federal cyber incident reporting & coordination",
    phone: "1-888-282-0870",
    email: "central@cisa.dhs.gov",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Federal",
    description:
      "CISA 24/7 watch line. Required for CIRCIA-covered entities.",
    notes:
      "CIRCIA deadlines for covered entities: 72 hours for substantial cyber incidents, 24 hours for ransom payments.",
  },
  {
    slug: "fbi-cyber",
    name: "FBI Cyber Division (IC3)",
    title: "Cybercrime referrals, ransomware, BEC",
    phone: "1-855-292-3937",
    alternatePhone: "1-202-324-3000",
    email: "cywatch@fbi.gov",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Federal",
    description:
      "FBI 24/7 CyWatch. File complaints at ic3.gov. Call CyWatch for active intrusions.",
    notes: "Reports go to the nearest FBI field office cyber squad.",
  },
  {
    slug: "secret-service-eccc",
    name: "U.S. Secret Service (ECCC)",
    title: "Financial crime, payment-card theft, BEC wire fraud",
    phone: "1-877-242-3375",
    role: "regulator",
    tier: 2,
    severityLevel: "high",
    category: "Federal",
    description:
      "Electronic Crimes Coordination Center. Leads on payment-card breaches and BEC wire recovery (Financial Fraud Kill Chain).",
  },

  // --- Law Enforcement -------------------------------------------------
  {
    slug: "local-pd-non-emergency",
    name: "Local Police (Non-Emergency)",
    title: "Local law-enforcement coordination",
    phone: "[PROVIDE local non-emergency #]",
    role: "other",
    tier: 2,
    severityLevel: "any",
    category: "Law Enforcement",
    description:
      "Add your local non-emergency police number. Call 911 for life-safety events.",
  },
  {
    slug: "fbi-field-office",
    name: "FBI Field Office (Local)",
    title: "Local FBI field office liaison",
    phone: "[PROVIDE local field office #]",
    role: "other",
    tier: 2,
    severityLevel: "high",
    category: "Law Enforcement",
    description:
      "Find your field office at fbi.gov/contact-us.",
  },

  // --- Sector Regulators -----------------------------------------------
  {
    slug: "hhs-ocr",
    name: "HHS Office for Civil Rights",
    title: "HIPAA breach reporting (healthcare)",
    phone: "1-800-368-1019",
    email: "OCRMail@hhs.gov",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Sector Regulator",
    description:
      "HIPAA covered entities and business associates. Notify within 60 days of discovery, immediately for 500+ affected individuals.",
  },
  {
    slug: "sec-iro",
    name: "SEC Office of Investor Education & Advocacy",
    title: "Material cybersecurity disclosure (public companies)",
    phone: "1-800-732-0330",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Sector Regulator",
    description:
      "Form 8-K within 4 business days of a materiality determination. Consult General Counsel first.",
  },
  {
    slug: "nydfs",
    name: "NYDFS Cyber Event Reporting",
    title: "NY financial-services 23 NYCRR 500 reporting",
    phone: "1-800-342-3736",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Sector Regulator",
    description:
      "NY-licensed financial entities. Notify within 72 hours of a reportable event under 500.17.",
  },
  {
    slug: "ferc-nerc",
    name: "NERC E-ISAC",
    title: "Electric-sector cyber threat sharing",
    phone: "1-770-578-4070",
    email: "operations@eisac.com",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Sector Regulator",
    description:
      "Electric sector ISAC. NERC CIP-008 reportable events go here.",
  },
  {
    slug: "tsa-pipeline",
    name: "TSA Pipeline Security",
    title: "Oil & gas pipeline cyber reporting",
    phone: "1-866-615-5150",
    role: "regulator",
    tier: 1,
    severityLevel: "high",
    category: "Sector Regulator",
    description:
      "Pipeline owners and operators report incidents per TSA Security Directives.",
  },

  // --- IR Retainers / MSSPs (well-known, generic) ---------------------
  {
    slug: "mandiant-ir",
    name: "Mandiant Consulting (Google Cloud)",
    title: "Incident response retainer (1st party)",
    phone: "1-833-336-7338",
    role: "vendor",
    tier: 1,
    severityLevel: "high",
    category: "IR Retainer",
    description:
      "Reference number. Replace with your own retainer's 24/7 hotline.",
    notes:
      "[PROVIDE retainer contract, account manager, hours remaining]",
  },
  {
    slug: "crowdstrike-ir",
    name: "CrowdStrike Services (IR)",
    title: "Incident response retainer",
    phone: "1-855-276-9347",
    role: "vendor",
    tier: 1,
    severityLevel: "high",
    category: "IR Retainer",
    description:
      "Reference number. Replace with your account team's bridge line if you have a retainer.",
  },
];

export function directoryByCategory(): Array<{
  category: DirectoryContact["category"];
  contacts: DirectoryContact[];
}> {
  const cats: DirectoryContact["category"][] = [
    "Federal",
    "Sector Regulator",
    "Law Enforcement",
    "IR Retainer",
  ];
  return cats.map((c) => ({
    category: c,
    contacts: EXTERNAL_DIRECTORY.filter((d) => d.category === c),
  }));
}
