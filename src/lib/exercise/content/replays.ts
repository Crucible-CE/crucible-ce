import { z } from "zod";

// Crisis replay library. Public, well-documented incidents used as the
// narrative backbone for Crisis Sim and Strategic TTX. The exercise adapts
// the case to the playing organization; it does not role-play the victim.
// Facts follow the public record, with source links.
//
// Timeline offsets are hours from T0, the first event in the list. Where
// the exact day is not public, the offset is approximate and the event says so.

export const replaySourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  /** Publication date, YYYY, YYYY-MM or YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}(?:-\d{2}){0,2}$/).optional(),
});

export const replaySchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1),
  victimProfile: z.string().min(1),
  industry: z.string().min(1),
  actorKey: z.string().optional(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provisional: z.boolean(),
  sources: z.array(replaySourceSchema).min(1),
  summary: z.string().min(1),
  initialAccess: z.string().min(1),
  techniques: z.array(z.string().regex(/^T\d{4}(?:\.\d{3})?$/)).min(1),
  timeline: z
    .array(
      z.object({
        offsetHours: z.number().int().nonnegative(),
        date: z.string().optional(),
        event: z.string().min(1),
      }),
    )
    .min(1),
  impact: z.string().min(1),
  keyDecisions: z.array(z.string()).min(1),
  regulatoryFallout: z.array(z.string()),
  lessonsLearned: z.array(z.string()).min(1),
});

export type Replay = z.infer<typeof replaySchema>;

const AS_OF = "2026-10-01";

export const REPLAYS: readonly Replay[] = [
  {
    key: "mgm-2023",
    title: "MGM Resorts help desk to ransomware (2023)",
    victimProfile:
      "Large US casino and hotel operator running 24/7 gaming, hotel, and reservation systems (MGM Resorts International).",
    industry: "Hospitality and gaming",
    actorKey: "scattered-spider",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "CISA and FBI advisory AA23-320A: Scattered Spider",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a",
      },
      {
        title: "CISA and FBI advisory AA23-353A: ALPHV Blackcat",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-353a",
      },
    ],
    summary:
      "A social engineering crew talked the IT help desk into resetting an employee's credentials, took over the identity platform, and an ALPHV affiliate encrypted hypervisors. Hotel and casino systems were degraded for about ten days.",
    initialAccess:
      "Voice call to the IT help desk impersonating an employee whose details were found online, leading to a credential and MFA reset.",
    techniques: ["T1566.004", "T1078", "T1556", "T1484.002", "T1021", "T1486", "T1567"],
    timeline: [
      { offsetHours: 0, event: "Approximate. Attacker calls the help desk posing as an employee and gets the account reset." },
      { offsetHours: 24, date: "2023-09-11", event: "MGM shuts down systems and discloses a cybersecurity issue. Room keys, slot machines, and reservations are affected." },
      { offsetHours: 96, date: "2023-09-14", event: "ALPHV publicly claims the attack and says it encrypted hypervisors after MGM cut access." },
      { offsetHours: 240, date: "2023-09-20", event: "MGM says its properties are operating normally." },
      { offsetHours: 600, date: "2023-10-05", event: "MGM files a Form 8-K estimating about 100 million dollars in impact and confirming customer data was taken. It did not pay a ransom." },
    ],
    impact:
      "About ten days of degraded operations across properties, an estimated 100 million dollar hit to quarterly results, and theft of customer personal data.",
    keyDecisions: [
      "What identity checks must the help desk complete before resetting MFA for any user?",
      "Once the identity platform is suspected, do you disable single sign-on across all connected systems?",
      "What is the manual fallback for check-in, room keys, and payments for thousands of guests?",
      "Do you pay the ransom when a 24/7 operation is degraded?",
      "How do you reach 60,000 or more employees when internal systems are down?",
      "When do you notify gaming regulators, the SEC, and data protection authorities?",
    ],
    regulatoryFallout: [
      "Form 8-K disclosures to the SEC",
      "Nevada Gaming Control Board notification",
      "FTC inquiry",
      "Consumer class actions, later settled together with an earlier data breach",
    ],
    lessonsLearned: [
      "Help desk resets are an attack path. Use phishing-resistant MFA and call-back verification.",
      "The identity provider is a crown jewel. Its compromise reaches every connected system.",
      "Round-the-clock operations raise ransom pressure, so the decision needs a pre-agreed framework.",
      "Manual continuity plans need rehearsal for a full IT outage.",
    ],
  },
  {
    key: "change-healthcare-2024",
    title: "Change Healthcare claims outage (2024)",
    victimProfile:
      "National healthcare claims and pharmacy clearinghouse owned by a large insurer (Change Healthcare, part of UnitedHealth Group).",
    industry: "Healthcare",
    actorKey: "blackcat",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "HHS OCR: Change Healthcare cybersecurity incident FAQ",
        url: "https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html",
      },
      {
        title: "CISA and FBI advisory AA23-353A: ALPHV Blackcat (updated February 2024)",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-353a",
      },
    ],
    summary:
      "An ALPHV affiliate used stolen credentials on a remote access portal without MFA, stole data, then deployed ransomware. Claims, eligibility, and pharmacy processing stopped across the US for weeks.",
    initialAccess: "Stolen credentials used on a Citrix remote access portal that did not require multi-factor authentication.",
    techniques: ["T1078", "T1133", "T1021", "T1486", "T1048", "T1489"],
    timeline: [
      { offsetHours: 0, date: "2024-02-12", event: "Attackers log in to a remote access portal without MFA using stolen credentials." },
      { offsetHours: 216, date: "2024-02-21", event: "Ransomware is deployed. Change Healthcare disconnects its systems." },
      { offsetHours: 240, date: "2024-02-22", event: "UnitedHealth Group discloses the incident in a Form 8-K." },
      { offsetHours: 432, date: "2024-03-01", event: "Approximate. A ransom of about 22 million dollars is paid, later confirmed by the company." },
      { offsetHours: 720, date: "2024-03-13", event: "HHS Office for Civil Rights opens an investigation." },
      { offsetHours: 1680, date: "2024-04-22", event: "The company says data covering a substantial share of people in America may have been taken." },
      { offsetHours: 1896, date: "2024-05-01", event: "The parent company CEO testifies before Congress." },
      { offsetHours: 8328, date: "2025-01-24", event: "The affected count on the HHS breach portal is updated to about 190 million people." },
      { offsetHours: 12840, date: "2025-07-31", event: "Change Healthcare updates the count reported to HHS to about 192.7 million people." },
    ],
    impact:
      "Weeks of disrupted claims, prior authorizations, and pharmacy processing nationwide. Providers faced severe cash flow gaps. About 193 million people were affected by the data theft.",
    keyDecisions: [
      "How do you find every remote access path without MFA across acquired companies?",
      "Who decides to disconnect a platform the national healthcare system depends on?",
      "Do you pay when data is already stolen and payment does not guarantee deletion?",
      "How do you keep providers and pharmacies paid while systems are down?",
      "When and how do you notify more than 100 million people?",
      "What do you tell regulators and Congress while the investigation is open?",
    ],
    regulatoryFallout: [
      "HHS OCR investigation and HIPAA breach notification",
      "Congressional hearings",
      "CMS emergency guidance and accelerated payments to affected providers",
      "State attorney general litigation",
      "SEC Form 8-K disclosure",
    ],
    lessonsLearned: [
      "Every remote access path needs MFA. One gap can stop national infrastructure.",
      "Security reviews of acquired companies must happen at closing, not years later.",
      "Concentration in one clearinghouse is systemic risk. Customers need a backup path.",
      "Paying the ransom did not prevent further extortion over the stolen data.",
    ],
  },
  {
    key: "solarwinds-2020",
    title: "SolarWinds Orion supply chain compromise (2020)",
    victimProfile:
      "IT management software vendor whose signed updates reached about 18,000 customers, including federal agencies (SolarWinds).",
    industry: "Technology and government",
    actorKey: "apt29",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "CISA Emergency Directive 21-01",
        url: "https://www.cisa.gov/news-events/directives/ed-21-01-mitigate-solarwinds-orion-code-compromise",
      },
      {
        title: "CISA advisory AA20-352A: APT compromise of government agencies, critical infrastructure, and private sector",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa20-352a",
      },
    ],
    summary:
      "Russian foreign intelligence planted a backdoor in the Orion build process. Signed updates carried it to about 18,000 customers, and roughly 100 were selected for follow-on espionage.",
    initialAccess: "Compromise of the vendor's build environment, with malicious code inserted into legitimate signed Orion updates.",
    techniques: ["T1195.002", "T1071.001", "T1606.002", "T1550.001", "T1018", "T1005", "T1098"],
    timeline: [
      { offsetHours: 0, date: "2019-09", event: "Approximate. Attackers gain access to the vendor's environment." },
      { offsetHours: 4128, date: "2020-02-20", event: "Backdoor code is inserted into Orion builds." },
      { offsetHours: 4968, date: "2020-03", event: "Approximate. Signed, trojanized updates begin reaching customers." },
      { offsetHours: 11136, date: "2020-12-08", event: "A security firm discloses theft of its red team tools, which leads to the discovery." },
      { offsetHours: 11256, date: "2020-12-13", event: "The vendor discloses the backdoor. CISA issues Emergency Directive 21-01." },
      { offsetHours: 14208, date: "2021-04-15", event: "The US formally attributes the campaign to Russia's SVR and announces sanctions." },
      { offsetHours: 14856, date: "2021-05-12", event: "Executive Order 14028 on improving the nation's cybersecurity is signed." },
    ],
    impact:
      "About 18,000 organizations installed the backdoored update. Follow-on intrusions hit several federal agencies and technology companies. Response costs ran for years.",
    keyDecisions: [
      "A signed update from a trusted vendor is backdoored. Do you disconnect every instance now?",
      "How do you tell dormant installs from ones the attacker actually used?",
      "Government customers want answers today. How do you balance investigation and disclosure?",
      "Forged SAML tokens were used. Does the identity infrastructure need a rebuild?",
      "How do you tell customers about a supply chain compromise without causing panic?",
      "What changes to the build pipeline prevent this from happening again?",
    ],
    regulatoryFallout: [
      "CISA Emergency Directive 21-01",
      "Congressional hearings",
      "Executive Order 14028",
      "SEC enforcement action against the vendor and its CISO, filed in 2023, with most claims dismissed in 2024",
    ],
    lessonsLearned: [
      "Supply chain attacks bypass perimeter and endpoint controls.",
      "Build pipeline integrity needs its own controls, such as isolated builds and signing checks.",
      "Forged federation tokens mean identity provider compromise reaches everything.",
      "Trusted vendor software still needs least privilege and monitoring.",
    ],
  },
  {
    key: "colonial-pipeline-2021",
    title: "Colonial Pipeline ransomware shutdown (2021)",
    victimProfile:
      "Operator of a 5,500 mile fuel pipeline carrying about 45 percent of East Coast fuel (Colonial Pipeline Company).",
    industry: "Energy",
    actorKey: "darkside",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "CISA and FBI advisory AA21-131A: DarkSide ransomware",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa21-131a",
      },
      {
        title: "US Department of Justice: seizure of 2.3 million dollars in cryptocurrency paid to DarkSide",
        url: "https://www.justice.gov/opa/pr/department-justice-seizes-23-million-cryptocurrency-paid-ransomware-extortionists-darkside",
      },
    ],
    summary:
      "A DarkSide affiliate used a leaked password for a legacy VPN account without MFA. Ransomware hit IT systems, and the company halted the pipeline as a precaution for six days.",
    initialAccess: "Password for an unused legacy VPN account that did not require MFA.",
    techniques: ["T1078", "T1133", "T1486", "T1048", "T1490"],
    timeline: [
      { offsetHours: 0, date: "2021-04-29", event: "Attackers log in through a legacy VPN account." },
      { offsetHours: 192, date: "2021-05-07", event: "A ransom note is found on IT systems. The company halts pipeline operations and pays about 75 bitcoin." },
      { offsetHours: 264, date: "2021-05-10", event: "The FBI attributes the attack to DarkSide." },
      { offsetHours: 312, date: "2021-05-12", event: "The pipeline begins restarting." },
      { offsetHours: 672, date: "2021-05-27", event: "TSA issues its first security directive for pipeline operators." },
      { offsetHours: 936, date: "2021-06-07", event: "DOJ announces recovery of about 2.3 million dollars of the ransom." },
    ],
    impact:
      "Six days without pipeline service, fuel shortages and panic buying across the Southeast, and a ransom of about 4.4 million dollars, of which about half was recovered.",
    keyDecisions: [
      "Ransomware is on IT systems only. Do you shut down operational technology as a precaution?",
      "Who has authority to stop a pipeline that supplies half the East Coast, and how fast?",
      "Do you pay when national fuel supply is at stake?",
      "How do you coordinate CISA, the FBI, DOE, and the White House at once?",
      "When do you tell the public that supply is disrupted?",
      "How do you find other dormant accounts without MFA?",
    ],
    regulatoryFallout: [
      "TSA security directives for pipeline operators in May and July 2021",
      "Congressional hearings",
      "PHMSA proposed civil penalty related to control room management",
    ],
    lessonsLearned: [
      "Segment IT and OT so an IT compromise does not force an OT shutdown.",
      "Dormant accounts and missing MFA remain top entry points.",
      "Critical infrastructure needs rehearsed shutdown and restart procedures.",
      "Government coordination should be practiced before an incident.",
    ],
  },
  {
    key: "moveit-2023",
    title: "MOVEit Transfer mass exploitation (2023)",
    victimProfile:
      "Thousands of organizations running a managed file transfer product, from governments to pension funds (customers of Progress Software MOVEit Transfer).",
    industry: "Cross-sector",
    actorKey: "clop",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "CISA and FBI advisory AA23-158A: CL0P exploits MOVEit vulnerability",
        url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-158a",
      },
      {
        title: "NVD: CVE-2023-34362",
        url: "https://nvd.nist.gov/vuln/detail/CVE-2023-34362",
      },
    ],
    summary:
      "Cl0p exploited a zero-day SQL injection in MOVEit Transfer over a US holiday weekend, planted a web shell, and stole data from thousands of organizations without encrypting anything.",
    initialAccess: "Zero-day SQL injection (CVE-2023-34362) in the internet-facing MOVEit Transfer web application.",
    techniques: ["T1190", "T1505.003", "T1005", "T1041", "T1530", "T1070"],
    timeline: [
      { offsetHours: 0, date: "2023-05-27", event: "Mass exploitation begins over the Memorial Day weekend." },
      { offsetHours: 96, date: "2023-05-31", event: "The vendor discloses the vulnerability and releases patches." },
      { offsetHours: 240, date: "2023-06-06", event: "Cl0p posts an extortion notice telling victims to contact it." },
      { offsetHours: 264, date: "2023-06-07", event: "CISA and the FBI publish advisory AA23-158A." },
      { offsetHours: 432, date: "2023-06-14", event: "Cl0p begins naming victims on its leak site." },
    ],
    impact:
      "More than 2,000 organizations and tens of millions of people affected. Many victims learned of their exposure through their vendors weeks or months later.",
    keyDecisions: [
      "A zero-day is being exploited in your file transfer server. Take it offline or patch in place?",
      "How do you determine what was taken when logs are incomplete?",
      "Many of your vendors also run this product. How do you assess your exposure through them?",
      "No encryption happened. Does that change how you classify and escalate the incident?",
      "Your data appears on a leak site. What do you tell affected people?",
      "Most staff are out for the holiday. Who makes the call?",
    ],
    regulatoryFallout: [
      "Breach notifications across many jurisdictions",
      "SEC Form 8-K and 10-Q disclosures by affected public companies",
      "Federal multidistrict litigation consolidated in Massachusetts",
      "State attorney general inquiries",
    ],
    lessonsLearned: [
      "Internet-facing file transfer servers are high-value targets. Minimize exposure and monitor closely.",
      "Zero-day exploitation at scale defeats signature-based defenses.",
      "Attackers time campaigns for holidays when staffing is thin.",
      "Third-party exposure needs a vendor notification workflow ready in advance.",
    ],
  },
  {
    key: "snowflake-2024",
    title: "Data warehouse credential theft and extortion (Snowflake customers, 2024)",
    victimProfile:
      "Organizations whose cloud data warehouse user accounts (Snowflake customer tenants) had no multifactor authentication and no network allow list.",
    industry: "Cross-sector",
    asOf: AS_OF,
    provisional: false,
    sources: [
      {
        title: "Mandiant (Google Cloud): UNC5537 targets Snowflake customer instances for data theft and extortion, June 2024",
        url: "https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion",
      },
      {
        title: "Snowflake advisory: Communication ID 0108977, additional information",
        url: "https://community.snowflake.com/s/article/Communication-ID-0108977-Additional-Information",
      },
      {
        title: "CISA alert: Snowflake recommends customers take steps to prevent unauthorized access, June 2024",
        url: "https://www.cisa.gov/news-events/alerts/2024/06/03/snowflake-recommends-customers-take-steps-prevent-unauthorized-access",
      },
    ],
    summary:
      "A financially motivated group tracked as UNC5537 logged in to customer data warehouse tenants with usernames and passwords stolen by infostealer malware, some years old. The accounts had no MFA. It copied large datasets, extorted victims directly and offered data for sale on criminal forums. Mandiant found no evidence that the platform itself was breached.",
    initialAccess:
      "Valid customer credentials harvested by infostealer malware, often from contractor machines also used for personal activity, used against accounts without MFA or network allow lists.",
    techniques: ["T1078.004", "T1213", "T1567", "T1657"],
    timeline: [
      { offsetHours: 0, date: "2024-04", event: "Approximate. Early April 2024. Mandiant is engaged on the first investigations of stolen data warehouse data." },
      { offsetHours: 1416, date: "2024-05-30", event: "Approximate. Snowflake publishes guidance on detecting and preventing unauthorized user access." },
      { offsetHours: 1512, date: "2024-06-03", event: "CISA urges Snowflake customers to hunt for malicious activity and enable MFA." },
      { offsetHours: 1680, date: "2024-06-10", event: "Mandiant reports UNC5537 and says about 165 organizations were notified of possible exposure." },
    ],
    impact:
      "Large customer and call record datasets taken from many organizations, extortion demands, data offered for sale, and notification and disclosure work across sectors.",
    keyDecisions: [
      "Your warehouse logs show bulk exports from a service or user account. Do you disable it now, knowing reports and pipelines break?",
      "The account had no MFA. Who owned that exception, and how many others exist?",
      "The attacker offers to delete the data for payment. Do you engage, and who decides?",
      "Data appears for sale on a forum. How do you verify it and what do you tell customers and regulators?",
      "The platform vendor says its own systems were not breached. How do you explain shared responsibility to the board?",
    ],
    regulatoryFallout: [
      "SEC Form 8-K disclosures by affected public companies",
      "Breach notifications to individuals and state attorneys general",
      "Class action litigation against affected companies",
    ],
    lessonsLearned: [
      "MFA and network allow lists on SaaS and data platforms are not optional, including for service and analytics accounts.",
      "Infostealer logs make old credentials dangerous; rotate and monitor for exposed credentials.",
      "Bulk export alerts on data warehouses shorten the gap between theft and response.",
      "Paying for deletion gives no proof the data is gone.",
    ],
  },
  {
    key: "stryker-2026",
    title: "Stryker device wipe through Intune (2026)",
    victimProfile:
      "Global medical device manufacturer supplying hospitals with surgical equipment and implants (Stryker Corporation).",
    industry: "Medical devices",
    actorKey: "handala",
    asOf: "2026-10-26",
    provisional: false,
    sources: [
      {
        title: "Stryker Form 8-K, Item 8.01",
        url: "https://www.sec.gov/Archives/edgar/data/310764/000119312526102460/d76279d8k.htm",
        date: "2026-03",
      },
      {
        title: "Stryker Form 8-K, Item 7.01 customer update",
        url: "https://www.sec.gov/Archives/edgar/data/310764/000119312526104431/d101097d8k.htm",
        date: "2026-03",
      },
      {
        title: "Stryker Form 8-K, operations restored",
        url: "https://www.sec.gov/Archives/edgar/data/310764/000119312526118634/d94012d8k.htm",
        date: "2026-04",
      },
      {
        title: "Stryker: Customer updates on the network disruption",
        url: "https://www.stryker.com/us/en/about/news/2026/a-message-to-our-customers-03-2026.html",
        date: "2026-03",
      },
      {
        title: "Cybersecurity Dive: Stryker confirms cyberattack is contained and restoration underway",
        url: "https://www.cybersecuritydive.com/news/stryker-confirms-cyberattack-is-contained-and-restoration-underway/815427/",
        date: "2026-03-23",
      },
      {
        title: "Cybersecurity Dive: Stryker attack raises concerns about role of device management tool",
        url: "https://www.cybersecuritydive.com/news/stryker-attack-device-management-microsoft-iran/814816/",
        date: "2026-03",
      },
      {
        title: "HIPAA Journal: Stryker cyberattack has impacted first quarter earnings",
        url: "https://www.hipaajournal.com/stryker-cyberattack-iran/",
        date: "2026-04-15",
      },
    ],
    summary:
      "Attackers took over Stryker's Microsoft environment and used Microsoft Intune to send remote wipe commands to company devices. Stryker found no ransomware or malware. Order processing, manufacturing and shipping were disrupted for about four weeks. Handala, an Iran-linked persona, claimed the attack. Stryker has not confirmed attribution or method.",
    initialAccess:
      "Not disclosed. Reporting describes a compromised Windows domain admin account and a new Global Administrator account created before the wipe.",
    techniques: ["T1078.002", "T1136.003", "T1098.003", "T1072", "T1561", "T1485"],
    timeline: [
      { offsetHours: 0, date: "2026-03-11", event: "Stryker identifies a global disruption to its Microsoft environment. Reporting says company devices were wiped through Intune." },
      { offsetHours: 24, date: "2026-03-12", event: "Stryker tells customers that order processing, manufacturing and shipping are disrupted. It says patient services and connected products are not affected." },
      { offsetHours: 288, date: "2026-03-23", event: "Stryker says the attack is contained and restoration is underway." },
      { offsetHours: 552, date: "2026-04-03", event: "Approximate. Systems are reported restored." },
      { offsetHours: 696, date: "2026-04-09", event: "Stryker files a Form 8-K saying it is fully operational across global manufacturing, with a material impact on first quarter results." },
    ],
    impact:
      "About four weeks of disrupted order processing, manufacturing and shipping, and a material impact on first quarter 2026 results. The number of wiped devices, the data taken and the dollar cost are unknown.",
    keyDecisions: [
      "Your device management console is sending wipe commands. Who can stop it, and how fast?",
      "Do you cut all admin access to the identity and device management tenant, knowing recovery needs it?",
      "There is no ransom to negotiate. What do you restore first: orders, manufacturing or shipping?",
      "Hospitals need devices for scheduled surgeries. What do you tell them, and when?",
      "A group claims the attack and large data theft. How do you check the claim before you speak?",
      "When is the disruption material for an SEC filing?",
    ],
    regulatoryFallout: [
      "SEC Form 8-K filings in March and April 2026",
      "Employee lawsuits over personal data",
      "CISA guidance to harden Intune environments",
      "FBI seizure of two domains used to leak the data",
    ],
    lessonsLearned: [
      "Device management is Tier 0. One admin account can wipe the whole fleet.",
      "Require a second admin to approve wipes and other bulk device actions.",
      "Plan recovery for a destructive attack with no ransom and no decryptor.",
      "Keep a manual way to take orders and ship product.",
      "Treat attacker claims about scale as unverified until you check them.",
    ],
  },
  {
    key: "synnovis-2024",
    title: "Synnovis pathology ransomware (2024)",
    victimProfile:
      "Pathology services provider running blood tests for NHS hospital trusts in south east London (Synnovis).",
    industry: "Healthcare",
    actorKey: "qilin",
    asOf: "2026-10-26",
    provisional: false,
    sources: [
      {
        title: "Infosecurity Magazine: Synnovis, Qilin publishes NHS patient data",
        url: "https://www.infosecurity-magazine.com/news/synnovis-publish-nhs-patient-data",
        date: "2024-06",
      },
      {
        title: "ITPro: Thousands of procedures canceled at London hospitals as Qilin releases blood test data",
        url: "https://itpro.com/security/cyber-attacks/thousands-of-procedures-canceled-at-london-hospitals-as-qilin-releases-blood-test-data",
        date: "2024-06",
      },
      {
        title: "The Record: Ransomware attack contributed to patient's death, says Britain's NHS",
        url: "https://therecord.media/ransomware-attack-contributed-patient-death-uk-nhs",
        date: "2025-06",
      },
      {
        title: "The Register: NHS supplier ends probe into ransomware attack that contributed to patient death",
        url: "https://www.theregister.com/2025/11/13/synnovis_qilin_investigation/",
        date: "2025-11-13",
      },
    ],
    summary:
      "Qilin attacked Synnovis, the pathology provider to King's College Hospital and Guy's and St Thomas' NHS trusts. Blood testing stopped, thousands of appointments and procedures were postponed, and stolen patient data was published after the ransom was not paid.",
    initialAccess: "Not disclosed.",
    techniques: ["T1486", "T1567", "T1657"],
    timeline: [
      { offsetHours: 0, date: "2024-06-03", event: "Qilin attacks Synnovis. Pathology services to two NHS trusts are disrupted." },
      { offsetHours: 408, date: "2024-06-20", event: "Approximate. About 400 GB is posted on Qilin's leak site and Telegram, including patient names, dates of birth, NHS numbers and blood test descriptions." },
      { offsetHours: 8760, date: "2025-06", event: "Approximate. King's College Hospital says a delayed blood test result was among the factors in a patient's unexpected death during the attack." },
      { offsetHours: 12672, date: "2025-11-13", event: "Synnovis says its data investigation took over a year and that it will tell each NHS client by 21 November whether their patients' data was affected." },
    ],
    impact:
      "Early figures were 1,134 elective procedures and 2,194 outpatient appointments postponed. Later reporting gives about 1,710 procedures, 10,152 appointments and about 170 harm cases. The number of affected people and the total cost are unknown.",
    keyDecisions: [
      "Hospitals depend on you for blood tests. When do you tell them to move work to other labs?",
      "The demand is reported at about 50 million dollars. Do you engage at all?",
      "Stolen data is posted. How do you work out whose patients are in it when the data is fragmented?",
      "Who notifies patients: you or the hospitals you serve?",
      "With manual processes, which tests run first?",
    ],
    regulatoryFallout: [
      "Notices to each NHS client, which then notified their patients",
      "Clinical harm reviews at the affected trusts",
    ],
    lessonsLearned: [
      "A supplier outage can stop clinical care at every hospital it serves.",
      "Plan for a long data investigation when stolen data is fragmented.",
      "Agree with clients in advance who notifies patients.",
      "Manual fallback for critical clinical services needs rehearsal.",
    ],
  },
  {
    key: "storm-0501-2025",
    title: "Storm-0501 cloud ransomware in Azure (2025)",
    victimProfile:
      "Large enterprise with several subsidiaries, each with its own Active Directory domain and Azure tenant. Microsoft did not name it.",
    industry: "Cross-sector",
    actorKey: "storm-0501",
    asOf: "2026-10-26",
    provisional: false,
    sources: [
      {
        title: "Microsoft Threat Intelligence: Storm-0501's evolving techniques lead to cloud-based ransomware",
        url: "https://www.microsoft.com/security/blog/2025/08/27/storm-0501s-evolving-techniques-lead-to-cloud-based-ransomware/",
        date: "2025-08-27",
      },
      {
        title: "Microsoft Threat Intelligence: Storm-0501, ransomware attacks expanding to hybrid cloud environments",
        url: "https://www.microsoft.com/en-us/security/blog/2024/09/26/storm-0501-ransomware-attacks-expanding-to-hybrid-cloud-environments/",
        date: "2024-09-26",
      },
      {
        title: "The Hacker News: Storm-0501 exploits Entra ID to exfiltrate and delete Azure data",
        url: "https://thehackernews.com/2025/08/storm-0501-exploits-entra-id-to.html",
        date: "2025-08",
      },
    ],
    summary:
      "From domain admin on premises, the attacker pivoted through an unmonitored Entra Connect Sync server, took over a synced Global Administrator, became Owner of every Azure subscription, copied data out, deleted backups and encrypted the rest with a key it then deleted. Microsoft gave no dwell time, so the timeline shows the order of events, not real hours.",
    initialAccess:
      "Not described for this case. The attacker already held domain admin. Earlier campaigns used access brokers, stolen credentials and unpatched internet-facing servers.",
    techniques: ["T1003.006", "T1087.004", "T1098", "T1556.006", "T1484.002", "T1606.002", "T1098.003", "T1552", "T1537", "T1485", "T1490", "T1486"],
    timeline: [
      { offsetHours: 0, event: "Approximate. The attacker holds domain admin and finds an Entra Connect Sync server without endpoint protection." },
      { offsetHours: 24, event: "Approximate. Using the sync account, the attacker maps users, roles and Azure resources with AzureHound." },
      { offsetHours: 48, event: "Approximate. The attacker resets the password of a synced Global Administrator with no MFA, registers its own MFA and signs in from a hybrid joined server." },
      { offsetHours: 72, event: "Approximate. The attacker elevates access, takes Owner on every subscription and adds a federated domain for persistence." },
      { offsetHours: 96, event: "Approximate. Storage keys are stolen and data is copied out. Snapshots, restore points, backups and storage accounts are deleted." },
      { offsetHours: 120, event: "Approximate. Remaining storage is encrypted with a customer managed key that is then deleted. Key Vault soft delete lets the victim recover the key." },
      { offsetHours: 144, event: "Approximate. The attacker contacts the victim on Microsoft Teams from a compromised internal account." },
    ],
    impact:
      "Data theft, mass deletion of Azure data and backups, and cloud-side encryption with no malware in the cloud phase. The victim recovered the deleted key through soft delete.",
    keyDecisions: [
      "A Global Administrator with no MFA just registered a new MFA method. Do you disable it now?",
      "Do you stop Entra Connect Sync, knowing it halts identity changes for every subsidiary?",
      "Backups and snapshots are being deleted. What can you still protect, and who can approve it?",
      "The attacker writes to you on Teams from an internal account. Who answers, and on which channel?",
      "Data was copied and then deleted. Which customers and regulators need notice?",
    ],
    regulatoryFallout: [],
    lessonsLearned: [
      "Treat Entra Connect servers as Tier 0 and put endpoint protection on them.",
      "Use cloud-only Global Administrators with phishing-resistant MFA.",
      "Turn on Key Vault purge protection, immutable storage and resource locks.",
      "Alert on elevated access and bulk role assignments in Azure.",
    ],
  },
];

const BY_KEY: ReadonlyMap<string, Replay> = new Map(REPLAYS.map((r) => [r.key, r]));

export function getReplay(key: string): Replay | undefined {
  return BY_KEY.get(key);
}

/** Replays for pickers. Provisional replays are left out unless asked for. */
export function listReplays(opts: { includeProvisional?: boolean } = {}): Replay[] {
  const includeProvisional = opts.includeProvisional ?? false;
  return REPLAYS.filter((r) => includeProvisional || !r.provisional);
}
