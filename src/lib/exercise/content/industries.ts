import { z } from "zod";

// Industry templates: fictional organization profiles that ground Crisis Sim
// and Strategic TTX scenarios. All organization names are fictional.

export const industryTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  industry: z.string().min(1),
  orgName: z.string().min(1),
  size: z.string().min(1),
  regions: z.array(z.string()).min(1),
  regulators: z.array(z.string()),
  frameworks: z.array(z.string()),
  crownJewels: z.array(z.string()).min(1),
  keyVendors: z.array(z.string()),
  teams: z.array(z.string()).min(1),
  suggestedActorKeys: z.array(z.string()).optional(),
  profileMd: z.string().min(1),
});

export type IndustryTemplate = z.infer<typeof industryTemplateSchema>;

export const INDUSTRY_TEMPLATES: readonly IndustryTemplate[] = [
  {
    key: "fintech",
    industry: "Financial technology",
    orgName: "Mercury Ledger Financial",
    size: "2,800 employees",
    regions: ["North America", "European Union"],
    regulators: ["State money transmitter regulators", "CFPB", "NYDFS", "Card brands through the acquirer", "EU data protection authorities"],
    frameworks: ["PCI DSS", "SOC 2", "GDPR", "NYDFS Part 500"],
    crownJewels: ["Real-time payment rails", "Card tokenization vault", "Identity and KYC platform", "Fraud decision engine"],
    keyVendors: ["Card processor", "Fraud intelligence provider", "Cloud HSM service", "KYC vendor"],
    teams: ["Executive", "Legal", "Communications", "IT", "Security", "Fraud operations", "Customer support"],
    suggestedActorKeys: ["fin7", "scattered-spider", "lazarus-group"],
    profileMd: `**Mercury Ledger Financial** runs consumer and merchant payments with public payment APIs, a mobile banking gateway, and partner fintech integrations.

- Data: cardholder data, PII, AML and KYC records, transaction metadata.
- Critical functions: payment authorization, settlement and clearing, fraud prevention, account access.
- Constraints: latency-sensitive fraud controls, strict change windows on payment systems, low tolerance for downtime.
- Escalation triggers: sustained authorization failures, fraud losses above threshold, regulator inquiry, outage over 60 minutes.
- Immutable daily backups. RTO under 4 hours. Hybrid SOC with an IR retainer.`,
  },
  {
    key: "healthcare-provider",
    industry: "Healthcare provider",
    orgName: "North Valley Care Network",
    size: "6,400 employees, 4 hospitals",
    regions: ["North America"],
    regulators: ["HHS Office for Civil Rights", "State health department", "State attorney general", "CMS"],
    frameworks: ["HIPAA", "HICP 405(d)", "ISO 27001", "SOC 2"],
    crownJewels: ["EHR platform", "Radiology PACS", "Pharmacy dispensing network", "Emergency department communications"],
    keyVendors: ["EHR vendor", "Managed imaging archive", "Medical device maintenance provider", "Regional health information exchange"],
    teams: ["Executive", "Clinical operations", "Legal and privacy", "Communications", "IT", "Security", "HR"],
    suggestedActorKeys: ["qilin", "lockbit", "scattered-spider"],
    profileMd: `**North Valley Care Network** is a regional health system with emergency, inpatient, and outpatient care.

- Data: PHI, insurance and billing records, imaging metadata.
- Exposure: patient portal, telehealth, physician VPN, lab result exchange.
- Critical functions: emergency care, clinical documentation, medication administration, discharge planning.
- Constraints: legacy clinical devices, care cannot pause, downtime procedures have limited capacity.
- Escalation triggers: EHR down over 30 minutes in acute care, medication workflow disruption, signs of PHI exfiltration.`,
  },
  {
    key: "biotech",
    industry: "Biotechnology",
    orgName: "Helix Frontier BioSystems",
    size: "1,900 employees",
    regions: ["North America", "European Union"],
    regulators: ["FDA", "EMA", "EU data protection authorities", "SEC"],
    frameworks: ["ISO 27001", "SOC 2", "GDPR", "FDA 21 CFR Part 11"],
    crownJewels: ["Clinical trial data lake", "Genomic analysis pipeline", "Lab instrument control network", "GMP manufacturing execution system"],
    keyVendors: ["Contract research organizations", "Cloud genomics compute provider", "MES vendor", "Cold-chain logistics partner"],
    teams: ["Executive", "R&D leadership", "Quality", "Legal and regulatory", "Communications", "IT", "Security"],
    suggestedActorKeys: ["apt29", "apt41", "apt10"],
    profileMd: `**Helix Frontier BioSystems** runs clinical trials, genomic research, and GMP manufacturing.

- Data: trial subject data, genomic sequences, proprietary formulas, batch release records.
- Exposure: research collaboration portals, CRO data exchange, remote lab access.
- Critical functions: clinical data analysis, assay validation, batch release, regulatory submissions.
- Constraints: validated lab systems with long change cycles, mixed IT and OT.
- Escalation triggers: trial data integrity anomalies, access to formula repositories, tampering with release evidence.`,
  },
  {
    key: "health-informatics",
    industry: "Health informatics",
    orgName: "Aegis Health Informatics",
    size: "2,300 employees",
    regions: ["North America"],
    regulators: ["HHS Office for Civil Rights", "State attorneys general", "FTC"],
    frameworks: ["HIPAA", "HITRUST", "SOC 2", "ISO 27001"],
    crownJewels: ["FHIR and HL7 integration hub", "Population health analytics platform", "Claims data warehouse"],
    keyVendors: ["Payer clearinghouse", "Cloud analytics platform", "Managed API gateway provider"],
    teams: ["Executive", "Legal and privacy", "Communications", "Partner success", "IT", "Security", "Operations"],
    suggestedActorKeys: ["storm-0501", "scattered-spider", "shinyhunters"],
    profileMd: `**Aegis Health Informatics** moves clinical and claims data between payers and providers as a business associate.

- Data: PHI, payer claims, provider quality metrics, de-identified analytics.
- Exposure: FHIR APIs, payer and provider integration endpoints, customer analytics portal.
- Critical functions: interoperability, quality reporting, payer and provider reconciliation.
- Constraints: heavy dependence on partner feeds and token-based API trust.
- Escalation triggers: compromised integration tokens, cross-tenant API abuse, degraded partner exchange.`,
  },
  {
    key: "energy",
    industry: "Energy utility",
    orgName: "GridStone Energy Holdings",
    size: "5,400 employees",
    regions: ["North America"],
    regulators: ["FERC", "NERC regional entity", "State public utility commission", "DOE", "CISA"],
    frameworks: ["NERC CIP", "NIST CSF", "ISO 27001", "SOC 2"],
    crownJewels: ["SCADA historian", "Grid dispatch systems", "Substation controls", "Outage management system"],
    keyVendors: ["OT maintenance contractor", "Balancing authority interfaces", "Energy market platform provider"],
    teams: ["Executive", "Grid operations", "Legal and regulatory", "Communications", "IT", "Security", "Field operations"],
    suggestedActorKeys: ["sandworm", "volt-typhoon", "akira"],
    profileMd: `**GridStone Energy Holdings** generates and distributes power across a multi-state service territory.

- Data: grid telemetry, infrastructure topology, market operations data.
- Exposure: remote substation access, supplier connectivity, outage status portals.
- Critical functions: grid reliability, generation dispatch, outage response, reliability reporting.
- Constraints: legacy OT protocols, safety interlocks, widely distributed field assets.
- Escalation triggers: loss of OT visibility, suspicious remote switching commands, risk of a prolonged regional outage.`,
  },
  {
    key: "transportation",
    industry: "Transportation and logistics",
    orgName: "TransitAxis Mobility Group",
    size: "7,200 employees",
    regions: ["North America", "European Union"],
    regulators: ["DOT", "TSA", "EU data protection authorities", "State attorneys general"],
    frameworks: ["SOC 2", "ISO 27001", "GDPR", "TSA security directives"],
    crownJewels: ["Fleet telematics platform", "Dispatch and routing engine", "Maintenance scheduling system", "Customer booking services"],
    keyVendors: ["Fuel and toll service providers", "Logistics exchange network", "Fleet telematics vendor"],
    teams: ["Executive", "Operations", "Legal", "Communications", "IT", "Security", "HR"],
    suggestedActorKeys: ["akira", "lockbit", "volt-typhoon"],
    profileMd: `**TransitAxis Mobility Group** runs passenger transit and freight logistics.

- Data: passenger and shipment records, route and asset telemetry, payments.
- Exposure: booking APIs, partner logistics integrations, onboard device management.
- Critical functions: dispatch, passenger safety communications, asset tracking, route planning.
- Constraints: distributed endpoints, intermittent connectivity, mixed legacy and modern fleet systems.
- Escalation triggers: dispatch outage over 30 minutes, loss of fleet visibility, confirmed customer impact at scale.`,
  },
  {
    key: "retail",
    industry: "Retail and e-commerce",
    orgName: "Corvane Outfitters",
    size: "12,000 employees, 340 stores",
    regions: ["North America", "United Kingdom"],
    regulators: ["Card brands through the acquirer", "State attorneys general", "FTC", "UK Information Commissioner's Office"],
    frameworks: ["PCI DSS", "SOC 2", "UK GDPR", "CCPA"],
    crownJewels: ["E-commerce platform", "Store point-of-sale network", "Loyalty program database", "Distribution center management system"],
    keyVendors: ["Payment processor", "E-commerce platform host", "Third-party logistics provider", "Outsourced help desk"],
    teams: ["Executive", "Store operations", "Legal", "Communications", "IT", "Security", "Customer service"],
    suggestedActorKeys: ["scattered-spider", "fin7", "clop"],
    profileMd: `**Corvane Outfitters** sells apparel and outdoor gear through stores and online.

- Data: payment card data, loyalty member PII, order history.
- Exposure: e-commerce site, mobile app, outsourced help desk, supplier portals.
- Critical functions: online orders, in-store payments, fulfillment, returns.
- Constraints: peak season change freezes, thin margins, high public visibility.
- Escalation triggers: online ordering down, card skimming indicators, loyalty data on a leak site.`,
  },
  {
    key: "manufacturing",
    industry: "Industrial manufacturing",
    orgName: "Tessaline Industrial Works",
    size: "4,100 employees, 9 plants",
    regions: ["North America", "European Union", "Asia Pacific"],
    regulators: ["SEC", "OSHA", "EPA", "EU NIS2 competent authorities"],
    frameworks: ["ISA/IEC 62443", "NIST CSF", "ISO 27001", "NIS2"],
    crownJewels: ["Plant control systems", "ERP and order management", "Product design repository", "Quality management system"],
    keyVendors: ["Industrial automation vendor", "ERP hosting provider", "Contract manufacturers", "Freight forwarders"],
    teams: ["Executive", "Plant operations", "Engineering", "Legal", "Communications", "IT", "Security"],
    suggestedActorKeys: ["lockbit", "apt41", "sandworm"],
    profileMd: `**Tessaline Industrial Works** makes components for the automotive and aerospace supply chains.

- Data: product designs, customer specifications, supplier pricing.
- Exposure: remote vendor access to plant networks, supplier EDI, engineering collaboration tools.
- Critical functions: production scheduling, quality release, shipping to just-in-time customers.
- Constraints: flat plant networks at older sites, long OT patch cycles, customer penalties for late delivery.
- Escalation triggers: production line stoppage, ERP unavailable, design files found outside the company.`,
  },
  {
    key: "higher-education",
    industry: "Higher education",
    orgName: "Halvermoor State University",
    size: "38,000 students, 9,500 staff",
    regions: ["North America"],
    regulators: ["Department of Education", "State attorney general", "Research sponsors"],
    frameworks: ["FERPA", "GLBA Safeguards Rule", "NIST SP 800-171", "HIPAA (academic medical center)"],
    crownJewels: ["Student information system", "Research data storage", "Identity and email platform", "Financial aid system"],
    keyVendors: ["Learning management system provider", "Cloud email provider", "Financial aid processor"],
    teams: ["President's cabinet", "Academic affairs", "Research office", "Legal", "Communications", "IT", "Security"],
    suggestedActorKeys: ["kimsuky", "charming-kitten", "ransomware-cartel"],
    profileMd: `**Halvermoor State University** is a public research university with an academic medical center.

- Data: student records, financial aid data, controlled research data, patient data at the medical center.
- Exposure: open campus networks, many self-managed departmental servers, research collaborations.
- Critical functions: teaching, research continuity, financial aid disbursement, campus safety alerts.
- Constraints: decentralized IT, academic freedom expectations, fixed term calendar.
- Escalation triggers: outage during exams or registration, research data theft, student data on a leak site.`,
  },
  {
    key: "local-government",
    industry: "Local government",
    orgName: "County of Westmarch",
    size: "3,200 employees, population 640,000",
    regions: ["North America"],
    regulators: ["State attorney general", "State election office", "CJIS Systems Agency"],
    frameworks: ["NIST CSF", "CJIS Security Policy", "State breach notification law"],
    crownJewels: ["911 computer-aided dispatch", "Property tax and permitting systems", "Election management system", "Payroll"],
    keyVendors: ["Dispatch software vendor", "Managed service provider", "Payment portal provider"],
    teams: ["County executive", "Emergency management", "Sheriff", "Legal", "Communications", "IT", "Finance"],
    suggestedActorKeys: ["ransomware-cartel", "hacktivist-collective", "volt-typhoon"],
    profileMd: `**County of Westmarch** delivers public safety, tax, court, and election services.

- Data: resident PII, criminal justice information, tax records.
- Exposure: public payment portals, a managed service provider with remote access, legacy court systems.
- Critical functions: 911 dispatch, elections, payroll, permitting.
- Constraints: small security team, public records obligations, budget cycles.
- Escalation triggers: dispatch degraded, outage near an election, resident data published.`,
  },
  {
    key: "water-utility",
    industry: "Water and wastewater",
    orgName: "Cedar Fork Water Authority",
    size: "420 employees, serves 310,000 people",
    regions: ["North America"],
    regulators: ["EPA", "State drinking water program", "CISA"],
    frameworks: ["AWWA cybersecurity guidance", "NIST CSF", "America's Water Infrastructure Act risk assessment"],
    crownJewels: ["Treatment plant SCADA", "Chemical dosing controls", "Billing system", "Lab information system"],
    keyVendors: ["SCADA integrator", "Remote monitoring service", "Billing software provider"],
    teams: ["General manager", "Plant operations", "Legal", "Communications", "IT", "Public health liaison"],
    suggestedActorKeys: ["volt-typhoon", "hacktivist-collective", "ransomware-cartel"],
    profileMd: `**Cedar Fork Water Authority** treats and distributes drinking water and runs two wastewater plants.

- Data: customer billing records, water quality results.
- Exposure: vendor remote access to SCADA, internet-facing controllers at remote pump stations.
- Critical functions: safe treatment, distribution pressure, regulatory sampling.
- Constraints: very small IT staff, long-lived control equipment, manual operation limits.
- Escalation triggers: unexpected setpoint changes, loss of SCADA visibility, boil water advisory risk.`,
  },
  {
    key: "saas",
    industry: "Software as a service",
    orgName: "Lumenstack Software",
    size: "1,100 employees, 6,000 business customers",
    regions: ["North America", "European Union"],
    regulators: ["SEC", "EU data protection authorities", "State attorneys general"],
    frameworks: ["SOC 2", "ISO 27001", "GDPR", "SEC cybersecurity disclosure rules"],
    crownJewels: ["Multi-tenant production platform", "Source code and build pipeline", "Customer identity tenant", "Signing keys"],
    keyVendors: ["Cloud infrastructure provider", "Identity provider", "Code hosting service", "Customer support platform"],
    teams: ["Executive", "Engineering", "Legal", "Communications", "Customer success", "IT", "Security"],
    suggestedActorKeys: ["apt29", "shinyhunters", "scattered-spider"],
    profileMd: `**Lumenstack Software** is a public company selling a workflow platform to mid-size and large businesses.

- Data: customer business records, customer user PII, source code.
- Exposure: public APIs, OAuth integrations, contractor access to engineering systems.
- Critical functions: platform availability, secure releases, customer support.
- Constraints: contractual breach notice windows with enterprise customers, SEC disclosure obligations.
- Escalation triggers: cross-tenant access, signing key exposure, customer data on a leak site.`,
  },
];


const BY_KEY: ReadonlyMap<string, IndustryTemplate> = new Map(INDUSTRY_TEMPLATES.map((t) => [t.key, t]));

export function getIndustryTemplate(key: string): IndustryTemplate | undefined {
  return BY_KEY.get(key);
}
