import { z } from "zod";

// Threat actor library. Merged keys resolve through LEGACY_ACTOR_KEYS
// ("oilrig" to "apt34", "carbanak" to "fin7"). Technique IDs are ATT&CK Enterprise
// IDs, validated against the catalog in ./mitre by content.test.ts.
//
// Status follows public reporting as of statusAsOf. Pickers hide defunct and
// rebranded actors unless the author asks for them. Replays may still name them.

export const THREAT_ACTOR_TYPES = [
  "nation_state",
  "criminal",
  "hacktivist",
  "insider",
  "other",
] as const;

export const ACTOR_STATUSES = ["active", "disrupted", "defunct", "rebranded"] as const;
export type ActorStatus = (typeof ACTOR_STATUSES)[number];

export const ACTOR_STATUS_LABELS: Record<ActorStatus, string> = {
  active: "Active",
  disrupted: "Disrupted",
  defunct: "Defunct",
  rebranded: "Rebranded",
};

/** Date the library statuses were last reviewed. Actors without their own date use it. */
const STATUS_REVIEWED = "2026-10-26";

export const threatActorSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  aliases: z.array(z.string()),
  type: z.enum(THREAT_ACTOR_TYPES),
  origin: z.string().optional(),
  motivation: z.string().min(1),
  summary: z.string().min(1),
  techniques: z.array(z.string().regex(/^T\d{4}(?:\.\d{3})?$/)).min(5),
  targetIndustries: z.array(z.string()),
  typicalImpact: z.array(z.string()),
  notableIncidents: z.array(z.string()),
  status: z.enum(ACTOR_STATUSES),
  statusAsOf: z.string().regex(/^\d{4}-\d{2}(?:-\d{2})?$/),
  /** One plain line on what happened to the group. */
  statusNote: z.string().optional(),
});

export type ThreatActor = z.infer<typeof threatActorSchema>;

type ActorEntry = Omit<ThreatActor, "status" | "statusAsOf"> & Partial<Pick<ThreatActor, "status" | "statusAsOf">>;

