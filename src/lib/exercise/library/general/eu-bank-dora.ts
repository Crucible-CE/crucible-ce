// Strategic TTX: ransomware at a core banking SaaS provider takes down
// payments and online banking at an EU retail bank. Grounded in DORA
// (Regulation (EU) 2022/2554, Arts. 11, 19, 28 and 30), Delegated
// Regulations (EU) 2024/1772 (classification) and 2025/301 (time limits),
// NIS2 Art. 23 and the DORA lex specialis rule, and GDPR Arts. 33 and 34, as
// summarized in the threat brief addendum. Matches
// playbooks/data-breach-notification.md section 15 (F-A) and
// playbooks/business-continuity-site-loss.md (B-C, B-D, section 12). All
// names are fictional; IP addresses are RFC 5737.

import type { LibraryStrategicTemplate } from "../types";
import { active, kua, standby } from "../healthcare/strategic-shared";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const EU_BANK_DORA_TEMPLATE_ID = "lib-general-strategic-eu-bank-dora";

const ORG = "Veldmark Bank N.V.";
const DOMAIN = "veldmarkbank.example";
const PROVIDER = "Tessaline Core Systems";

const EXEC = "Management Board";
const ORC = "Operational Risk and Compliance";
const IT = "IT and Security";
const OPS = "Payments and Operations";
const COMMS = "Communications and Clients";
const LEGAL = "Legal and Privacy";
const TEAMS = [EXEC, ORC, IT, OPS, COMMS, LEGAL];

const CLOCKS = {
  awareness: { key: "dora_initial", label: "DORA initial notification, at most 24 hours after awareness", durationHours: 24 },
  classified: { key: "dora_initial_4h", label: "DORA initial notification, 4 hours after classification as major", durationHours: 4 },
  intermediate: { key: "dora_intermediate", label: "DORA intermediate report (72 hours after the initial notification)", durationHours: 72 },
  gdpr: { key: "gdpr_72h", label: "GDPR notice to the supervisory authority (Art. 33, 72 hours)", durationHours: 72 },
  final: { key: "dora_final", label: "DORA final report (one month after the latest intermediate report)", durationHours: 30 * 24 },
} as const;

const PROFILE =
  `**${ORG}** is a retail bank headquartered in Utrecht with a branch in Belgium, about 1.9 million clients, 2,300 staff and EUR 41 billion in assets. It is a credit institution under DORA and a less significant institution supervised by its national competent authority. ` +
  `Core banking (accounts, ledger, payments hub, online and mobile banking back end) runs as a managed service from ${PROVIDER} B.V., hosted in two of the provider's data centers in the Netherlands. ` +
  "Cards are authorized by a separate card processor that can approve transactions in stand-in mode up to set limits when the core is unreachable. " +
  `The ICT third-party register lists ${PROVIDER} as supporting critical or important functions. The exit plan for ${PROVIDER} was documented in 2025 and has not been tested end to end.`;

