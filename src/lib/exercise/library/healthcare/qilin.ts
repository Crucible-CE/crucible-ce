// Strategic TTX: Qilin style double extortion against the analytics VMs and
// the PHI warehouse of a healthcare analytics business associate. Grounded in
// Sophos (2024-08-22) and Trend Micro (2025-10) Qilin reporting, with the
// Synnovis (2024) and Change Healthcare (2024) cases as reference replays, as
// summarized in the October 2026 threat brief. Matches
// playbooks/qilin-ransomware-phi-warehouse.md.

import type { LibraryStrategicTemplate } from "../types";
import { CLOCKS, CUSTOMERS, DOMAIN, HEALTHCARE_COLLECTION_LABEL, ORG, ORG_PROFILE_MD, PEOPLE, STRATEGIC_TEAMS, VENDORS } from "./org";
import { active, kua, standby } from "./strategic-shared";

export const QILIN_TEMPLATE_ID = "lib-health-strategic-qilin-phi-warehouse";

const EXEC = "Executive";
const LEGAL = "Legal and Privacy";
const COMMS = "Communications";
const SEC = "Security";
const IT = "IT and Cloud Operations";
const CS = "Customer Success";

export const HEALTHCARE_STRATEGIC_QILIN: LibraryStrategicTemplate = {
  id: QILIN_TEMPLATE_ID,
  collection: HEALTHCARE_COLLECTION_LABEL,
  title: "Qilin ransomware on analytics VMs and the PHI warehouse",
  summary:
    "A VPN account without MFA leads, 19 days later, to an EDR killer, encrypted hypervisors and analytics VMs, and stolen warehouse PHI. Six teams decide on disconnecting customers, patient safety at a hospital customer, the ransom, the partial leak, and notice to 46 covered entities before scoping is done.",
  branching: "linear",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "Qilin ransomware on analytics VMs and the PHI warehouse",
      domain: "cyber",
      crisisType: "Ransomware / Extortion",
      threatActorKey: "qilin",
      replayKey: "synnovis-2024",
      industryKey: "health-informatics",
      orgProfileMd: ORG_PROFILE_MD,
      complexity: "advanced",
      stakeholders: ["Covered entity customers", "Patients", "HHS OCR", "Cyber insurer", "FBI", "Shareholders", "Media"],
    },
    winCondition: "none",
    teams: STRATEGIC_TEAMS,
    scenarioAnchor: { weekday: 4, time: "03:00" },
    targetDurationMin: 140,
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.baa, CLOCKS.hipaa, CLOCKS.stateAg, CLOCKS.sec],
    executiveBriefMd: [
      ORG_PROFILE_MD,
      "",
      "Besides Azure, the company runs a small VMware cluster in its Columbus data center for domain controllers, file servers, the Entra Connect server and legacy SQL Server analytics. Contractors reach it through an older SSL VPN.",
      "",
      "Some hospital customers use Quarrystone's daily worklists to drive care management and lab follow-up. If the worklists stop, clinical staff fall back to manual lists.",
      "",
      "You play the company's leadership and response teams. Decide, name who owns each decision, and say what you do not know yet. Five clocks can start: cyber insurer notice, the contractual BAA notice (5 business days), HIPAA business associate notice (60 days), Texas attorney general notice and the SEC Form 8-K.",
      "",
      "The reference cases are Synnovis (2024) and Change Healthcare (2024). The library playbook for this scenario is Ransomware on analytics systems and the PHI warehouse.",
    ].join("\n"),
  },
  objectives: [
    { key: "contain", text: "Contain the intrusion and decide on customer integrations within the first four hours, with the decision recorded.", capabilityKeys: ["RS.MI", "RS.MA"] },
    { key: "safety", text: "Identify customers whose care operations depend on Quarrystone outputs and support them within one day.", capabilityKeys: ["RC.CO", "GV.OC"] },
    { key: "ransom", text: "Make a documented ransom decision with OFAC screening, insurer consent, FBI input and board approval.", capabilityKeys: ["GV.RR", "GV.RM"] },
    { key: "notify", text: "Meet BAA, HIPAA, state and SEC duties even while scoping is incomplete, sending what is known and supplementing.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "recover", text: "Restore service from clean sources with a validation sign-off before each customer reconnects.", capabilityKeys: ["RC.RP"] },
  ],
  injects: [
    {
      nodeId: "q1",
      title: "Endpoints go dark, then the hypervisors",
      scenarioOffsetMin: 0,
      plannedDelayMin: 20,
      objectiveKeys: ["contain"],
      phase: "opening",
      narrativeMd: [
        "Thursday 03:00. At 01:55 Defender for Endpoint stopped reporting from 64 servers within four minutes. At 02:20 the on-premises VMware hosts became unreachable. By 02:40 the Windows analytics VMs in Azure, all joined to the domain, show ransom notes. Customer feeds and dashboards are down for every customer.",
        "",
        kua(
          [
            "A kernel driver named eskle.sys was installed as a service on the first hosts to go dark.",
            "Domain controllers on the VMware cluster are encrypted. Azure domain controllers are still up.",
            "The Databricks PHI warehouse is not encrypted. It runs on Azure managed compute.",
          ],
          ["How the attacker got in.", "Whether data was taken before encryption."],
          ["Any domain account may be compromised."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "q1-note",
          kind: "ransom_note",
          title: "Ransom note on an analytics VM",
          from: "Unknown",
          sentAt: "Thursday 02:38",
          content: [
            "--- README-RECOVER-qsha.txt ---",
            "",
            "Quarrystone Health Analytics. Your network is encrypted. We downloaded your warehouse and your file servers.",
            "",
            "If you do not contact us within 72 hours we will start publishing patient data and send it to your customers and to journalists.",
            "",
            "Do not shut down or restore systems. Do not hire negotiators who will waste your time.",
            "",
            "Chat: [onion link]   Login: qsha-7e41",
          ].join("\n"),
        },
        {
          id: "q1-logs",
          kind: "log_excerpt",
          title: "Last events before EDR went silent",
          from: SEC,
          sentAt: "Thursday 02:50",
          content: [
            "```",
            "01:51:12  QS-FS02    System 7045    ServiceName=eskle  ImagePath=C:\\Windows\\Temp\\eskle.sys  ServiceType=kernel mode driver",
            "01:52:40  QS-FS02    Security 1102  The audit log was cleared  SubjectUserName=adm-jtran",
            "01:55:03  MDE        DeviceHealth   sensor=Inactive  devices=64",
            "02:19:47  QS-ESX03   vmkernel       Lost connectivity, host not responding",
            "02:31:22  QS-AVM-17  Microsoft-Windows-Sysmon 11  TargetFilename=D:\\warehouse\\README-RECOVER-qsha.txt",
            "```",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(SEC, "Your EDR is blind on the affected hosts. The Azure domain controllers still have Defender running.", [
          "What do you contain first, and how do you keep the attacker from reaching the Azure domain controllers and the warehouse?",
          "What evidence must you capture before anything is rebuilt?",
        ]),
        active(IT, "Azure Backup holds recovery points for the analytics VMs. The VMware cluster backs up to an on-premises appliance on the same domain.", [
          "What do you shut down, isolate or leave running right now?",
          "Which backups do you trust, and how do you protect them in the next hour?",
        ]),
        active(EXEC, `${PEOPLE.ciso}, the CISO, calls the CEO at 03:05.`, [
          "Do you declare an incident, and who commands it?",
          "Who outside the company do you call before 08:00?",
        ]),
        standby(LEGAL, "Legal has not been called yet."),
        standby(COMMS, "Nothing is public."),
        standby(CS, "Customers' overnight jobs are failing. Support tickets will start at 06:00."),
      ],
      expectedActions: {
        [SEC]: [
          "Isolates the Azure domain controllers' network paths from on-premises and blocks the VPN",
          "Captures memory and disk from a sample of encrypted hosts before rebuild",
          "Rotates the Databricks and storage credentials used by the analytics VMs",
        ],
        [IT]: [
          "Takes the on-premises backup appliance off the domain network",
          "Confirms Azure Backup soft delete and immutability state before any restore",
          "Leaves encrypted VMs powered as they are for forensics",
        ],
        [EXEC]: ["Declares an incident and names an incident commander", "Has counsel engage the IR retainer and notify the insurer", "Calls the FBI field office"],
      },
      capabilityKeys: ["RS.MA", "RS.MI", "DE.AE"],
      mitreTags: ["T1068", "T1562.001", "T1070.001", "T1486", "T1490"],
      gradingNotes: "Trend Micro reported Qilin using a BYOVD driver, eskle.sys, to kill security tools. Effective answers protect what still works (Azure DCs, backups, the warehouse) before chasing the encrypted estate.",
      clockUpdates: [
        { key: CLOCKS.insurer.key, action: "trigger" },
        { key: CLOCKS.baa.key, action: "trigger" },
        { key: CLOCKS.hipaa.key, action: "trigger" },
      ],
    },
    {
      nodeId: "q2",
      title: "Nineteen days inside",
      scenarioOffsetMin: 240,
      plannedDelayMin: 25,
      objectiveKeys: ["contain", "notify"],
      phase: "main",
      narrativeMd: [
        `Thursday 07:00. ${VENDORS.ir} has a first timeline. Nineteen days ago a contractor account logged in to the SSL VPN with a valid password and no MFA. Eleven days later the attacker reached a domain controller and edited the **Default Domain Policy** to run a logon script, IPScanner.ps1, that copied Chrome stored credentials from every machine. Output was staged in SYSVOL by host name and the script ran for three days.`,
        "",
        kua(
          [
            "Harvested Chrome credentials include saved logins for the Azure portal, the Databricks workspace and several customer SFTP portals.",
            "Between days 15 and 18, about 1.9 TB left from the Databricks workspace and the legacy SQL servers to 198.51.100.77.",
            "Customer integrations into Quarrystone are still open: SFTP drops, API keys and two site to site VPNs with hospitals.",
          ],
          ["Which customers' tables are in the 1.9 TB.", "Whether the attacker used harvested customer portal credentials."],
          ["Every password saved in Chrome on a domain machine is known to the attacker."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "q2-gpo",
          kind: "log_excerpt",
          title: "VPN, directory and SYSVOL evidence",
          from: VENDORS.ir,
          sentAt: "Thursday 06:40",
          content: [
            "```",
            "Day 0   22:14  SSLVPN  user=ctr-bpatel  src=203.0.113.62  auth=password  mfa=none  result=success",
            "Day 11  01:03  QS-DC02  Security 5136  ObjectDN=CN={31B2F340-016D-11D2-945F-00C04FB984F9},CN=Policies,CN=System  AttributeLDAPDisplayName=gPCUserExtensionNames  SubjectUserName=adm-jtran",
            "Day 11  01:05  \\\\" + DOMAIN + "\\SYSVOL\\" + DOMAIN + "\\Policies\\{31B2F340-...}\\User\\Scripts\\Logon\\IPScanner.ps1  created",
            "Day 12  08:41  \\\\" + DOMAIN + "\\SYSVOL\\" + DOMAIN + "\\scripts\\out\\QS-LT-0412.log  size=18 KB",
            "Day 15  02:12  Databricks audit  actionName=commandSubmit  user=svc-etl-legacy  sourceIPAddress=198.51.100.77",
            "```",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(EXEC, "Change Healthcare disconnected its systems on day one in 2024. Several customers rely on your daily feeds for operations.", [
          "Do you disconnect every customer integration now? Who decides, and how are customers told?",
        ]),
        active(SEC, "The harvested credentials reach well beyond your network.", [
          "Which credentials do you reset or revoke, in what order, and how do you handle customer portal passwords that were saved in Chrome?",
          "How do you clean the GPO and SYSVOL without destroying evidence?",
        ]),
        active(IT, "The VPN is the original door and contractors still need access.", ["What happens to the SSL VPN and contractor access today?"]),
        active(LEGAL, "Encryption hit systems with ePHI, and data left from the warehouse.", [
          "Is this a breach for HIPAA and the BAAs, and from when?",
          "What do the BAA notices say on day one, when scope is unknown?",
        ]),
        active(CS, "Tickets are arriving from every customer.", ["What do customers hear from you this morning, and who says it?"]),
        standby(COMMS, "A hospital IT employee has posted on a professional forum that Quarrystone feeds are down."),
      ],
      expectedActions: {
        [EXEC]: [
          "Disconnects customer integrations into the affected environment and records who decided",
          "Has each affected customer called before or as the connection is cut",
        ],
        [SEC]: [
          "Treats every Chrome stored credential as compromised and forces resets for affected users and services",
          "Tells customers which of their portal credentials were saved on Quarrystone machines so they can rotate them",
          "Removes the GPO change after imaging SYSVOL",
          "Resets krbtgt twice",
        ],
        [IT]: ["Shuts the SSL VPN and moves contractors to a path that requires MFA", "Disables Chrome password storage by policy on rebuilt machines"],
        [LEGAL]: [
          "Applies OCR's ransomware presumption and treats exfiltration as a breach",
          "Sends BAA notices with known facts and a supplement date, without waiting for scope",
        ],
        [CS]: ["Calls every customer through a named owner with an agreed script", "Logs customer requests and promised follow-ups"],
      },
      capabilityKeys: ["RS.MI", "RS.AN", "GV.OC", "RS.CO"],
      mitreTags: ["T1133", "T1078", "T1484.001", "T1555.003", "T1074", "T1567"],
      gradingNotes: "The GPO credential harvest follows Sophos X-Ops (2024-08-22). Effective answers recognize that credentials for customers' systems are part of the blast radius.",
    },
    {
      nodeId: "q3",
      title: "A hospital reports delayed care",
      scenarioOffsetMin: 1800,
      plannedDelayMin: 25,
      objectiveKeys: ["safety", "notify"],
      phase: "main",
      narrativeMd: [
        `Friday 09:00. ${CUSTOMERS.childrens}'s chief medical officer writes that without the daily care management worklists, nurses missed follow-up calls for children with abnormal lab results. Two families came to the emergency department. No harm is confirmed yet.`,
        "",
        kua(
          [
            "Five customers use the worklists for clinical follow-up. Rebuilding the worklist pipeline from clean sources will take at least five days.",
            "The warehouse tables in the 1.9 TB cover 31 of 46 customers, including about 2.4 million Texas residents.",
          ],
          ["Exactly which patients were in the exfiltrated tables.", "Whether other hospitals have seen care delays."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "q3-cmo",
          kind: "email",
          title: "Hospital chief medical officer",
          from: `Chief medical officer, ${CUSTOMERS.childrens}`,
          sentAt: "Friday 08:12",
          content: [
            "**From:** Dr. Helen Abara <habara@cedarprairie.example>",
            `**To:** ${PEOPLE.ceo} <dana.whitlock@${DOMAIN}>; ${PEOPLE.cs} <alicia.moreno@${DOMAIN}>`,
            "**Subject:** Patient safety impact of your outage",
            "",
            "Our nurses rely on your worklists every morning. Since Thursday we have missed follow-ups on abnormal labs, and two families went to our emergency department yesterday.",
            "",
            "I need, today: a realistic date for the worklists, any manual extract you can give us safely, and a named person we can call at any hour. We are reporting this through our own patient safety process.",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(CS, "Five customers use the worklists clinically. Only Cedar Prairie has written.", [
          "How do you find and support every customer whose care depends on your outputs today?",
          "Can you give hospitals a manual extract, and what must be true to do it safely?",
        ]),
        active(EXEC, "In 2025 King's College Hospital said a long wait for a blood test result during the Synnovis attack was among the factors in a patient's death.", [
          "Do you change restore priorities for patient safety, even if it delays larger customers?",
          "Who speaks to the hospital's leadership today?",
        ]),
        active(COMMS, "A local reporter has heard that a children's hospital has problems linked to a vendor outage.", [
          "How do you talk about patient safety without speculating, and who approves it?",
        ]),
        active(LEGAL, "The Texas count is now large.", ["Which state notices does this scope trigger, and who files them: you or the covered entities?"]),
        standby(SEC, "Security is scoping the exfiltration."),
        standby(IT, "Rebuild of the analytics environment is under way."),
      ],
      expectedActions: {
        [CS]: [
          "Contacts all five clinical worklist customers today, not only the one that wrote",
          "Offers a validated manual extract from a clean source with a named on-call contact",
          "Gives hospitals a realistic date range for the worklists",
        ],
        [EXEC]: ["Moves clinical worklists to the top of the restore order and records why", "Calls the hospital's CEO or CMO personally"],
        [COMMS]: ["Acknowledges disruption and support to hospitals without speculating on harm", "Coordinates statements with the hospital's communications team"],
        [LEGAL]: ["Maps Texas attorney general notice and who files it under each BAA", "Checks which states treat HIPAA compliant notice as sufficient"],
      },
      capabilityKeys: ["RC.CO", "RC.RP", "RS.CO"],
      clockUpdates: [{ key: CLOCKS.stateAg.key, action: "trigger" }],
    },
    {
      nodeId: "q4",
      title: "The price, the board and the disclosure committee",
      scenarioOffsetMin: 6120,
      plannedDelayMin: 25,
      objectiveKeys: ["ransom", "notify"],
      phase: "main",
      narrativeMd: [
        "Monday 09:00. The attacker's chat names a price of **$12 million**, falling to $8 million if paid by Wednesday, and posts a screenshot of warehouse table names. Their leak site lists Quarrystone without data yet.",
        "",
        "The board meets at 14:00. The disclosure committee meets at 11:00. Finance estimates $40 million to $65 million in costs, credits and lost revenue.",
        "",
        kua(
          [
            "Azure Backup recovery points for the analytics VMs are clean and restorable. The VMware cluster is being rebuilt from scratch.",
            "Counsel's OFAC screen of the wallet found no listed address. The FBI has the indicators.",
            "The insurer's policy requires its written consent before any payment and use of its panel negotiator.",
          ],
          ["Whether the attacker would delete the data if paid.", "Whether a second group would surface with the same data."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "q4-insurer",
          kind: "email",
          title: "Insurer on consent and the panel",
          from: VENDORS.insurer,
          sentAt: "Monday 08:30",
          content: [
            `**From:** Claims, ${VENDORS.insurer} <cyberclaims@halbrook.example>`,
            `**To:** ${PEOPLE.gc} <priya.raman@${DOMAIN}>`,
            "**Subject:** Policy QSH-CY-2026, consent requirements",
            "",
            "As a reminder, any extortion payment requires our prior written consent and must be handled through a panel negotiator. Costs from non-panel vendors engaged without our consent may not be covered. Please send the OFAC screening and the law enforcement contact record with any request.",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(EXEC, "A board member cites Change Healthcare, which reportedly paid $22 million and still faced a second extortion claim.", [
          "What do you recommend to the board on payment, and what is the decision record?",
          "If the board wants to pay, what must happen first?",
        ]),
        active(LEGAL, "The committee must decide materiality under Item 1.05.", [
          "Is the incident material today? Record the basis and the time.",
          "How do you coordinate with public customers who may file their own disclosures?",
        ]),
        active(SEC, "The attacker's chat asks for a contact.", ["What role does Security play in any negotiation, and what do you share with the FBI?"]),
        active(IT, "Recovery without paying is possible but slow.", ["Give the board a realistic restore timeline without the decryptor."]),
        standby(COMMS, "Staff ask whether the company will pay."),
        standby(CS, "Customers are asking the same question."),
      ],
      expectedActions: {
        [EXEC]: [
          "Puts OFAC screening, insurer consent, FBI input and the restore timeline in front of the board before a decision",
          "Records the decision, the vote and the reasons",
          "Recognizes that payment does not end the theft or the notice duties",
        ],
        [LEGAL]: ["Records the materiality determination and starts the four business day clock", "Shares the filing timing with public customers under NDA"],
        [SEC]: ["Supports the panel negotiator with technical validation only", "Shares indicators and the timeline with the FBI through counsel"],
        [IT]: ["Gives a restore timeline by customer tier with assumptions stated", "Confirms backup integrity checks before any restore"],
      },
      capabilityKeys: ["GV.RR", "GV.OC", "RC.RP"],
      clockUpdates: [{ key: CLOCKS.sec.key, action: "trigger" }],
    },
    {
      nodeId: "q5",
      title: "Patient names on the leak site",
      scenarioOffsetMin: 24840,
      plannedDelayMin: 25,
      objectiveKeys: ["notify", "safety"],
      phase: "main",
      narrativeMd: [
        "Sunday 09:00, day 17. The leak site and a Telegram channel published about **300 GB**: patient names, dates of birth, member IDs and diagnosis codes from 12 customers, plus internal spreadsheets. A class action was filed Friday. HHS OCR has written. Journalists ask whether a ransom was paid.",
        "",
        kua(
          ["The published data matches warehouse tables.", "Most customers are reconnected. Two hospitals still use manual worklists."],
          ["What the attacker will publish next.", "Which individual patients are affected at each of the other 19 customers."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "q5-leak",
          kind: "social_post",
          title: "Leak site post",
          from: "Leak site",
          sentAt: "Saturday 23:00",
          content:
            "**Quarrystone Health Analytics (USA)**\n\nHealthcare analytics for 46 hospitals and health plans. Part 1: 300 GB. Patients, claims, diagnoses, internal finance.\n\nThey chose not to protect their patients. Part 2 soon.",
        },
        {
          id: "q5-ocr",
          kind: "regulator_letter",
          title: "HHS OCR letter",
          from: "HHS Office for Civil Rights",
          sentAt: "Friday",
          content: [
            "**U.S. Department of Health and Human Services, Office for Civil Rights**",
            "",
            `Re: ${ORG}, ransomware incident affecting protected health information`,
            "",
            "OCR has received reports from covered entities that use your services. Please provide within 20 days: a description of the incident; the dates of discovery and of notice to each covered entity; your most recent risk analysis; and your security policies on remote access, multifactor authentication and audit controls.",
          ].join("\n"),
        },
        {
          id: "q5-reporter",
          kind: "email",
          title: "Reporter asks about the ransom",
          from: "Health Systems Ledger",
          sentAt: "Sunday 07:40",
          content:
            "**From:** Jonah Reyes <jreyes@healthsystemsledger.example>\n**Subject:** Leaked patient data\n\nThe Qilin site has posted data it says came from Quarrystone, with patient names. Did Quarrystone pay or negotiate a ransom, and have patients been told? Filing at 15:00.",
        },
      ],
      teamVariants: [
        active(COMMS, "Patients will see this story today.", [
          "What do you say about the leak and the ransom question, and to whom first?",
          "What does a patient who calls tomorrow hear?",
        ]),
        active(LEGAL, "Twelve customers' patients are now public.", [
          "How do you respond to OCR, and what notices change now that data is public?",
          "Do you offer to send individual notices for customers?",
        ]),
        active(CS, "Customers whose data was published want answers before their own press calls.", ["How do you handle the twelve named customers today?"]),
        active(SEC, "Patients may be targeted by phishing using the leaked data.", ["What do you do about the leaked data and follow-on fraud?"]),
        active(EXEC, "The board wants to know whether the decision on payment still stands.", ["Does the leak change your ransom decision? Why or why not?"]),
        standby(IT, "Restores are nearly complete."),
      ],
      expectedActions: {
        [COMMS]: [
          "Tells customers before the public, then publishes one statement with the same facts",
          "Answers the ransom question truthfully without negotiating details",
          "Sets up a patient call center script and an FAQ",
        ],
        [LEGAL]: [
          "Responds to OCR through counsel with the discovery and notice dates",
          "Offers delegated individual, HHS and media notice to customers in writing",
        ],
        [CS]: ["Calls the twelve named customers before 15:00", "Gives each a copy of the public statement in advance"],
        [SEC]: ["Monitors the leak for further posts and preserves copies through counsel", "Gives customers phishing indicators to share with patients"],
        [EXEC]: ["Holds or revisits the decision with the board on the record", "States that payment would not remove published data"],
      },
      capabilityKeys: ["RS.CO", "GV.OC", "RC.CO"],
    },
    {
      nodeId: "q6",
      title: "Day 46: the 60 day line",
      scenarioOffsetMin: 66600,
      plannedDelayMin: 20,
      objectiveKeys: ["notify", "recover"],
      phase: "resolution",
      narrativeMd: [
        "Monday 09:00, day 46. Service is back for every customer. Scoping has confirmed affected patients for 18 of 31 customers. The other 13 have fragmented tables that the forensic firm says may take months, as Synnovis found when its data review took over a year.",
        "",
        "The HIPAA outer limit for notice to covered entities is day 60. Two customers say they will not send patient letters until they have a final list.",
        "",
        kua(
          ["About 6.8 million individuals confirmed so far.", "The cost estimate is $58 million."],
          ["The final count for the 13 customers.", "Whether more data will be published."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(LEGAL, "Day 60 is two weeks away.", [
          "What do you send the 13 customers before day 60, and how do you supplement it?",
          "How do you handle customers who want to wait for a final list?",
        ]),
        active(SEC, "Scoping is slow because the tables are fragmented.", ["How do you prioritize which customers to scope first?"]),
        active(IT, "The board asks what keeps this from happening again.", ["What are the three changes that would have stopped this intrusion, with owners and dates?"]),
        active(EXEC, "The board wants a post-incident review in 30 days.", ["What does the review cover, and who leads it?"]),
        active(CS, "Renewals for ten customers fall in the next quarter.", ["What evidence do you give customers that the gaps are closed?"]),
        active(COMMS, "Staff have worked six weeks of incident hours.", ["What do you tell staff and customers about what changes now?"]),
      ],
      expectedActions: {
        [LEGAL]: [
          "Sends every remaining customer what is known before day 60, with a written supplement schedule",
          "Tells customers that their own notice duties are not paused while the final list is built",
        ],
        [SEC]: ["Scopes first the customers with the most individuals or most sensitive data", "Writes down what cannot be scoped and why"],
        [IT]: [
          "Names MFA on every remote access path, removal of Chrome password storage and Tier 0 monitoring with owners",
          "Adds locked immutable backups for on-premises systems",
        ],
        [EXEC]: ["Commissions a review led by someone outside the response", "Reports results to the board with owners and dates"],
        [CS]: ["Shares an independent assessment summary under NDA", "Offers renewal customers a joint control review"],
        [COMMS]: ["Gives staff a plain account and recognition", "Tells customers the list of changes and dates"],
      },
      capabilityKeys: ["GV.OC", "ID.IM", "RC.CO"],
    },
  ],
  branches: [],
};
