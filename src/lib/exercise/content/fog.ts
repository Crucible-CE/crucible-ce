import { z } from "zod";
import { SCENARIO_DOMAIN_KEYS } from "./domains";

// Fog-of-war events, CISA-style scenario seeds, and common scenarios.
// Fog effects are written for decision-level play (no log field corruption).

// ---------------------------------------------------------------------------
// Fog of war
// ---------------------------------------------------------------------------

export const fogEventSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  /** Shown to players. */
  description: z.string().min(1),
  /** Instruction for the inject author. Not shown to players. */
  effect: z.string().min(1),
});

export type FogEvent = z.infer<typeof fogEventSchema>;

export const FOG_EVENTS: readonly FogEvent[] = [
  {
    key: "log-gap",
    title: "Logging gap",
    description: "Part of the security logging pipeline failed. Some recent activity cannot be reviewed.",
    effect:
      "Evidence for the next window is incomplete. Facts that depend on logs must be stated as unknown or partial. Players must decide without full scope.",
  },
  {
    key: "alert-storm",
    title: "Alert storm",
    description: "Dozens of unrelated alerts fired at once and the security queue is overwhelmed.",
    effect:
      "Add noise. Mention several unrelated alerts competing for attention. Players must choose what to prioritize and what to defer.",
  },
  {
    key: "comms-degraded",
    title: "Internal communications degraded",
    description: "Email and chat are unreliable. Some teams cannot be reached quickly.",
    effect:
      "Escalation is slower than planned. One named team or leader cannot be reached this round. Players must decide whether to use out-of-band channels.",
  },
  {
    key: "vendor-breach",
    title: "Vendor reports a breach",
    description: "A key vendor reports possible unauthorized access to its systems.",
    effect:
      "Introduce a third-party complication. Players must assess whether the vendor's trusted access exposes them and whether to cut it.",
  },
  {
    key: "backup-integrity",
    title: "Backup integrity in doubt",
    description: "Integrity checks failed for recent backup snapshots.",
    effect:
      "Recent backups may be unusable or tainted. Restoration options are narrower and slower. Players must weigh older clean data against faster recovery.",
  },
  {
    key: "media-inquiry",
    title: "Reporter calls early",
    description: "A reporter says a source told them about the incident and asks for comment within the hour.",
    effect:
      "Public exposure arrives before the organization is ready. Players must decide whether to confirm, hold, or decline, and who speaks.",
  },
  {
    key: "key-person-out",
    title: "Key person unavailable",
    description: "A decision maker is on a flight with no connectivity for the next several hours.",
    effect:
      "A named decision owner is out of reach. Players must use delegation of authority or wait. Test whether succession is documented.",
  },
  {
    key: "conflicting-intel",
    title: "Conflicting information",
    description: "Two trusted sources give opposite assessments of how far the attacker got.",
    effect:
      "Present two credible but conflicting reports. Players must decide which to act on and how to state uncertainty to leadership.",
  },
  {
    key: "deadline-moved",
    title: "Extortion deadline moved up",
    description: "The attacker cut the deadline in half and threatened to contact customers directly.",
    effect:
      "Compress the timeline. Pending decisions on payment, notification, and public statements must be made sooner.",
  },
  {
    key: "employee-leak",
    title: "Employee post goes public",
    description: "An employee posted about the outage on social media and it is spreading.",
    effect:
      "Internal facts are now public in an uncontrolled form. Players must decide on internal guidance and whether to accelerate external messaging.",
  },
  {
    key: "attacker-on-bridge",
    title: "Attacker on the incident bridge",
    description: "An unknown participant joined the incident call, and the attacker seems to know the response plan.",
    effect:
      "Show signs the attacker reads the incident chat or joins the bridge with a compromised account (CISA AA23-320A describes this). Players must decide on out-of-band channels and who verifies participants.",
  },
  {
    key: "edr-tampered",
    title: "EDR tampered with",
    description: "Endpoint agents on several servers stopped reporting at the same time.",
    effect:
      "The attacker loaded a vulnerable signed driver to kill endpoint protection (BYOVD). Telemetry for those hosts is gone. Players must decide how to contain and scope without their main tool.",
  },
  {
    key: "re-entry-after-eviction",
    title: "Attacker back after eviction",
    description: "Activity from the attacker appears again after the environment was declared clean.",
    effect:
      "Persistence was missed: a scheduled task, a new account, a remote management tool or a stolen token. Players must decide whether to reopen the incident, reset krbtgt again and what to tell those who heard it was over.",
  },
];