const ENTRIES: readonly ActorEntry[] = [
  // Nation-state
  {
    key: "apt28",
    name: "APT28 (Fancy Bear)",
    aliases: ["Fancy Bear", "Sofacy", "Forest Blizzard", "STRONTIUM"],
    type: "nation_state",
    origin: "Russia, GRU Unit 26165",
    motivation: "Espionage and influence operations",
    summary:
      "Russian military intelligence unit known for credential phishing, zero-day use, and hack-and-leak operations against governments and media.",
    techniques: ["T1566.002", "T1203", "T1059.001", "T1078", "T1003.001", "T1071.001", "T1027", "T1560.001", "T1041", "T1583.001"],
    targetIndustries: ["Government", "Defense", "Political organizations", "Media", "Sports bodies"],
    typicalImpact: ["Credential theft", "Data theft", "Leaks timed for political effect"],
    notableIncidents: [
      "2015 German Bundestag network intrusion",
      "2016 Democratic National Committee intrusion and leaks",
      "2016 World Anti-Doping Agency data leak",
    ],
  },
  {
    key: "apt29",
    name: "APT29 (Cozy Bear)",
    aliases: ["Cozy Bear", "Nobelium", "Midnight Blizzard", "UNC2452", "The Dukes"],
    type: "nation_state",
    origin: "Russia, SVR",
    motivation: "Long-term espionage",
    summary:
      "Russian foreign intelligence group that favors stealth, long dwell time, supply chain access, and abuse of cloud identity and tokens.",
    techniques: ["T1195.002", "T1078.004", "T1550.001", "T1059.001", "T1071.001", "T1027", "T1048.003", "T1114.002", "T1606.002", "T1098"],
    targetIndustries: ["Government", "Diplomatic", "Technology", "Think tanks", "Healthcare research"],
    typicalImpact: ["Persistent covert access", "Email and document theft", "Identity platform compromise"],
    notableIncidents: [
      "2020 SolarWinds Orion supply chain campaign",
      "2020 targeting of COVID-19 vaccine research",
      "2024 intrusion into a major software vendor's corporate email",
    ],
  },
  {
    key: "apt33",
    name: "APT33 (Elfin)",
    aliases: ["Elfin", "Refined Kitten", "Peach Sandstorm"],
    type: "nation_state",
    origin: "Iran, IRGC-affiliated",
    motivation: "Espionage with destructive capability",
    summary:
      "Iranian group targeting aerospace, energy, and petrochemical firms with password spraying and phishing, with links to destructive wipers.",
    techniques: ["T1566.002", "T1078", "T1110.003", "T1059.001", "T1547.001", "T1003.001", "T1485", "T1071.001", "T1583.001"],
    targetIndustries: ["Aerospace", "Energy", "Petrochemical", "Defense"],
    typicalImpact: ["Credential theft", "Data theft", "Destructive wiping"],
    notableIncidents: [
      "2017 phishing campaigns against aviation and energy firms",
      "2023 large-scale password spraying against defense and satellite firms",
    ],
  },
  {
    key: "apt34",
    name: "APT34 (OilRig)",
    aliases: ["OilRig", "Helix Kitten", "Hazel Sandstorm"],
    type: "nation_state",
    origin: "Iran, MOIS-linked",
    motivation: "Espionage",
    summary:
      "Iranian group known for social engineering, web shells on exposed servers, and DNS-based command and control against regional targets.",
    techniques: ["T1566.001", "T1566.002", "T1505.003", "T1059.001", "T1071.004", "T1003.001", "T1078", "T1021.001"],
    targetIndustries: ["Government", "Energy", "Financial services", "Telecommunications"],
    typicalImpact: ["Credential theft", "Persistent access", "Data theft"],
    notableIncidents: [
      "2019 public leak of OilRig tooling and victim data",
      "Long-running campaigns against Middle East government and energy targets",
    ],
  },
  {
    key: "apt38",
    name: "APT38 (BlueNoroff)",
    aliases: ["BlueNoroff", "Stardust Chollima"],
    type: "nation_state",
    origin: "North Korea, RGB",
    motivation: "Financial theft for the state",
    summary:
      "North Korean unit focused on stealing money from banks, payment systems, and cryptocurrency firms, often destroying evidence afterward.",
    techniques: ["T1566.001", "T1059.001", "T1078", "T1036.005", "T1070.004", "T1485", "T1657", "T1027", "T1071.001", "T1005"],
    targetIndustries: ["Banking", "Payment systems", "Cryptocurrency"],
    typicalImpact: ["Fraudulent transfers", "Destroyed systems to cover tracks"],
    notableIncidents: ["2016 Bangladesh Bank SWIFT heist", "Repeated thefts from cryptocurrency exchanges"],
  },
  {
    key: "apt40",
    name: "APT40 (Leviathan)",
    aliases: ["Leviathan", "Kryptonite Panda", "Gingham Typhoon"],
    type: "nation_state",
    origin: "China, MSS Hainan",
    motivation: "Espionage",
    summary:
      "Chinese group that quickly exploits newly published flaws in internet-facing systems and plants web shells for access.",
    techniques: ["T1190", "T1505.003", "T1566.001", "T1566.002", "T1059.001", "T1003.001", "T1560.001", "T1078"],
    targetIndustries: ["Maritime", "Defense", "Government", "Research", "Healthcare"],
    typicalImpact: ["Data theft", "Persistent access"],
    notableIncidents: [
      "2021 US indictment of four MSS-linked operators",
      "2024 joint advisory led by the Australian Signals Directorate",
    ],
  },
  {
    key: "apt41",
    name: "APT41 (Double Dragon)",
    aliases: ["Double Dragon", "Barium", "Winnti", "Brass Typhoon"],
    type: "nation_state",
    origin: "China",
    motivation: "State espionage and personal financial gain",
    summary:
      "Chinese group that mixes state espionage with financially motivated crime and uses supply chain compromise and web application exploits.",
    techniques: ["T1195.002", "T1190", "T1059.001", "T1059.003", "T1547.001", "T1055.012", "T1027", "T1003.001", "T1046", "T1071.001"],
    targetIndustries: ["Healthcare", "Telecommunications", "Gaming", "Technology", "State government"],
    typicalImpact: ["Data theft", "Supply chain access", "Fraud"],
    notableIncidents: [
      "2020 US indictments of APT41 members",
      "2021 to 2022 intrusions into US state government networks",
    ],
  },
  {
    key: "apt10",
    name: "APT10 (Stone Panda)",
    aliases: ["Stone Panda", "menuPass", "Cloud Hopper"],
    type: "nation_state",
    origin: "China, MSS",
    motivation: "Espionage",
    summary:
      "Chinese group known for compromising managed service providers and pivoting through trusted access into their clients.",
    techniques: ["T1199", "T1078", "T1566.001", "T1574.001", "T1003.001", "T1021.001", "T1560.001", "T1105"],
    targetIndustries: ["Managed service providers", "Technology", "Government", "Manufacturing"],
    typicalImpact: ["Data theft across many downstream clients"],
    notableIncidents: ["Cloud Hopper campaign against managed service providers", "2018 US indictment of two APT10 members"],
  },
  {
    key: "apt1",
    name: "APT1 (Comment Crew)",
    aliases: ["Comment Crew", "Comment Panda"],
    type: "nation_state",
    origin: "China, PLA Unit 61398",
    motivation: "Economic espionage",
    summary:
      "One of the first publicly attributed Chinese groups, focused on stealing intellectual property from industry.",
    techniques: ["T1566.001", "T1059.001", "T1078", "T1003.001", "T1083", "T1005", "T1560.001", "T1041", "T1071.001"],
    targetIndustries: ["Defense", "Aerospace", "Telecommunications", "Manufacturing"],
    typicalImpact: ["Intellectual property theft"],
    notableIncidents: ["2013 public report exposing PLA Unit 61398", "2014 US indictment of five PLA officers"],
  },
  {
    key: "lazarus-group",
    name: "Lazarus Group",
    aliases: ["Hidden Cobra", "Diamond Sleet", "ZINC"],
    type: "nation_state",
    origin: "North Korea, RGB",
    motivation: "Revenue for the state, espionage, and disruption",
    summary:
      "North Korean group behind destructive attacks and large cryptocurrency thefts, using lures, custom malware, and fake job offers.",
    techniques: ["T1566.001", "T1204.002", "T1059.005", "T1027", "T1055.012", "T1486", "T1485", "T1071.001", "T1573.001", "T1657"],
    targetIndustries: ["Financial services", "Cryptocurrency", "Media", "Defense"],
    typicalImpact: ["Theft of funds", "Destructive attacks", "Data leaks"],
    notableIncidents: ["2014 Sony Pictures attack", "2017 WannaCry outbreak", "2022 Ronin bridge theft"],
  },
  {
    key: "kimsuky",
    name: "Kimsuky (Velvet Chollima)",
    aliases: ["Velvet Chollima", "Emerald Sleet", "Thallium"],
    type: "nation_state",
    origin: "North Korea, RGB",
    motivation: "Intelligence collection on foreign policy",
    summary:
      "North Korean group that targets think tanks, academics, and officials with credential phishing and impersonation.",
    techniques: ["T1566.001", "T1566.002", "T1059.005", "T1547.001", "T1056.001", "T1082", "T1005", "T1071.001", "T1041", "T1583.001"],
    targetIndustries: ["Think tanks", "Academia", "Government", "Media", "Nuclear energy"],
    typicalImpact: ["Credential theft", "Email theft"],
    notableIncidents: [
      "2014 Korea Hydro and Nuclear Power intrusion",
      "2024 joint advisory on spoofed email used to target policy experts",
    ],
  },
  {
    key: "sandworm",
    name: "Sandworm",
    aliases: ["Voodoo Bear", "Seashell Blizzard", "APT44"],
    type: "nation_state",
    origin: "Russia, GRU Unit 74455",
    motivation: "Disruption and sabotage",
    summary:
      "Russian military unit behind destructive wipers and attacks on power grids and other industrial systems.",
    techniques: ["T1195.002", "T1059.001", "T1053.005", "T1485", "T1486", "T1490", "T1562.001", "T1021.002", "T1047", "T1027"],
    targetIndustries: ["Energy", "Government", "Telecommunications", "Logistics"],
    typicalImpact: ["Power outages", "Destroyed systems", "Global collateral damage"],
    notableIncidents: [
      "2015 and 2016 attacks on the Ukrainian power grid",
      "2017 NotPetya outbreak",
      "2018 Olympic Destroyer attack",
    ],
  },
  {
    key: "turla",
    name: "Turla (Venomous Bear)",
    aliases: ["Venomous Bear", "Snake", "Uroburos", "Secret Blizzard"],
    type: "nation_state",
    origin: "Russia, FSB",
    motivation: "Espionage",
    summary:
      "Russian group with long-lived stealthy implants, known for hijacking other groups' infrastructure.",
    techniques: ["T1059.001", "T1059.005", "T1027", "T1071.001", "T1573.001", "T1055.012", "T1036.005", "T1082", "T1083", "T1041"],
    targetIndustries: ["Government", "Diplomatic", "Defense", "Research"],
    typicalImpact: ["Long-term covert data theft"],
    notableIncidents: [
      "2019 hijack of OilRig infrastructure",
      "2023 disruption of the Snake malware network by US law enforcement",
    ],
  },
  {
    key: "equation-group",
    name: "Equation Group",
    aliases: ["Equation"],
    type: "nation_state",
    motivation: "Espionage",
    summary:
      "Highly capable actor with advanced implants, including firmware persistence and encrypted hidden storage.",
    techniques: ["T1542.002", "T1564.005", "T1480.001", "T1120", "T1082", "T1027"],
    targetIndustries: ["Government", "Telecommunications", "Energy", "Research"],
    typicalImpact: ["Covert long-term access"],
    notableIncidents: ["2015 public disclosure of the Equation toolset", "2016 to 2017 Shadow Brokers tool leaks"],
  },
  {
    key: "volt-typhoon",
    name: "Volt Typhoon",
    aliases: ["Bronze Silhouette", "Vanguard Panda"],
    type: "nation_state",
    origin: "China",
    motivation: "Pre-positioning for disruption",
    summary:
      "Chinese group that hides in critical infrastructure networks using built-in tools and valid accounts, avoiding custom malware.",
    techniques: ["T1190", "T1078", "T1059.001", "T1059.003", "T1047", "T1036.005", "T1082", "T1087.002", "T1046", "T1021.001", "T1090"],
    targetIndustries: ["Energy", "Water", "Telecommunications", "Transportation"],
    typicalImpact: ["Hidden access that could enable disruption during a crisis"],
    notableIncidents: [
      "2023 joint advisory on intrusions into US critical infrastructure",
      "2024 disruption of the KV botnet of compromised routers",
    ],
  },
  {
    key: "salt-typhoon",
    name: "Salt Typhoon",
    aliases: ["GhostEmperor", "Earth Estries", "FamousSparrow"],
    type: "nation_state",
    origin: "China",
    motivation: "Espionage against communications",
    summary:
      "Chinese group that compromised telecom carriers to reach call records, lawful intercept systems, and communications of officials.",
    techniques: ["T1190", "T1078", "T1059.001", "T1055.012", "T1027", "T1003.001", "T1071.001", "T1114.002", "T1041"],
    targetIndustries: ["Telecommunications", "Government", "Internet service providers"],
    typicalImpact: ["Bulk metadata theft", "Access to intercept systems"],
    notableIncidents: ["2024 compromise of several US telecom carriers"],
  },
  {
    key: "mustang-panda",
    name: "Mustang Panda",
    aliases: ["RedDelta", "Bronze President", "Twill Typhoon"],
    type: "nation_state",
    origin: "China",
    motivation: "Regional espionage",
    summary:
      "Chinese group using themed lures, DLL side-loading, and USB-spreading malware against government and NGO targets.",
    techniques: ["T1566.001", "T1566.002", "T1204.002", "T1574.001", "T1091", "T1071.001", "T1560.001", "T1027"],
    targetIndustries: ["Government", "NGOs", "Religious organizations", "Telecommunications"],
    typicalImpact: ["Data theft", "Wide malware spread through removable media"],
    notableIncidents: ["2025 law enforcement operation to remove PlugX malware from thousands of computers"],
  },
  {
    key: "muddywater",
    name: "MuddyWater",
    aliases: ["Mercury", "Mango Sandstorm", "Static Kitten"],
    type: "nation_state",
    origin: "Iran, MOIS",
    motivation: "Espionage",
    summary:
      "Iranian group using macro-laden documents, legitimate remote admin tools, and custom backdoors against telecom and government targets.",
    techniques: ["T1566.001", "T1059.001", "T1059.005", "T1547.001", "T1027", "T1082", "T1083", "T1071.001", "T1041", "T1219"],
    targetIndustries: ["Telecommunications", "Government", "Oil and gas", "Defense"],
    typicalImpact: ["Data theft", "Persistent access"],
    notableIncidents: ["2022 joint advisory on MOIS-linked MuddyWater activity"],
  },
  {
    key: "charming-kitten",
    name: "Charming Kitten (APT35)",
    aliases: ["APT35", "Phosphorus", "Mint Sandstorm"],
    type: "nation_state",
    origin: "Iran, IRGC-linked",
    motivation: "Espionage and surveillance",
    summary:
      "Iranian group that builds fake personas to phish journalists, academics, and campaign staff for account access.",
    techniques: ["T1566.002", "T1598.003", "T1585.001", "T1078", "T1114.002", "T1539"],
    targetIndustries: ["Media", "Academia", "Government", "Political campaigns"],
    typicalImpact: ["Account takeover", "Email theft", "Surveillance of individuals"],
    notableIncidents: ["Credential phishing against US political campaign staff"],
  },
  {
    key: "handala",
    name: "Handala",
    aliases: ["Handala Hack Team"],
    type: "nation_state",
    origin: "Iran, linked by vendors to MOIS (Void Manticore)",
    motivation: "Destruction, leaks and influence",
    summary:
      "Iran-linked persona that takes over identity and device management, then wipes devices at scale and leaks stolen data. No ransom is asked.",
    techniques: ["T1078.002", "T1078.004", "T1136.003", "T1098.003", "T1072", "T1561", "T1485", "T1070", "T1567"],
    targetIndustries: ["Medical devices", "Manufacturing", "Israeli organizations"],
    typicalImpact: ["Mass device wipe", "Manufacturing and shipping disruption", "Data leaks"],
    notableIncidents: ["2026 Intune remote wipe of Stryker devices, claimed by Handala"],
    status: "active",
    statusAsOf: "2026-04-15",
    statusNote: "Claimed the March 2026 Stryker wipe. Stryker has not confirmed attribution.",
  },
  {
    key: "generic-apt",
    name: "Generic APT",
    aliases: ["Unknown advanced actor"],
    type: "other",
    motivation: "Unknown",
    summary: "General advanced actor profile for use when no specific actor is chosen.",
    techniques: ["T1566", "T1078", "T1059", "T1021", "T1071", "T1041"],
    targetIndustries: [],
    typicalImpact: ["Data theft", "Persistent access"],
    notableIncidents: [],
  },

  // Criminal
  {
    key: "fin7",
    name: "FIN7",
    aliases: ["Carbon Spider", "Sangria Tempest", "Carbanak", "Anunak"],
    type: "criminal",
    origin: "Eastern Europe",
    motivation: "Financial",
    summary:
      "Crime group known for point-of-sale theft, polished phishing, bank intrusions under the Carbanak name, and later work as a ransomware affiliate and seller of EDR killers.",
    techniques: ["T1566.001", "T1204.002", "T1059.001", "T1055.012", "T1036.005", "T1219", "T1056.001", "T1113", "T1021.001", "T1005", "T1071.001", "T1041", "T1573.001"],
    targetIndustries: ["Retail", "Hospitality", "Restaurants", "Financial services", "Banking"],
    typicalImpact: ["Payment card theft", "Fraudulent transfers", "Ransomware deployment"],
    notableIncidents: [
      "Point-of-sale breaches at US restaurant and retail chains",
      "Bank thefts disclosed in 2015 under the Carbanak name",
      "2018 arrests of FIN7 members",
      "2025 Anubis backdoor delivered through compromised SharePoint sites",
    ],
    status: "active",
    statusAsOf: "2025-04",
    statusNote: "Last confirmed activity in April 2025.",
  },
  {
    key: "wizard-spider",
    name: "Wizard Spider",
    aliases: ["TrickBot operators", "UNC1878"],
    type: "criminal",
    origin: "Russia-based",
    motivation: "Financial",
    summary:
      "Crime group behind TrickBot, Ryuk, and Conti that moved fast from initial access to domain-wide ransomware.",
    techniques: ["T1566.001", "T1059.001", "T1003.001", "T1558.003", "T1021.002", "T1047", "T1486", "T1490", "T1562.001"],
    targetIndustries: ["Healthcare", "Government", "Manufacturing", "Education"],
    typicalImpact: ["Encrypted systems", "Hospital disruption", "Extortion"],
    notableIncidents: ["2020 Ryuk attacks on US hospitals", "2025 Operation Endgame action against TrickBot infrastructure"],
    status: "disrupted",
    statusAsOf: "2025-05",
    statusNote: "Operation Endgame hit TrickBot infrastructure in May 2025. Members are active in successor groups.",
  },
  {
    key: "conti",
    name: "Conti",
    aliases: ["Conti operators"],
    type: "criminal",
    origin: "Russia-based",
    motivation: "Financial",
    summary:
      "Ransomware operation run like a company, with double extortion and a leak site. Part of the Wizard Spider lineage.",
    techniques: ["T1133", "T1078", "T1059.001", "T1003.001", "T1021.002", "T1486", "T1490", "T1567.002", "T1219", "T1003.003"],
    targetIndustries: ["Healthcare", "Government", "Manufacturing"],
    typicalImpact: ["Encrypted systems", "Data leaks", "Extended outages"],
    notableIncidents: [
      "2021 attack on Ireland's Health Service Executive",
      "2022 attacks on Costa Rica government agencies",
      "2022 leak of Conti internal chats",
    ],
    status: "defunct",
    statusAsOf: "2022-06-24",
    statusNote: "Shut down in June 2022 after its chats leaked. Members moved to Royal, BlackSuit, Black Basta and others.",
  },
  {
    key: "black-basta",
    name: "Black Basta",
    aliases: ["Black Basta operators"],
    type: "criminal",
    origin: "Russia-based RaaS",
    motivation: "Financial",
    summary:
      "Ransomware operation formed by former Conti members that used phishing and bought access, then stole data and encrypted Windows and ESXi hosts.",
    techniques: ["T1566", "T1190", "T1219", "T1003.001", "T1021.001", "T1562.001", "T1567.002", "T1486", "T1490"],
    targetIndustries: ["Healthcare", "Manufacturing", "Critical infrastructure", "Professional services"],
    typicalImpact: ["Encrypted systems and hypervisors", "Data leaks", "Clinical disruption"],
    notableIncidents: ["2024 joint CISA and FBI advisory AA24-131A", "2025 leak of internal chats"],
    status: "disrupted",
    statusAsOf: "2026-01",
    statusNote: "Effectively inactive since its chats leaked in February 2025. No shutdown was announced.",
  },
  {
    key: "evil-corp",
    name: "Evil Corp",
    aliases: ["Indrik Spider", "Manatee Tempest"],
    type: "criminal",
    origin: "Russia",
    motivation: "Financial",
    summary: "Sanctioned crime group behind the Dridex banking malware and several ransomware families.",
    techniques: ["T1566.001", "T1189", "T1204.002", "T1059.001", "T1105", "T1078", "T1486", "T1490"],
    targetIndustries: ["Financial services", "Manufacturing", "Technology"],
    typicalImpact: ["Banking fraud", "Encrypted systems", "Sanctions risk for victims who pay"],
    notableIncidents: ["2019 US Treasury sanctions", "2020 WastedLocker ransomware attacks"],
  },
  {
    key: "lockbit",
    name: "LockBit",
    aliases: ["LockBit Group", "LockBit 5.0"],
    type: "criminal",
    origin: "Russia-based RaaS",
    motivation: "Financial",
    summary: "Ransomware-as-a-service brand with many affiliates, fast encryption, and data leak extortion.",
    techniques: ["T1133", "T1190", "T1078", "T1021.001", "T1484.001", "T1562.001", "T1486", "T1490", "T1567.002", "T1219", "T1003.003"],
    targetIndustries: ["Manufacturing", "Healthcare", "Financial services", "Government", "Education"],
    typicalImpact: ["Encrypted systems", "Data leaks", "Extended outages"],
    notableIncidents: ["2024 Operation Cronos law enforcement takedown", "2025 launch of LockBit 5.0 for Windows, Linux and ESXi"],
    status: "disrupted",
    statusAsOf: "2026-03",
    statusNote: "Operation Cronos seized its infrastructure in February 2024. LockBit 5.0 launched in September 2025 and still posts victims.",
  },
  {
    key: "darkside",
    name: "DarkSide",
    aliases: ["DarkSide operators", "BlackMatter"],
    type: "criminal",
    origin: "Russia-based RaaS",
    motivation: "Financial",
    summary:
      "Ransomware-as-a-service operation behind the Colonial Pipeline attack, later rebranded as BlackMatter.",
    techniques: ["T1078", "T1133", "T1059.001", "T1486", "T1490", "T1562.001", "T1021.001", "T1053.005", "T1567", "T1219", "T1003.003"],
    targetIndustries: ["Energy", "Manufacturing", "Professional services"],
    typicalImpact: ["Encrypted systems", "Operational shutdowns", "Data leaks"],
    notableIncidents: ["2021 Colonial Pipeline attack"],
    status: "defunct",
    statusAsOf: "2021-05-14",
    statusNote: "Shut down in May 2021 after its servers and funds were seized.",
  },
  {
    key: "revil",
    name: "REvil",
    aliases: ["Sodinokibi", "Gold Southfield"],
    type: "criminal",
    origin: "Russia-based RaaS",
    motivation: "Financial",
    summary: "Affiliate ransomware operation known for supply chain attacks and very large ransom demands.",
    techniques: ["T1190", "T1195.002", "T1566.001", "T1059.001", "T1486", "T1490", "T1567", "T1219", "T1003.003"],
    targetIndustries: ["Managed service providers", "Food production", "Legal", "Manufacturing"],
    typicalImpact: ["Encrypted systems", "Downstream victims through providers", "Data leaks"],
    notableIncidents: ["2021 Kaseya VSA supply chain attack", "2021 JBS Foods attack"],
    status: "defunct",
    statusAsOf: "2024-05",
    statusNote: "Members were arrested in 2022. A US court sentenced an affiliate in May 2024.",
  },
  {
    key: "blackcat",
    name: "BlackCat (ALPHV)",
    aliases: ["ALPHV", "Noberus"],
    type: "criminal",
    origin: "Russia-based RaaS",
    motivation: "Financial",
    summary: "Ransomware-as-a-service operation with cross-platform payloads, partnered with social engineering crews.",
    techniques: ["T1078", "T1133", "T1021.002", "T1059.001", "T1562.001", "T1486", "T1490", "T1567.002", "T1219", "T1003.003"],
    targetIndustries: ["Healthcare", "Hospitality", "Financial services", "Manufacturing"],
    typicalImpact: ["Encrypted systems", "Data leaks", "National-scale service outages"],
    notableIncidents: [
      "2023 MGM Resorts attack with Scattered Spider",
      "2023 law enforcement disruption",
      "2024 Change Healthcare attack",
    ],
    status: "defunct",
    statusAsOf: "2024-03",
    statusNote: "Disrupted by the FBI in December 2023. Ran an exit scam in March 2024.",
  },
  {
    key: "clop",
    name: "Cl0p",
    aliases: ["Clop", "TA505", "Lace Tempest", "FIN11"],
    type: "criminal",
    origin: "Russia-based",
    motivation: "Financial",
    summary:
      "Extortion group known for mass exploitation of file transfer and business software and theft-only extortion without encryption.",
    techniques: ["T1190", "T1505.003", "T1078", "T1059.001", "T1005", "T1567", "T1486", "T1490", "T1027"],
    targetIndustries: ["Cross-sector", "Government", "Financial services", "Education", "Healthcare"],
    typicalImpact: ["Mass data theft", "Leak site extortion", "Large notification burden"],
    notableIncidents: [
      "2020 to 2021 Accellion FTA exploitation",
      "2023 GoAnywhere exploitation",
      "2023 MOVEit Transfer mass exploitation",
      "2025 Oracle E-Business Suite data theft and extortion",
    ],
    status: "active",
    statusAsOf: "2025-10-06",
    statusNote: "Ran an Oracle E-Business Suite extortion campaign in 2025.",
  },
  {
    key: "hive",
    name: "Hive",
    aliases: ["Hive operators"],
    type: "criminal",
    origin: "RaaS",
    motivation: "Financial",
    summary: "Ransomware-as-a-service operation that hit hospitals and schools until law enforcement took it down.",
    techniques: ["T1133", "T1190", "T1078", "T1021.001", "T1070.001", "T1562.001", "T1486", "T1490", "T1219", "T1003.003"],
    targetIndustries: ["Healthcare", "Education", "Government"],
    typicalImpact: ["Encrypted systems", "Clinical disruption"],
    notableIncidents: ["2021 Memorial Health System attack", "2023 law enforcement infiltration and takedown"],
    status: "defunct",
    statusAsOf: "2023-01-26",
    statusNote: "Taken down by the FBI and partners in January 2023.",
  },
  {
    key: "scattered-spider",
    name: "Scattered Spider",
    aliases: ["UNC3944", "Octo Tempest", "0ktapus", "Muddled Libra"],
    type: "criminal",
    origin: "US and UK",
    motivation: "Financial",
    summary:
      "English-speaking crew that calls help desks, swaps SIMs, and abuses identity platforms, then deploys ransomware or extorts.",
    techniques: ["T1566.004", "T1656", "T1078", "T1621", "T1528", "T1078.004", "T1199", "T1484.002", "T1098.005", "T1219", "T1486", "T1567", "T1213", "T1539", "T1556.006"],
    targetIndustries: ["Hospitality", "Gaming", "Retail", "Telecommunications", "Insurance", "Aviation", "Healthcare"],
    typicalImpact: ["Identity platform takeover", "Encrypted systems", "Data theft and extortion"],
    notableIncidents: [
      "2022 phishing campaign against SMS and identity providers",
      "2023 MGM Resorts and Caesars Entertainment attacks",
      "2025 attacks on UK retailers",
    ],
    status: "disrupted",
    statusAsOf: "2026-07-01",
    statusNote: "Several members were arrested and charged in 2025 and 2026. Other crews copy its playbook.",
  },
  {
    key: "lapsus",
    name: "LAPSUS$",
    aliases: ["DEV-0537", "Strawberry Tempest"],
    type: "criminal",
    origin: "Global",
    motivation: "Extortion and notoriety",
    summary:
      "Extortion group that relied on social engineering, MFA fatigue, SIM swaps, and bought insider access instead of malware.",
    techniques: ["T1078", "T1199", "T1621", "T1528", "T1539", "T1213", "T1567", "T1657"],
    targetIndustries: ["Technology", "Telecommunications", "Government"],
    typicalImpact: ["Source code theft", "Public leaks", "Embarrassment"],
    notableIncidents: ["2022 intrusions at several large technology companies", "2023 UK convictions of members"],
    status: "rebranded",
    statusAsOf: "2025-10",
    statusNote: "Disbanded as a standalone group. The name returned in 2025 inside Scattered LAPSUS$ Hunters.",
  },
  {
    key: "ransomhub",
    name: "RansomHub",
    aliases: ["Greenbottle"],
    type: "criminal",
    origin: "RaaS",
    motivation: "Financial",
    summary: "Ransomware-as-a-service operation that drew affiliates from other brands after 2024 takedowns.",
    techniques: ["T1190", "T1133", "T1078", "T1059.001", "T1021.001", "T1562.001", "T1486", "T1490", "T1567.002", "T1219", "T1003.003"],
    targetIndustries: ["Healthcare", "Transportation", "Manufacturing", "Government"],
    typicalImpact: ["Encrypted systems", "Data leaks"],
    notableIncidents: ["2024 joint advisory on RansomHub activity"],
    status: "defunct",
    statusAsOf: "2025-04-01",
    statusNote: "Its leak site went dark around 1 April 2025. Many affiliates moved to Qilin.",
  },
  {
    key: "akira",
    name: "Akira",
    aliases: ["Akira operators"],
    type: "criminal",
    origin: "RaaS",
    motivation: "Financial",
    summary:
      "Ransomware-as-a-service operation active since 2023 that often enters through VPN accounts without multifactor authentication, then encrypts Windows servers and ESXi hosts and leaks stolen data.",
    techniques: ["T1133", "T1078", "T1190", "T1110.003", "T1136.002", "T1003.001", "T1003.003", "T1219", "T1021.001", "T1562.001", "T1048", "T1486", "T1490"],
    targetIndustries: ["Manufacturing", "Education", "Professional services", "Healthcare", "Critical infrastructure"],
    typicalImpact: ["Encrypted systems and hypervisors", "Data leaks", "Extended outages"],
    notableIncidents: ["2024 joint CISA and FBI advisory AA24-109A", "2024 exploitation of SonicWall SSL VPN access"],
    status: "active",
    statusAsOf: "2025-11-13",
    statusNote: "CISA and FBI updated their advisory in November 2025. Still posting victims in 2026.",
  },
  {
    key: "qilin",
    name: "Qilin",
    aliases: ["Agenda"],
    type: "criminal",
    origin: "RaaS",
    motivation: "Financial",
    summary:
      "Ransomware-as-a-service operation that enters through VPNs without MFA, steals credentials, pushes its tools through group policy, encrypts Windows and ESXi, and pressures victims with leaks.",
    techniques: ["T1133", "T1078", "T1566", "T1484.001", "T1555.003", "T1074", "T1070.001", "T1003.003", "T1219", "T1562.001", "T1486", "T1490", "T1567.002"],
    targetIndustries: ["Healthcare", "Manufacturing", "Business services", "Education", "Professional services"],
    typicalImpact: ["Encrypted systems and hypervisors", "Clinical disruption", "Data leaks"],
    notableIncidents: ["2024 attack on a pathology services provider to London hospitals"],
    status: "active",
    statusAsOf: "2026-06",
    statusNote: "Among the most active ransomware brands through mid 2026.",
  },
  {
    key: "shinyhunters",
    name: "ShinyHunters (UNC6040)",
    aliases: ["UNC6040", "UNC6240", "ShinyHunters", "Scattered LAPSUS$ Hunters"],
    type: "criminal",
    origin: "Global",
    motivation: "Data theft, extortion and data sales",
    summary:
      "Data theft and extortion crew that calls employees as IT support, gets them to authorize a malicious connected app for a SaaS tenant, copies customer data, then extorts the company or sells the data.",
    techniques: ["T1566.004", "T1656", "T1528", "T1550.001", "T1078.004", "T1213", "T1530", "T1552", "T1567", "T1657"],
    targetIndustries: ["Retail", "Technology", "Hospitality", "Insurance", "Financial services"],
    typicalImpact: ["SaaS data theft", "Extortion", "Data sold on criminal forums"],
    notableIncidents: [
      "2025 voice phishing campaign against Salesforce customer tenants reported by Google Threat Intelligence",
      "2025 leak site naming 39 companies",
    ],
    status: "active",
    statusAsOf: "2026-10-03",
    statusNote: "Alleged leaders were arrested or detained in September 2026. A new leak site appeared in October 2026.",
  },
  {
    key: "storm-0501",
    name: "Storm-0501",
    aliases: ["Storm-0501", "Sabbath"],
    type: "criminal",
    origin: "Financially motivated",
    motivation: "Financial",
    summary:
      "Crew that moves from on-premises Active Directory to Entra ID through the sync server, takes Global Administrator, then steals and deletes cloud data and backups for extortion.",
    techniques: ["T1190", "T1078.002", "T1518.001", "T1003.006", "T1556.007", "T1087.004", "T1078.004", "T1556.006", "T1484.002", "T1098.003", "T1537", "T1485", "T1490", "T1486"],
    targetIndustries: ["Government", "Manufacturing", "Transportation", "Law enforcement", "Healthcare", "Education"],
    typicalImpact: ["Identity platform takeover", "Cloud data deletion", "Encrypted systems", "Extortion"],
    notableIncidents: ["2024 hybrid cloud ransomware campaign reported by Microsoft", "2025 cloud-based extortion in Azure reported by Microsoft"],
    status: "active",
    statusAsOf: "2025-08-27",
    statusNote: "Last public Microsoft report in August 2025. No arrests reported.",
  },
  {
    key: "ransomware-cartel",
    name: "Ransomware cartel (affiliate model)",
    aliases: ["RaaS affiliate"],
    type: "criminal",
    origin: "Multinational",
    motivation: "Financial",
    summary:
      "Generic ransomware-as-a-service affiliate using bought access, built-in tools, and double extortion.",
    techniques: ["T1486", "T1490", "T1078", "T1021.001", "T1047", "T1059.001", "T1562.001", "T1053.005", "T1219", "T1003.003"],
    targetIndustries: ["Cross-sector"],
    typicalImpact: ["Encrypted systems", "Data leaks", "Extended outages"],
    notableIncidents: [],
  },

  // Hacktivist
  {
    key: "hacktivist-collective",
    name: "Hacktivist collective",
    aliases: ["Cause-driven DDoS group"],
    type: "hacktivist",
    motivation: "Political or social cause",
    summary: "Cause-driven group seeking attention through denial of service, defacement, and leaks.",
    techniques: ["T1498", "T1499", "T1491.002", "T1190", "T1078", "T1567"],
    targetIndustries: ["Government", "Financial services", "Transportation", "Media"],
    typicalImpact: ["Website outages", "Defacement", "Leaked data"],
    notableIncidents: ["2022 to 2024 pro-Russia DDoS campaigns against European and US sites"],
  },

  // Insider
  {
    key: "insider-threat",
    name: "Malicious insider",
    aliases: ["Disgruntled employee", "Compromised employee"],
    type: "insider",
    origin: "Internal",
    motivation: "Grievance, money, or coercion",
    summary:
      "Trusted employee with legitimate access who steals data, sabotages systems, or sells access.",
    techniques: ["T1078", "T1083", "T1005", "T1530", "T1048", "T1552.001", "T1485", "T1565.001"],
    targetIndustries: ["Cross-sector"],
    typicalImpact: ["Data theft", "Sabotage", "Fraud"],
    notableIncidents: [],
  },
];

