// The fictional organization, people, vendors and clocks shared by every
// template and playbook in the healthcare collection. Facts about attacks and
// rules follow research/threat-brief-2026-10 (internal). All organizations,
// people, domains and tenants here are fictional. IP addresses are from the
// RFC 5737 documentation ranges.

export const ORG = "Quarrystone Health Analytics";
export const DOMAIN = "quarrystonehealth.example";

/** One paragraph org profile, used in every template config. */
export const ORG_PROFILE_MD =
  `**${ORG}, Inc.** is a healthcare data analytics company in Columbus, Ohio, listed on Nasdaq, with about 800 staff. ` +
  "It is a HIPAA business associate to 46 hospital, health system and health plan customers in 19 states, including Texas and California, and holds protected health information (PHI) on about 11 million patients and members. " +
  "Customer feeds land in Azure Data Lake Storage, are modeled in an Azure Databricks PHI warehouse and Azure SQL, and are served back as dashboards and quality reports from analytics VMs. " +
  "Identity is Entra ID, synced from on-premises Active Directory by one Entra Connect server; Defender XDR, Intune and Azure Backup are in place. " +
  "Customer and support cases live in Salesforce. An outsourced help desk, Altamesa Service Desk, resets passwords and MFA around the clock. " +
  "Every customer business associate agreement (BAA) requires notice of a security incident involving customer PHI within 5 business days of discovery.";

export const PEOPLE = {
  ceo: "Dana Whitlock",
  ciso: "Marcus Ferreira",
  gc: "Priya Raman",
  cio: "Tom Okafor",
  comms: "Lena Brandt",
  cs: "Alicia Moreno",
} as const;

export const VENDORS = {
  helpDesk: "Altamesa Service Desk",
  ir: "Kestrel Point Incident Response",
  counsel: "Ressler Kemp LLP",
  insurer: "Halbrook Specialty",
} as const;

/** Covered entity customers that appear in pressure artifacts. Bayline is public. */
export const CUSTOMERS = {
  hospital: "Saint Aldric Health",
  plan: "Bayline Health Plan",
  regional: "Northvale Regional Medical Center",
  childrens: "Cedar Prairie Children's Hospital",
} as const;

/**
 * Regulatory and contractual clocks. The BAA clock is contractual, not a
 * regulation: HIPAA's outer limit for a business associate is 60 days
 * (45 CFR 164.410); the customer contracts set 5 business days.
 */
export const CLOCKS = {
  baa: { key: "baa_notice", label: "Customer BAA incident notice (contractual, 5 business days)", businessDays: 5 },
  hipaa: { key: "hipaa_ba_60d", label: "HIPAA breach notice to covered entities (45 CFR 164.410, 60 days)", durationHours: 60 * 24 },
  stateAg: { key: "state_ag", label: "Texas attorney general notice (30 days, 250 or more residents)", durationHours: 30 * 24 },
  sec: { key: "sec_8k", label: "SEC Form 8-K Item 1.05", businessDays: 4 },
  insurer: { key: "insurer_notice", label: "Cyber insurer notice (policy: 48 hours)", durationHours: 48 },
} as const;

export const STRATEGIC_TEAMS = ["Executive", "Legal and Privacy", "Communications", "Security", "IT and Cloud Operations", "Customer Success"];

export const HEALTHCARE_COLLECTION_LABEL = "Healthcare data analytics on Azure";