// ---------------------------------------------------------------------------
// CISA-style scenario seeds
// ---------------------------------------------------------------------------

export const scenarioSeedSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  hazard: z.string().min(1),
  sectors: z.array(z.string()).min(1),
});

export type ScenarioSeed = z.infer<typeof scenarioSeedSchema>;

export const SCENARIO_SEEDS: readonly ScenarioSeed[] = [
  {
    key: "hospital-ransomware-surge",
    title: "Hospital ransomware during surge",
    summary: "Ransomware hits a regional hospital at surge capacity, forcing patient diversion decisions and HHS coordination.",
    hazard: "Ransomware",
    sectors: ["Healthcare"],
  },
  {
    key: "it-platform-supply-chain",
    title: "IT management platform compromise",
    summary: "A widely deployed IT management platform is compromised and affects many networks at once.",
    hazard: "Supply chain compromise",
    sectors: ["Government", "Information technology"],
  },
  {
    key: "dba-insider-exfil",
    title: "Database administrator sells records",
    summary: "A privileged database administrator at a financial firm exfiltrates customer records for sale.",
    hazard: "Insider threat",
    sectors: ["Financial services"],
  },
  {
    key: "water-scada-prepositioning",
    title: "State actor in water SCADA",
    summary: "A nation-state actor is found pre-positioned in water treatment control systems using built-in tools.",
    hazard: "Nation-state intrusion",
    sectors: ["Water and wastewater"],
  },
  {
    key: "election-ddos",
    title: "DDoS during early voting",
    summary: "Coordinated DDoS hits election infrastructure during early voting and needs CISA, FBI, and state coordination.",
    hazard: "Denial of service",
    sectors: ["Government", "Elections"],
  },
  {
    key: "k12-double-extortion",
    title: "School district double extortion",
    summary: "A ransomware affiliate encrypts and steals data from a K-12 district during standardized testing.",
    hazard: "Ransomware",
    sectors: ["Education"],
  },
  {
    key: "municipal-bec",
    title: "Municipal wire fraud in progress",
    summary: "Business email compromise targets a city finance office with a 2.3 million dollar wire in progress.",
    hazard: "Business email compromise",
    sectors: ["Government", "Financial services"],
  },
  {
    key: "vpn-zero-day",
    title: "VPN appliance zero-day",
    summary: "A zero-day in an enterprise VPN appliance is exploited across sectors and CISA issues an emergency directive.",
    hazard: "Zero-day exploitation",
    sectors: ["Cross-sector"],
  },
  {
    key: "saas-cicd-backdoor",
    title: "Backdoored SaaS updates",
    summary: "A compromised CI/CD pipeline injects backdoors into SaaS product updates shipped to customers.",
    hazard: "Supply chain compromise",
    sectors: ["Information technology"],
  },
  {
    key: "telecom-intercept-breach",
    title: "Telecom intercept systems breached",
    summary: "A telecom provider breach gives an attacker access to lawful intercept systems and government communications.",
    hazard: "Nation-state intrusion",
    sectors: ["Communications", "Government"],
  },
  {
    key: "dib-spearphish",
    title: "Defense contractor data theft",
    summary: "An APT steals weapons system technical data from a defense contractor through spear phishing.",
    hazard: "Nation-state intrusion",
    sectors: ["Defense industrial base"],
  },
  {
    key: "medical-iot-vendor",
    title: "Medical device vendor breach",
    summary: "A breach at a medical IoT vendor exposes hospital data and starts the HIPAA 60-day notification clock.",
    hazard: "Third-party breach",
    sectors: ["Healthcare"],
  },
  {
    key: "energy-contractor-ot",
    title: "OT attack through a contractor",
    summary: "A multi-stage attack on energy OT begins with social engineering of a maintenance contractor.",
    hazard: "Critical infrastructure attack",
    sectors: ["Energy"],
  },
  {
    key: "swift-wallet-heist",
    title: "Bank payment and wallet heist",
    summary: "Attackers target a bank's SWIFT integration and cryptocurrency hot wallets.",
    hazard: "Financial theft",
    sectors: ["Financial services"],
  },
  {
    key: "wiper-geopolitical",
    title: "Wiper during geopolitical crisis",
    summary: "Destructive wiper malware spreads across agencies during a geopolitical escalation and targets backups first.",
    hazard: "Destructive malware",
    sectors: ["Government"],
  },
  {
    key: "collab-platform-phish",
    title: "Phishing inside the chat platform",
    summary: "Attackers use a trusted collaboration platform to spread credential-stealing malware internally.",
    hazard: "Phishing",
    sectors: ["Cross-sector"],
  },
  {
    key: "msp-pivot",
    title: "Managed service provider pivot",
    summary: "A compromised managed service provider is used to attack dozens of its client organizations.",
    hazard: "Supply chain compromise",
    sectors: ["Information technology", "Cross-sector"],
  },
  {
    key: "extortion-no-encryption",
    title: "Data extortion without encryption",
    summary: "An actor steals 2 TB of sensitive data and threatens release. No ransomware is deployed.",
    hazard: "Data extortion",
    sectors: ["Cross-sector"],
  },
  {
    key: "open-source-library-flaw",
    title: "Critical open source library flaw",
    summary: "A flaw in a widely used open source library requires emergency patching across hundreds of applications.",
    hazard: "Vulnerability response",
    sectors: ["Cross-sector"],
  },
  {
    key: "physical-cyber-convergence",
    title: "Badge system and network intrusion",
    summary: "An attacker compromises building access control and the network at a critical facility at the same time.",
    hazard: "Physical and cyber",
    sectors: ["Critical infrastructure"],
  },
];