export const THREAT_ACTORS: readonly ThreatActor[] = ENTRIES.map((a) => ({
  ...a,
  status: a.status ?? "active",
  statusAsOf: a.statusAsOf ?? STATUS_REVIEWED,
}));

/** Keys that were merged into another actor. */
export const LEGACY_ACTOR_KEYS: Readonly<Record<string, string>> = {
  oilrig: "apt34",
  unc2452: "apt29",
  carbanak: "fin7",
};

const BY_KEY: ReadonlyMap<string, ThreatActor> = new Map(THREAT_ACTORS.map((a) => [a.key, a]));

export function getThreatActor(key: string): ThreatActor | undefined {
  const k = key.trim().toLowerCase();
  return BY_KEY.get(k) ?? BY_KEY.get(LEGACY_ACTOR_KEYS[k] ?? "");
}

/** Resolves a key, display name, or alias to an actor (case-insensitive). */
export function findThreatActor(value: string): ThreatActor | undefined {
  const direct = getThreatActor(value);
  if (direct) return direct;
  const v = value.trim().toLowerCase();
  return THREAT_ACTORS.find(
    (a) => a.name.toLowerCase() === v || a.aliases.some((alias) => alias.toLowerCase() === v),
  );
}

/** Active and disrupted actors still make sense for a new scenario. */
export function isCurrentActor(a: Pick<ThreatActor, "status">): boolean {
  return a.status === "active" || a.status === "disrupted";
}

/**
 * Actors for pickers, by name. Defunct and rebranded actors are left out
 * unless includeDefunct is set. keepKey keeps one actor (the current pick)
 * in the list whatever its status.
 */
export function listThreatActors(opts: { includeDefunct?: boolean; keepKey?: string | null } = {}): ThreatActor[] {
  const keep = opts.keepKey ? getThreatActor(opts.keepKey)?.key : undefined;
  return THREAT_ACTORS.filter((a) => opts.includeDefunct || isCurrentActor(a) || a.key === keep).sort((a, b) => a.name.localeCompare(b.name));
}

/** "Active", or "Defunct as of 2022-06-24". */
export function actorStatusLabel(a: Pick<ThreatActor, "status" | "statusAsOf">): string {
  const label = ACTOR_STATUS_LABELS[a.status];
  if (a.status === "active") return label;
  return `${label} as of ${a.statusAsOf}`;
}