export const GENERAL_STRATEGIC_EU_BANK_DORA: LibraryStrategicTemplate = {
  id: EU_BANK_DORA_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Major ICT incident at an EU bank's core banking provider",
  summary:
    "Ransomware at a core banking SaaS provider takes down payments and online banking for 1.9 million clients in two Member States. Six teams classify the incident under DORA, run the reporting clocks, keep clients paid through contingency channels, handle a GDPR breach at the provider, and decide whether to exit the provider.",
  branching: "linear",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "Major ICT incident at an EU bank's core banking provider",
      domain: "cyber",
      crisisType: "Third-Party Breach",
      industryKey: "fintech",
      orgProfileMd: PROFILE,
      complexity: "advanced",
      stakeholders: ["Clients", "Competent authority", "Data protection authority", "ICT provider", "Card processor", "Media", "Staff"],
    },
    winCondition: "none",
    teams: TEAMS,
    scenarioAnchor: { weekday: 4, time: "07:05" },
    targetDurationMin: 140,
    regulatoryClocks: [CLOCKS.awareness, CLOCKS.classified, CLOCKS.intermediate, CLOCKS.gdpr, CLOCKS.final],
    executiveBriefMd: [
      PROFILE,
      "",
      `Since 06:20 on Thursday the mobile app and internet banking have failed for most clients, and outgoing SEPA payments are stuck. At 06:55 ${PROVIDER}'s CISO called Veldmark's CISO.`,
      "",
      "You play the bank's Management Board, Operational Risk and Compliance, IT and Security, Payments and Operations, Communications and Clients, and Legal and Privacy teams. Five clocks can start: the DORA initial notification (24 hours from awareness, and 4 hours from classification as major), the intermediate report, the final report, and GDPR notice to the supervisory authority.",
      "",
      "The library playbooks for this scenario are Data breach notification and disclosure (section 15 on DORA and NIS2) and Business continuity and disaster recovery: site or region loss.",
    ].join("\n"),
  },
  objectives: [
    { key: "classify", text: "Classify the incident under the DORA criteria with a recorded time and basis, and send the initial notification on time.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "continuity", text: "Keep clients able to pay and get cash through contingency channels, in BIA order.", capabilityKeys: ["RC.RP", "RS.MA"] },
    { key: "clients", text: "Inform clients without undue delay with what is affected and what they can do.", capabilityKeys: ["RS.CO", "RC.CO"] },
    { key: "privacy", text: "Meet GDPR duties as controller for client data held by the provider.", capabilityKeys: ["GV.OC"] },
    { key: "provider", text: "Hold the provider to its contract, require evidence before reconnecting, and decide on exit.", capabilityKeys: ["GV.SC", "ID.IM"] },
  ],
  injects: [
    {
      nodeId: "d1",
      title: "The core is down",
      scenarioOffsetMin: 0,
      plannedDelayMin: 20,
      objectiveKeys: ["continuity", "classify"],
      phase: "opening",
      narrativeMd: [
        `Thursday 07:05. ${PROVIDER}'s CISO says the provider found ransomware in its hosting environment at 05:50 and isolated both data centers. Every client bank on the platform is affected. The provider has engaged an incident response firm and will update at 10:00.`,
        "",
        kua(
          [
            "Online and mobile banking fail for about 90 percent of sessions. Outgoing SEPA and SEPA Instant payments are queued, not sent.",
            "Card payments work in stand-in mode at the card processor up to the current limits.",
            "Salary runs for about 60 corporate clients are due Friday.",
          ],
          ["Whether data was taken from the provider.", "How long restoration will take."],
          ["The bank became aware of the incident at 06:55."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "d1-status",
          kind: "document",
          title: "Provider status page",
          from: PROVIDER,
          sentAt: "Thursday 06:40",
          content: "**Service disruption.** We are investigating a disruption affecting core banking services for some clients. Our teams are working to restore service as quickly as possible. Next update 10:00 CET.",
        },
      ],
      teamVariants: [
        active(IT, "The bank's own network and the connection to the provider are still up.", [
          "Do you keep or cut the network connection to the provider, and what evidence do you need from them?",
          "What do you check in the bank's own environment today?",
        ]),
        active(OPS, "Clients cannot see balances or send payments.", [
          "Which contingency channels do you start now, and in what order?",
          "What do you do about card stand-in limits?",
        ]),
        active(EXEC, "The CRO and the CIO call the CEO at 07:10.", [
          "Do you invoke the crisis plan? Who leads, and how often does the board meet?",
        ]),
        standby(ORC, "Operational risk has heard about the outage from the service desk."),
        standby(COMMS, "Clients are posting about the app on social media."),
        standby(LEGAL, "Legal has not been called."),
      ],
      expectedActions: {
        [IT]: [
          "Cuts or restricts the network connection to the provider until it gives indicators and confirmation of containment",
          "Hunts for the provider's indicators in the bank's own environment",
          "Asks the provider in writing for scope, timeline and evidence",
        ],
        [OPS]: [
          "Starts contingency channels in BIA order: cards, cash at branches, urgent payments",
          "Reviews stand-in limits with the card processor and records any change",
        ],
        [EXEC]: ["Invokes the crisis plan with a named lead", "Records the awareness time for the reporting clocks"],
      },
      capabilityKeys: ["RS.MA", "RC.RP", "GV.SC"],
      gradingNotes: "DORA's initial notification is due no later than 24 hours after awareness even before classification. Effective answers record 06:55 as the awareness time and start the DORA classification at once.",
      clockUpdates: [{ key: CLOCKS.awareness.key, action: "trigger" }],
    },
    {
      nodeId: "d2",
      title: "Is it major?",
      scenarioOffsetMin: 180,
      plannedDelayMin: 25,
      objectiveKeys: ["classify", "clients"],
      phase: "main",
      narrativeMd: [
        `Thursday 10:05. ${PROVIDER}'s 10:00 update says restoration from backups will take \"several days\" and that it is investigating possible data exfiltration. The outage has lasted almost four hours.`,
        "",
        kua(
          [
            "About 1.7 million clients cannot use online or mobile banking. Clients in the Netherlands and Belgium are affected.",
            "Payments are a critical or important function in the register. Queued outgoing payments total about EUR 380 million.",
            "Cash withdrawals at ATMs work through the card processor's stand-in.",
          ],
          ["Whether client data left the provider.", "Whether other banks on the platform have classified the incident."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "d2-worksheet",
          kind: "document",
          title: "DORA classification worksheet",
          from: ORC,
          sentAt: "Thursday 09:50",
          content: [
            "| Criterion (Delegated Regulation 2024/1772) | Threshold | Status |",
            "|---|---|---|",
            "| Critical services affected | Required | Yes: payments, account access |",
            "| Clients affected | Over 10 percent or over 100,000 | About 1.7 million |",
            "| Duration or downtime | Over 24 hours, or over 2 hours for critical or important functions | Almost 4 hours, ongoing |",
            "| Geographical spread | Two or more Member States | Netherlands and Belgium |",
            "| Data losses | Availability, integrity, confidentiality | Availability yes; confidentiality unknown |",
            "| Economic impact | Over EUR 100,000 | Likely |",
            "| Reputational impact | Media, complaints | Social media complaints rising |",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(ORC, "The worksheet is in front of you.", [
          "Is this a major ICT-related incident? Record the criteria met and the time of classification.",
          "What goes in the initial notification when so much is unknown?",
        ]),
        active(COMMS, "Clients want to know whether their money is safe.", [
          "What do clients hear, through which channels, and how soon?",
        ]),
        active(LEGAL, "The provider mentions possible exfiltration.", [
          "What does the bank owe as controller if client data was taken, and when does that clock start?",
        ]),
        active(EXEC, "The CEO of the provider asks for a call.", ["What do you ask the provider's CEO for, in writing?"]),
        standby(IT, "IT is hunting for indicators in the bank's environment."),
        standby(OPS, "Contingency channels are running."),
      ],
      expectedActions: {
        [ORC]: [
          "Classifies the incident as major on the critical services criterion plus clients, duration and geography",
          "Records the classification time and starts the 4 hour clock",
          "Sends an initial notification with known facts and states what is unknown",
        ],
        [COMMS]: [
          "Tells clients what works (cards, ATMs) and what does not, on the website, app banner and phone lines",
          "Says money and balances are safe only if the bank can confirm it",
        ],
        [LEGAL]: [
          "Asks the provider as processor for breach details without undue delay",
          "Prepares for a GDPR Art. 33 assessment once the facts arrive",
        ],
        [EXEC]: [
          "Asks the provider for scope, timeline, containment evidence and its own regulatory notices in writing",
          "Reserves contractual rights",
        ],
      },
      capabilityKeys: ["GV.OC", "RS.CO", "GV.SC"],
      gradingNotes: "Under Delegated Regulation 2024/1772 an incident is major when it affects critical services and meets at least two other thresholds, or involves malicious unauthorized access that may lead to data loss. Here the critical services, clients, duration and geography criteria are all met. The initial notification is then due within 4 hours of classification.",
      clockUpdates: [{ key: CLOCKS.classified.key, action: "trigger" }],
    },
    {
      nodeId: "d3",
      title: "Both data centers",
      scenarioOffsetMin: 480,
      plannedDelayMin: 25,
      objectiveKeys: ["continuity", "classify"],
      phase: "main",
      narrativeMd: [
        `Thursday 15:05. ${PROVIDER} confirms its secondary data center was encrypted too; replication carried the damage. It will restore from offline backups and estimates core banking back in **3 to 5 days**, with online banking after that.`,
        "",
        kua(
          [
            "The initial notification went to the competent authority at 12:40.",
            `${PROVIDER} says it filed its own NIS2 early warning as a managed service provider.`,
            "Friday salary runs for 60 corporate clients total about EUR 95 million.",
            "A contingency channel for urgent payments exists but has been tested once, for 200 payments.",
          ],
          ["Whether the restore will be clean.", "How many duplicate or failed payments the queue will produce."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(OPS, "Friday salaries matter most to clients.", [
          "How do you get Friday salaries paid, and what is the risk of duplicates later?",
          "Do you raise card stand-in limits, and who carries the credit risk?",
        ]),
        active(IT, "There is no failover: both sites are down.", [
          "What must the provider prove before you reconnect, and who signs it off at the bank?",
        ]),
        active(ORC, "The provider filed under NIS2.", [
          "Does the bank also file under NIS2? What is next on the DORA timeline?",
        ]),
        active(EXEC, "Restoration will take days.", ["What does the board decide about the bank's own contingency and the provider's exit plan?"]),
        standby(COMMS, "Client messages are going out on the website and app."),
        standby(LEGAL, "Legal is waiting for the provider's data findings."),
      ],
      expectedActions: {
        [OPS]: [
          "Runs salary payments through the urgent payments channel in a set priority with dual control",
          "Raises stand-in limits within a risk appetite the board approves and records it",
          "Plans reconciliation to catch duplicates when the queue releases",
        ],
        [IT]: [
          "Requires written containment confirmation, indicators and an independent assessment before reconnecting",
          "Names the bank's sign-off owner for reconnection",
        ],
        [ORC]: [
          "Confirms DORA applies as the sector-specific act, so the bank reports under DORA, not NIS2 Art. 23",
          "Plans the intermediate report within 72 hours of the initial notification",
        ],
        [EXEC]: ["Approves contingency risk limits", "Asks for the exit plan to be reviewed against this event"],
      },
      capabilityKeys: ["RC.RP", "GV.SC", "GV.OC"],
      gradingNotes: "For a financial entity that is also essential or important under NIS2, DORA Art. 1(2) makes DORA the sector-specific act under NIS2 Art. 4. The provider reports under NIS2 in its own right. Replication of encryption to the secondary site is a reason DORA Art. 11 tests ask for switchover to redundant infrastructure.",
      clockUpdates: [{ key: CLOCKS.intermediate.key, action: "trigger" }],
    },
    {
      nodeId: "d4",
      title: "Client data left the provider",
      scenarioOffsetMin: 1560,
      plannedDelayMin: 25,
      objectiveKeys: ["privacy", "clients"],
      phase: "main",
      narrativeMd: [
        `Friday 09:05. ${PROVIDER} confirms that before encryption the attacker copied a reporting database with names, addresses, dates of birth and IBANs for about **240,000 Veldmark clients**. The attacker is demanding a ransom from the provider, not from the bank.`,
        "",
        kua(
          [
            "Salary runs went out overnight through the urgent payments channel; 14 failed and were resent by hand.",
            "Phishing texts claiming to be from Veldmark asking clients to \"verify your account\" have started.",
            "Egress from the provider's network went to 203.0.113.140 over two days.",
          ],
          ["Whether the provider will pay.", "Whether data of the other 1.6 million clients is safe."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "d4-letter",
          kind: "email",
          title: "Provider breach notice to the bank",
          from: PROVIDER,
          sentAt: "Friday 08:30",
          content:
            `**From:** Data protection officer, ${PROVIDER}\n**To:** DPO <dpo@${DOMAIN}>\n**Subject:** Personal data breach notification (processor to controller)\n\n` +
            "As your processor we inform you that on Wednesday and Thursday an unauthorized party copied a reporting database that holds personal data of your clients: name, address, date of birth and IBAN for about 240,000 data subjects. No passwords or card numbers were in this database. We will provide further detail as our investigation continues.",
        },
      ],
      teamVariants: [
        active(LEGAL, "The bank is the controller.", [
          "Do you notify the supervisory authority and clients under GDPR? When does the 72 hours run from?",
          "What do you require from the provider as processor?",
        ]),
        active(COMMS, "Phishing has started.", ["What do the 240,000 clients hear, and what does everyone else hear?"]),
        active(EXEC, "Board members ask whether the bank should help the provider pay.", [
          "What is the bank's position on the provider's ransom decision?",
        ]),
        active(ORC, "The intermediate report is due.", ["What does the intermediate report add, and what is still unknown?"]),
        standby(IT, "IT is checking for indicators linked to 203.0.113.140."),
        standby(OPS, "Operations is clearing failed payments."),
      ],
      expectedActions: {
        [LEGAL]: [
          "Records awareness at the provider's notice and notifies the supervisory authority within 72 hours",
          "Decides on client notice under Art. 34 given the phishing risk",
          "Requires processor cooperation and evidence under the contract",
        ],
        [COMMS]: [
          "Tells affected clients directly and warns all clients about phishing in plain terms",
          "Gives one number and one web page for questions",
        ],
        [EXEC]: [
          "States that the bank will not fund or encourage a payment, and that payment would not end its duties",
          "Asks the provider to share its decision and OFAC and law enforcement steps",
        ],
        [ORC]: ["Sends the intermediate report with impact figures and the data breach", "Lists what is still unknown and when the next update comes"],
      },
      capabilityKeys: ["GV.OC", "RS.CO", "GV.SC"],
      gradingNotes: "GDPR Art. 33 runs on its own clock to the data protection authority, separate from DORA reporting. Art. 33(2) requires the processor to notify the controller without undue delay. A supplier's ransom decision is its own; the bank does not fund it.",
      clockUpdates: [{ key: CLOCKS.gdpr.key, action: "trigger" }],
    },
    {
      nodeId: "d5",
      title: "Back, mostly",
      scenarioOffsetMin: 5880,
      plannedDelayMin: 25,
      objectiveKeys: ["provider", "continuity"],
      phase: "main",
      narrativeMd: [
        `Monday 09:05. Core banking came back on Sunday at 18:00. ${PROVIDER} wants to reconnect online banking today. When the payment queue released, about **2,100 duplicate payments** went out, worth EUR 3.4 million.`,
        "",
        kua(
          [
            "The provider's incident response firm sent a two page containment letter on Sunday.",
            "Complaints to the bank have reached 9,400.",
            "Two other banks on the platform have said publicly they are reviewing their contracts.",
          ],
          ["Whether the restored environment is free of the attacker.", "How many duplicates will be recovered."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(IT, "The provider wants to reconnect online banking today.", [
          "Is the containment letter enough to reconnect? What else do you need?",
        ]),
        active(OPS, "Duplicates and failed payments must be fixed.", ["How do you reverse duplicates and make clients whole?"]),
        active(ORC, "Regular activities are recovering.", ["What reporting is due now, and what starts the final report clock?"]),
        active(EXEC, "The exit plan has never been tested.", [
          `Do you stay with ${PROVIDER}, add a second provider, or exit? What do you need to decide?`,
        ]),
        standby(COMMS, "Clients are asking about compensation."),
        standby(LEGAL, "Legal is reviewing the contract."),
      ],
      expectedActions: {
        [IT]: [
          "Requires indicators, an independent assessment and monitoring before reconnecting online banking",
          "Reconnects in stages with the bank's sign-off",
        ],
        [OPS]: ["Reverses duplicates through recall requests and corrects client balances", "Waives fees caused by the outage"],
        [ORC]: [
          "Sends an updated intermediate report once regular activities are recovered",
          "Starts the final report work, with the one month clock from the latest intermediate report",
        ],
        [EXEC]: [
          "Commissions a test of the exit plan and an assessment of alternatives",
          "Updates the register of information and reports the decision timeline to the board",
        ],
      },
      capabilityKeys: ["GV.SC", "RC.RP", "GV.OC"],
      gradingNotes: "Delegated Regulation 2025/301 Art. 5 asks for an updated intermediate report when regular activities are recovered, and the final report no later than one month after the latest intermediate report. DORA Art. 28(8) requires documented, tested exit plans for providers that support critical or important functions.",
      clockUpdates: [{ key: CLOCKS.final.key, action: "trigger" }],
    },
    {
      nodeId: "d6",
      title: "The final report",
      scenarioOffsetMin: 46200,
      plannedDelayMin: 20,
      objectiveKeys: ["provider", "classify"],
      phase: "resolution",
      narrativeMd: [
        `Monday 09:05, four weeks later. ${PROVIDER}'s root cause report says the attacker entered through a remote access appliance with a stolen administrator credential and no MFA, three weeks before encryption. The final DORA report is due within days.`,
        "",
        kua(
          [
            "Total cost to the bank is estimated at EUR 11 million, including compensation and fee waivers.",
            "Online banking was fully back after five days.",
            "The competent authority has asked for the bank's ICT third-party risk assessment of the provider.",
          ],
          ["Whether the provider's remediation will be verified independently."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(ORC, "The final report needs root cause and actual impact figures.", ["What goes into the final report, and who signs it?"]),
        active(EXEC, "The authority wants the third-party risk assessment.", ["What do you decide on the provider, and what do you tell the authority?"]),
        active(IT, "DORA requires yearly continuity tests.", ["What will next year's test include that this year's did not?"]),
        active(LEGAL, "Contract remedies are on the table.", ["What do you claim from the provider, and what changes in the contract?"]),
        active(COMMS, "Clients and staff want to know what changes.", ["What do you say about the cause and the changes?"]),
        active(OPS, "Contingency channels were stretched.", ["What changes in contingency capacity and limits?"]),
      ],
      expectedActions: {
        [ORC]: ["Sends the final report with root cause, actual impact and measures", "Takes management body sign-off"],
        [EXEC]: ["Decides on exit, dual provider or stay with conditions, with a timeline", "Gives the authority the risk assessment and the decision"],
        [IT]: ["Adds a switchover and provider loss scenario to the yearly test", "Tests the exit plan end to end"],
        [LEGAL]: ["Claims under the contract for losses", "Adds audit, MFA and notification terms to the contract"],
        [COMMS]: ["Explains the cause and changes plainly", "Thanks staff and clients for patience"],
        [OPS]: ["Scales the urgent payments channel and tests it under load", "Sets stand-in limits for long outages"],
      },
      capabilityKeys: ["GV.OC", "GV.SC", "ID.IM"],
      gradingNotes: "DORA Art. 11 requires yearly tests of ICT continuity plans including switchover to redundant infrastructure, and Art. 30 requires contract terms for termination, data return and transition.",
    },
  ],
  branches: [],
};