// ---------------------------------------------------------------------------
// Common scenarios
// ---------------------------------------------------------------------------

export const commonScenarioSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  actorKeys: z.array(z.string()).min(1),
  domains: z.array(z.enum(SCENARIO_DOMAIN_KEYS)).min(1),
  keyPressures: z.array(z.string()).min(1),
  techniques: z.array(z.string().regex(/^T\d{4}(?:\.\d{3})?$/)),
});

export type CommonScenario = z.infer<typeof commonScenarioSchema>;

export const COMMON_SCENARIOS: readonly CommonScenario[] = [
  {
    key: "ransomware-critical-services",
    title: "Ransomware with critical service disruption",
    summary: "Core business and customer services are disrupted by a multi-stage ransomware campaign with extortion.",
    actorKeys: ["ransomware-cartel", "lockbit", "qilin"],
    domains: ["cyber", "financial", "operational"],
    keyPressures: [
      "Service restoration versus preserving forensic evidence",
      "Executive decision on ransom and extortion posture",
      "Timing of regulatory notice and customer communication",
    ],
    techniques: ["T1078", "T1021", "T1486", "T1490"],
  },
  {
    key: "bec-financial-fraud",
    title: "Business email compromise and payment fraud",
    summary: "A targeted BEC operation pushes fraudulent payments using hijacked executive mailboxes.",
    actorKeys: ["fin7", "scattered-spider"],
    domains: ["cyber", "financial", "legal"],
    keyPressures: [
      "Immediate wire and payment freeze decisions",
      "Order of legal, bank, and insurer notifications",
      "Executive trust and internal communication under uncertainty",
    ],
    techniques: ["T1566.001", "T1114.002", "T1528", "T1657"],
  },
  {
    key: "cloud-identity-takeover",
    title: "Cloud identity takeover",
    summary: "Attackers take over identity infrastructure and use valid tokens to move across cloud workloads.",
    actorKeys: ["scattered-spider", "apt29", "storm-0501"],
    domains: ["cyber", "operational"],
    keyPressures: [
      "Tenant-wide containment versus business continuity",
      "Credential and token revocation at scale",
      "Recovering privileged access without locking out responders",
    ],
    techniques: ["T1078.004", "T1550.001", "T1539", "T1621", "T1556.006", "T1484.002", "T1098.001"],
  },
  {
    key: "supply-chain-compromise",
    title: "Software supply chain compromise",
    summary: "A trusted third-party software or service channel is compromised and creates broad downstream risk.",
    actorKeys: ["apt29", "apt41", "clop"],
    domains: ["cyber", "legal", "operational"],
    keyPressures: [
      "Reassessing trust in vendors",
      "Emergency patching and compensating controls",
      "Partner and customer notice with incomplete indicators",
    ],
    techniques: ["T1195.002", "T1199", "T1078", "T1041"],
  },
  {
    key: "insider-data-exfiltration",
    title: "Insider data exfiltration",
    summary: "A privileged insider is suspected of staging and exfiltrating sensitive data over approved channels.",
    actorKeys: ["insider-threat"],
    domains: ["cyber", "people", "legal"],
    keyPressures: [
      "HR and legal coordination for an insider investigation",
      "Evidence preservation within employee privacy limits",
      "Business continuity while privileged access is curtailed",
    ],
    techniques: ["T1005", "T1083", "T1567", "T1213"],
  },
];
