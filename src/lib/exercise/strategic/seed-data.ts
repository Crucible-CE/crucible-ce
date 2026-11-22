// Strategic TTX library templates, written for executives: specific facts,
// what is known, unknown and assumed, named decision owners, realistic outside
// pressure. Organizations are the fictional ones from src/content/industries.
// Artifacts come from the pressure kit (src/content/pressure-artifacts).
//
// Expected actions are observable behaviors, two to four per active team.
// They live in the inject secret and are never shown to players.

import { getPressureArtifact, renderPressureArtifact } from "@/lib/exercise/content/pressure-artifacts";

export interface SeedArtifact {
  id: string;
  kind: "email" | "social_post" | "news" | "ransom_note" | "regulator_letter" | "chat" | "voicemail" | "document" | "log_excerpt";
  title: string;
  content: string;
  from?: string;
  sentAt?: string;
}

export interface SeedVariant {
  team: string;
  status: "active" | "standby";
  narrativeMd: string;
  questions: Array<{ key: string; text: string }>;
}

export interface SeedInject {
  nodeId: string;
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  objectiveKeys: string[];
  phase: "opening" | "main" | "resolution";
  narrativeMd: string;
  artifacts: SeedArtifact[];
  teamVariants: SeedVariant[];
  expectedActions: Record<string, string[]>;
  capabilityKeys: string[];
  mitreTags?: string[];
  gradingNotes?: string;
  clockUpdates?: Array<{ key: string; action: "trigger" | "met" }>;
}

export interface SeedBranch {
  from: string;
  to: string;
  condition: Record<string, unknown>;
  priority: number;
}

export interface StrategicSeedTemplate {
  id: string;
  title: string;
  summary: string;
  /** Library collection label. Unset for the core library. */
  collection?: string;
  branching: "linear" | "branched";
  config: Record<string, unknown>;
  objectives: Array<{ key: string; text: string; capabilityKeys: string[] }>;
  injects: SeedInject[];
  branches: SeedBranch[];
}

/** A pressure kit artifact rendered for one template. */
function kit(key: string, id: string, vars: { orgName: string; incidentSummary: string; time: string } & Record<string, string>, title?: string): SeedArtifact {
  const a = getPressureArtifact(key);
  if (!a) throw new Error(`Unknown pressure artifact: ${key}`);
  return {
    id,
    kind: a.kind,
    title: title ?? a.title,
    content: renderPressureArtifact(a.template, vars),
    ...(a.from ? { from: a.from } : {}),
    sentAt: vars.time,
  };
}

const standby = (team: string, narrativeMd: string): SeedVariant => ({ team, status: "standby", narrativeMd, questions: [] });
const active = (team: string, narrativeMd: string, questions: string[]): SeedVariant => ({
  team,
  status: "active",
  narrativeMd,
  questions: questions.map((text, i) => ({ key: `q${i + 1}`, text })),
});

const TEAMS = ["Executive", "Legal", "Communications", "IT and Security", "Operations"];

// ---------------------------------------------------------------------------
// 1. OT and IT ransomware at a regional utility (linear)
// ---------------------------------------------------------------------------

const GRID = "GridStone Energy Holdings";
const GRID_INCIDENT = "a ransomware attack on its corporate network";

const utility: StrategicSeedTemplate = {
  id: "lib-strategic-utility-ransomware",
  title: "OT and IT ransomware at a regional utility",
  summary:
    "A ransomware affiliate encrypts the corporate network of an electric utility and may have reached the boundary to grid operations. Teams decide on OT isolation, regulatory notices, public communication and whether to pay.",
  branching: "linear",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "OT and IT ransomware at a regional utility",
      domain: "cyber",
      crisisType: "Critical Infrastructure Attack",
      threatActorKey: "akira",
      replayKey: "colonial-pipeline-2021",
      industryKey: "energy",
      complexity: "intermediate",
    },
    winCondition: "none",
    teams: TEAMS,
    scenarioAnchor: { weekday: 2, time: "05:20" },
    targetDurationMin: 120,
    regulatoryClocks: [
      { key: "nerc_cip_008", label: "NERC CIP-008 initial notice to E-ISAC and CISA", durationHours: 1 },
      { key: "nerc_cip_008_attempt", label: "NERC CIP-008 notice of an attempted compromise", durationHours: 24 },
      { key: "doe_oe417_6h", label: "DOE OE-417 normal report", durationHours: 6 },
      { key: "doe_oe417_1h", label: "DOE OE-417 emergency alert", durationHours: 1 },
      { key: "insurer_notice", label: "Cyber insurer notice", durationHours: 48 },
      { key: "sec_8k", label: "SEC Form 8-K Item 1.05", businessDays: 4 },
      { key: "state_ag", label: "State attorney general notice", durationHours: 720 },
    ],
    executiveBriefMd: [
      `${GRID} generates and distributes power for about 1.2 million customers across three states. It is publicly traded.`,
      "",
      "Corporate IT (email, billing, ERP, service desk) is separate from the operational technology (OT) network that runs generation and substations. One jump server at the boundary lets engineers reach OT remotely.",
      "",
      "You play the company's leadership and response teams. Answer as you would in a real event: decide, name who owns each decision, and say what you do not know yet.",
    ].join("\n"),
  },
  objectives: [
    { key: "command", text: "Establish incident command and decision authority within the first hour.", capabilityKeys: ["GV.RR", "RS.MA"] },
    { key: "ot", text: "Decide on separating IT and OT with safety and reliability weighed and the decision recorded.", capabilityKeys: ["RS.MI", "PR.IR"] },
    { key: "notify", text: "Meet regulatory, insurer and contractual notice duties on time.", capabilityKeys: ["RS.CO", "GV.OC"] },
    { key: "comms", text: "Keep customers, employees and the board informed with accurate and consistent messages.", capabilityKeys: ["RS.CO", "RC.CO"] },
    { key: "recover", text: "Make a documented ransom and recovery decision and set restore priorities.", capabilityKeys: ["RC.RP", "GV.RM"] },
  ],
  injects: [
    {
      nodeId: "u1",
      title: "Ransom notes on corporate servers",
      scenarioOffsetMin: 0,
      plannedDelayMin: 15,
      objectiveKeys: ["command", "ot"],
      phase: "opening",
      narrativeMd: [
        "At 05:22 on Tuesday the network operations center sees ransom notes on 47 Windows servers in the corporate network. Email, the billing system, the ERP and the service desk are down. Two of three domain controllers are encrypted. The third, at the backup site, still answers.",
        "",
        "**Known**",
        "- The note demands contact within 72 hours and claims 2.3 TB of stolen data, including customer records and grid diagrams.",
        "- VPN logs show logins overnight from an account that belongs to a contractor whose engagement ended in August.",
        "",
        "**Unknown**",
        "- Whether the attacker reached the OT network. It is separate from corporate IT but connects through one jump server.",
        "- Whether the data claim is true.",
        "- When the contractor account was first used. The VPN concentrator keeps only 7 days of logs.",
        "",
        "**Assumed**",
        "- Grid control systems are running normally. Control room operators report nothing unusual so far.",
      ].join("\n"),
      artifacts: [
        kit("ransom-note", "u1-note", { orgName: GRID, incidentSummary: GRID_INCIDENT, time: "Tue 05:22" }),
        {
          id: "u1-vpn",
          kind: "log_excerpt",
          title: "VPN concentrator log, overnight",
          content: [
            "Tue 01:47:12 vpn-gw01 auth success user=ctr.hollis src=203.0.113.47 mfa=not_enrolled",
            "Tue 01:47:15 vpn-gw01 session start user=ctr.hollis assigned=10.40.12.88",
            "Tue 03:12:40 vpn-gw01 auth success user=ctr.hollis src=203.0.113.47 mfa=not_enrolled",
            "Tue 05:31:02 vpn-gw01 session active user=ctr.hollis duration=03:43:47",
          ].join("\n"),
          from: "IT and Security",
          sentAt: "Tue 05:35",
        },
      ],
      teamVariants: [
        active("Executive", "The chief executive wants a call at 06:30. The chief operating officer asks who is in charge and whether the company should cut the link between corporate IT and OT now.", [
          "Who leads the response, and what authority do they have from this moment?",
          "Do you cut the connection between corporate IT and the OT network now, knowing it removes remote engineering access? Who makes that call, and by when?",
        ]),
        active("IT and Security", "The contractor account is still active. Your incident response retainer firm can have analysts on a call in 40 minutes. There is no endpoint detection on the OT jump server.", [
          "What are your first three containment actions, in order?",
          "What evidence do you preserve before anything is restored or rebuilt?",
        ]),
        active("Operations", "Grid operators are running normally. Field crews depend on corporate email and on the outage management system, which runs on corporate servers.", [
          "How do operations continue if corporate systems stay down for a week?",
          "What do you need to know before you would agree to isolate OT from corporate IT?",
        ]),
        standby("Legal", "You were paged at 05:40. No decision is needed from you yet. Start a list of notices that may apply."),
        standby("Communications", "Customer calls are rising because the billing portal is down. Be ready to draft a holding line if asked."),
      ],
      expectedActions: {
        Executive: [
          "Names an incident commander and states their decision authority",
          "Makes or schedules the IT and OT separation decision with a named owner and a time",
          "Activates the crisis management team and sets a briefing schedule",
        ],
        "IT and Security": [
          "Disables the contractor VPN account",
          "Resets privileged credentials, starting with domain administrator accounts",
          "Isolates the surviving domain controller and checks it for compromise before relying on it",
          "Engages the incident response retainer",
          "Preserves logs, memory and disk images before rebuilding",
          "Checks the OT jump server for signs of access",
        ],
        Operations: [
          "Moves work that depends on corporate IT to manual or local procedures",
          "States the conditions under which operations would accept OT isolation",
        ],
      },
      capabilityKeys: ["GV.RR", "RS.MA", "RS.MI"],
      mitreTags: ["T1078", "T1133", "T1486"],
      clockUpdates: [{ key: "insurer_notice", action: "trigger" }],
    },
    {
      nodeId: "u2",
      title: "Activity on the OT jump server",
      scenarioOffsetMin: 75,
      plannedDelayMin: 15,
      objectiveKeys: ["ot", "notify"],
      phase: "main",
      narrativeMd: [
        "IT and Security finds remote desktop sessions from the corporate network to the OT jump server between 04:50 and 05:15, before encryption started. The sessions used a shared local administrator account.",
        "",
        "From the jump server someone could reach the SCADA historian, four turbine control workstations and an engineering workstation with PLC programming software.",
        "",
        "**Known**",
        "- No encryption is seen on OT systems.",
        "- The jump server is still connected.",
        "",
        "**Unknown**",
        "- Whether tools were staged in OT. There is no endpoint detection in OT, so nobody can rule it out today.",
        "",
        "**Options from the plant manager**",
        "- Keep generating with the jump server unplugged and the Ridgeline plant in local control.",
        "- Take Ridgeline unit 2 offline as a precaution. The balancing authority says it can cover the 640 MW with imports for 24 hours at about $1.1 million per day.",
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active("Executive", "The plant manager and the chief operating officer disagree. One wants to keep generating in local control, the other wants unit 2 offline until OT is checked.", [
          "Do you keep Ridgeline unit 2 running, take it offline, or something else? Who decides, and what would change your mind?",
          "What do you tell the board chair tonight about the OT risk?",
        ]),
        active("Operations", "Operators can run Ridgeline in local control for several days. Two substations in the north district still rely on remote switching through systems that touch the boundary.", [
          "What is your safe operating state for the next 24 hours, and who confirms it?",
          "What do you need from the balancing authority before any change in output?",
        ]),
        active("IT and Security", "Your retainer firm has no OT specialists on the team that joined. The OT vendor can send an engineer by 14:00.", [
          "How do you check OT for staged tools without disrupting operations?",
          "What do you do with the shared administrator account and the jump server now?",
        ]),
        active("Legal", "The jump server is an Intermediate System, which makes it an EACMS under NERC CIP. Under CIP-008, compromise or disruption of an ESP, an EACMS or a BES Cyber System is a Reportable Cyber Security Incident: initial notice to E-ISAC and CISA is due within 1 hour of that determination. An attempt to compromise is due by the end of the next calendar day. DOE Form OE-417 is due within 1 hour if operations are interrupted, or 6 hours for a potential reliability impact.", [
          "Is this a Reportable Cyber Security Incident or an attempt under CIP-008? Who determines it, and when does the clock start?",
          "Does OE-417 apply, and on which deadline?",
        ]),
        standby("Communications", "Nothing is public yet. A local reporter follows the utility's outage map, which shows no change."),
      ],
      expectedActions: {
        Executive: [
          "Makes the generation decision with operations and names who owns it",
          "Asks for the safety and reliability impact before deciding",
          "Records the decision and the reasons in the decision log",
        ],
        Operations: [
          "Puts affected plants and substations in local control or a defined safe state",
          "Coordinates with the balancing authority before any change in output",
        ],
        "IT and Security": [
          "Disconnects the jump server from the network while keeping it powered on for forensics",
          "Disables the shared administrator account",
          "Brings in OT incident response expertise to examine OT hosts",
        ],
        Legal: [
          "Makes the CIP-008 determination with a named owner, treating the jump server as an EACMS",
          "Sends or schedules the E-ISAC and CISA initial notice within 1 hour of the determination",
          "Decides whether DOE OE-417 applies and on which deadline",
          "Advises on preserving OT evidence under privilege",
        ],
      },
      capabilityKeys: ["RS.MI", "PR.IR", "RS.CO"],
      mitreTags: ["T1021.001", "T1078"],
      gradingNotes: "Neither keeping the unit running nor taking it offline is wrong. Rate the decision process: safety input, a named owner, and a recorded rationale.",
      clockUpdates: [
        { key: "nerc_cip_008", action: "trigger" },
        { key: "doe_oe417_6h", action: "trigger" },
      ],
    },
    {
      nodeId: "u3",
      title: "Notices and the materiality question",
      scenarioOffsetMin: 300,
      plannedDelayMin: 15,
      objectiveKeys: ["notify"],
      phase: "main",
      narrativeMd: [
        "It is 10:20. Outside counsel joined at 08:00. The attacker posted 20 customer records on its leak site as proof. IT and Security matched them to real accounts: names, service addresses, account numbers and the last four digits of Social Security numbers.",
        "",
        "**Known**",
        "- Customer personal data was taken. The volume is unknown.",
        "- The state public utility commission heard about the outage from a field supervisor and wants a briefing by 16:00.",
        "- The FBI field office left a voicemail.",
        "",
        "**Unknown**",
        "- How many customers are affected and in which states.",
        "- The total cost. Early estimates range from $8 million to $30 million.",
      ].join("\n"),
      artifacts: [
        kit("fbi-voicemail", "u3-fbi", { orgName: GRID, incidentSummary: "ransomware activity reported by other utilities this month", time: "Tue 09:58" }),
        kit("breach-coach-notes", "u3-counsel", { orgName: GRID, incidentSummary: GRID_INCIDENT, time: "Tue 08:40" }),
      ],
      teamVariants: [
        active("Legal", "You own the notice list. The commission, E-ISAC, CISA, the insurer, the state attorney general and possibly the SEC all have different triggers and deadlines.", [
          "List each notice, its deadline and its owner. Which goes out first?",
          "Who directs the forensic firm, and how do you protect privilege?",
        ]),
        active("Executive", "The chief financial officer asks whether this is material for SEC purposes. The disclosure committee has not met.", [
          "How and when will the company determine materiality, and who is in that meeting?",
          "Do you call the FBI back? Who is the single point of contact for law enforcement?",
        ]),
        active("IT and Security", "Regulators and counsel are asking for scope. Your facts are partial.", [
          "What can you state as confirmed fact today, and what is still an estimate?",
        ]),
        standby("Communications", "Legal will need your help with customer notices later. No public statement yet."),
        standby("Operations", "Manual billing is being set up. Plants are stable in local control."),
      ],
      expectedActions: {
        Legal: [
          "Builds a notice list with a deadline and an owner for each regulator",
          "Engages outside counsel to direct the forensic work under privilege",
          "Sends or schedules the insurer notice",
        ],
        Executive: [
          "Convenes the materiality assessment with the CFO, general counsel and disclosure committee and sets a time",
          "Decides on law enforcement contact and names one point of contact",
        ],
        "IT and Security": [
          "Gives a written scope statement that separates confirmed facts from estimates",
          "Validates the leaked sample against company records",
        ],
      },
      capabilityKeys: ["RS.CO", "GV.OC", "RS.AN"],
      clockUpdates: [{ key: "state_ag", action: "trigger" }],
    },
    {
      nodeId: "u4",
      title: "The story breaks and the board calls",
      scenarioOffsetMin: 540,
      plannedDelayMin: 12,
      objectiveKeys: ["comms"],
      phase: "main",
      narrativeMd: [
        `At 14:30 a local TV station reports that sources confirm a cyberattack at ${GRID} and that customers may face rolling outages. The clip spreads on social media. The call center has a 45 minute wait.`,
        "",
        "There are no outages. The rumor is false, but the company has said nothing in public yet.",
        "",
        "A national reporter has emailed the chief executive. The board chair wants a call in two hours.",
      ].join("\n"),
      artifacts: [
        kit("reporter-email", "u4-reporter", { orgName: GRID, incidentSummary: "a ransomware attack that may affect power delivery", time: "Tue 14:41" }),
        kit("board-chair-text", "u4-board", { orgName: GRID, incidentSummary: GRID_INCIDENT, time: "Tue 14:52" }),
        kit("employee-chat-leak", "u4-chat", { orgName: GRID, incidentSummary: GRID_INCIDENT, time: "Tue 14:35" }, "Employee channel"),
      ],
      teamVariants: [
        active("Communications", "You have a draft holding statement from this morning that nobody approved.", [
          "What does the public statement say, and what does it not say? When does it go out?",
          "Who speaks for the company, and what do employees and call center staff hear first?",
        ]),
        active("Executive", "The board chair wants facts, the decisions you have made, and the decisions you need from the board.", [
          "What goes in the board briefing, and which decisions need board approval?",
        ]),
        active("Legal", "The reporter asks whether customer data was stolen and whether the company will pay.", [
          "What can the company say about data and payment today without creating legal exposure or misleading anyone?",
        ]),
        standby("IT and Security", "Containment is holding. No new encryption since 07:00."),
        standby("Operations", "Plants stable. Field crews are being asked by customers about outages."),
      ],
      expectedActions: {
        Communications: [
          "Issues a holding statement that says what is known and when the next update comes",
          "Names one spokesperson and routes all media questions to them",
          "Briefs employees and call center staff with approved lines",
        ],
        Executive: [
          "Prepares a board briefing with facts, decisions taken and decisions needed",
          "Agrees which decisions require board approval, including any payment",
        ],
        Legal: [
          "Reviews public statements for accuracy and avoids speculation on attribution or data",
          "Aligns the timing of public statements with regulator notices",
        ],
      },
      capabilityKeys: ["RS.CO", "RC.CO"],
    },
    {
      nodeId: "u5",
      title: "Pay or rebuild",
      scenarioOffsetMin: 4320,
      plannedDelayMin: 18,
      objectiveKeys: ["recover"],
      phase: "main",
      narrativeMd: [
        "It is Friday morning, 72 hours in. The attacker's deadline is today at 17:00.",
        "",
        "**Known**",
        "- Offline backups work for 31 of the 47 encrypted servers. The 16 without usable backups include the billing database.",
        "- Restoring without paying: critical services in 7 to 10 days, everything in 3 to 4 weeks.",
        "- The attacker claims its decryptor restores everything in 3 to 5 days. Decryptors from this group have been slow and incomplete for other victims.",
        "- The attacker posted 50 more customer records.",
        "- The FBI advises against paying but says the decision is yours. Outside counsel finds the group is not on the OFAC sanctions list today.",
        "- The insurer covers up to $5 million after a $500,000 retention and requires written consent before any payment.",
        "- The CFO estimates downtime at $2.1 million per week in lost revenue and overtime.",
        "",
        "The chief executive asks the room: do we pay?",
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active("Executive", "The demand is $4.8 million in cryptocurrency. The board meets at 13:00.", [
          "Do you pay, negotiate for time, or refuse? Who approves, and what is the reasoning you will defend later?",
        ]),
        active("Legal", "Payment raises sanctions, insurance and disclosure questions.", [
          "What must be true, and documented, before any payment could be made?",
        ]),
        active("IT and Security", "Your team can restore critical systems from backup, but only after the access path is confirmed closed.", [
          "Would a decryptor help, and what would it not fix? Is the way in closed?",
        ]),
        active("Operations", "Manual billing covers about 60 percent of accounts. Overtime is rising.", [
          "In what order do you restore systems, and why?",
        ]),
        standby("Communications", "Reporters are asking whether the company will pay. You have no answer yet."),
      ],
      expectedActions: {
        Executive: [
          "Makes a payment decision with the reasons recorded and the approver named",
          "Compares the full cost and time of both paths before deciding",
        ],
        Legal: [
          "Completes and documents a sanctions screening before any payment",
          "Gets insurer consent and checks reporting duties tied to a payment",
        ],
        "IT and Security": [
          "Assesses whether a decryptor would work and what it would not fix",
          "Confirms the initial access path is closed before restoring",
        ],
        Operations: ["Sets restore priorities with safety and reliability systems first, then customer billing"],
      },
      capabilityKeys: ["RC.RP", "GV.RM"],
      gradingNotes: "There is no right answer on payment. Rate whether the decision was informed, owned and documented.",
    },
    {
      nodeId: "u6",
      title: "Recovery and what changes",
      scenarioOffsetMin: 14400,
      plannedDelayMin: 15,
      objectiveKeys: ["recover", "notify", "comms"],
      phase: "resolution",
      narrativeMd: [
        "Ten days later most services are back. Billing returned yesterday after a manual catch up.",
        "",
        "The forensic report confirms the attacker entered through the former contractor's VPN account, which had no multifactor authentication, 19 days before encryption. About 410,000 customer records were taken.",
        "",
        "The NERC regional entity has asked for a full incident report. The state commission has scheduled a public hearing in six weeks. Customer notices are due.",
      ].join("\n"),
      artifacts: [kit("regulator-letter", "u6-ag", { orgName: GRID, incidentSummary: "a data security incident affecting customer records", time: "Fri, ten days after discovery" })],
      teamVariants: [
        active("Executive", "The board wants a plan, not an apology.", ["What will the company change, who owns each change, and how will the board track it?"]),
        active("Legal", "Several notice deadlines are still open.", ["Which notices are still due, and who owns each one?"]),
        active("Communications", "Customers will receive letters next week.", ["How do you communicate with customers and the commission through recovery?"]),
        active("IT and Security", "The root cause is clear.", ["What fixes address the root cause, and in what order?"]),
        active("Operations", "Manual procedures held, with gaps.", ["What do you change in manual operations based on what worked and what did not?"]),
      ],
      expectedActions: {
        Executive: ["Commits to specific improvements with owners and dates", "Sets how progress will be reported to the board"],
        Legal: ["Lists remaining notices and deadlines with owners"],
        Communications: ["Plans customer and regulator communication for the recovery phase"],
        "IT and Security": ["Names fixes for the root cause such as multifactor authentication on remote access, contractor offboarding and OT monitoring"],
        Operations: ["Updates manual operations procedures based on what worked and what did not"],
      },
      capabilityKeys: ["RC.RP", "RC.CO", "ID.IM"],
    },
  ],
  branches: [],
};

// ---------------------------------------------------------------------------
// 2. Customer data breach at a fintech (branched)
// ---------------------------------------------------------------------------

const MERCURY = "Mercury Ledger Financial";
const MERCURY_INCIDENT = "a breach of customer account data";

const fintech: StrategicSeedTemplate = {
  id: "lib-strategic-fintech-breach",
  title: "Customer data breach at a fintech",
  summary:
    "A leaked cloud key lets an attacker copy customer records from a payments company's data warehouse. Teams scope the breach, face extortion and fraud, and meet regulator, partner bank and customer duties. The story breaks early when communications falls behind.",
  branching: "branched",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "Customer data breach at a fintech",
      domain: "cyber",
      crisisType: "Data Breach / Exfiltration",
      threatActorKey: null,
      replayKey: "snowflake-2024",
      industryKey: "fintech",
      complexity: "intermediate",
    },
    winCondition: "none",
    teams: TEAMS,
    scenarioAnchor: { weekday: 4, time: "14:10" },
    targetDurationMin: 105,
    regulatoryClocks: [
      { key: "nydfs_72h", label: "NYDFS incident notice", durationHours: 72 },
      { key: "gdpr_72h", label: "GDPR supervisory authority notice", durationHours: 72 },
      { key: "insurer_notice", label: "Cyber insurer notice", durationHours: 48 },
      { key: "state_ag", label: "State attorney general notice", durationHours: 720 },
    ],
    executiveBriefMd: [
      `${MERCURY} runs consumer and merchant payments for about 4 million customers in the United States and the European Union. A sponsor bank holds customer funds under contract.`,
      "",
      "Card data sits in a separate tokenization vault. Customer profiles, linked bank accounts and analytics live in a cloud data warehouse.",
      "",
      "You play the company's leadership and response teams. Decide, name who owns each decision, and say what you do not know yet.",
    ].join("\n"),
  },
  objectives: [
    { key: "scope", text: "Establish the scope of the breach and separate facts from estimates.", capabilityKeys: ["RS.AN", "DE.AE"] },
    { key: "notify", text: "Meet regulator, partner bank and customer notice duties on time.", capabilityKeys: ["RS.CO", "GV.OC"] },
    { key: "comms", text: "Communicate with customers and the media before others set the story.", capabilityKeys: ["RS.CO", "RC.CO"] },
    { key: "fraud", text: "Protect customers from fraud that follows the breach.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "extortion", text: "Make a documented decision on the extortion demand.", capabilityKeys: ["GV.RM", "GV.RR"] },
  ],
  injects: [
    {
      nodeId: "f1",
      title: "Unusual export from the data warehouse",
      scenarioOffsetMin: 0,
      plannedDelayMin: 15,
      objectiveKeys: ["scope"],
      phase: "opening",
      narrativeMd: [
        "At 14:10 on Thursday a security researcher emails the security team. A key for a cloud service account that can read the customer data warehouse has been in a public code repository for nine days.",
        "",
        "The team checks the warehouse logs. Between 02:05 and 03:40 on Tuesday the account ran large exports to a storage location outside the company.",
        "",
        "**Known**",
        "- The key is real and still works.",
        "- About 1.4 million rows were exported from tables that hold customer profiles and linked bank accounts.",
        "",
        "**Unknown**",
        "- Which fields were in the export, and whether anything else was accessed.",
        "- Who pushed the key to the repository.",
        "",
        "**Assumed**",
        "- The card vault is not affected. It uses separate credentials.",
      ].join("\n"),
      artifacts: [
        {
          id: "f1-researcher",
          kind: "email",
          title: "Researcher report",
          content: [
            "**From:** Ana Kowalczyk <ana@kowalczyk-research.example>",
            "**To:** security@mercuryledgerfinancial.example",
            "**Sent:** Thu 13:52",
            "**Subject:** Exposed cloud credential in public repository",
            "",
            "Hello,",
            "",
            "While scanning public repositories I found what looks like a service account key for your cloud data warehouse. It was committed nine days ago in a repository named analytics-dash-sandbox. I have not used the key.",
            "",
            "I follow a 90 day disclosure policy and would like to confirm you have received this.",
            "",
            "Ana Kowalczyk",
          ].join("\n"),
          from: "Independent security researcher",
          sentAt: "Thu 13:52",
        },
        {
          id: "f1-logs",
          kind: "log_excerpt",
          title: "Warehouse query log, Tuesday",
          content: [
            "Tue 02:05:11 principal=svc-analytics-ro@ export table=customer_profile rows=1,402,118 dest=external-bucket-7f3a",
            "Tue 02:41:57 principal=svc-analytics-ro@ export table=linked_bank_accounts rows=211,560 dest=external-bucket-7f3a",
            "Tue 03:38:04 principal=svc-analytics-ro@ export table=kyc_documents_index rows=0 error=permission_denied",
          ].join("\n"),
          from: "IT and Security",
          sentAt: "Thu 14:35",
        },
      ],
      teamVariants: [
        active("IT and Security", "The key still works. The analytics team says three dashboards break if you revoke it.", [
          "What do you do with the key and the account in the next hour?",
          "How do you establish exactly what was exported, and how fast?",
        ]),
        active("Executive", "The chief technology officer briefs you at 14:45. Nobody has called this a breach yet.", [
          "Who leads, and when do you call this an incident that triggers the response plan?",
        ]),
        active("Legal", "Several notice clocks may start from discovery or from determination, depending on the regulator.", [
          "When did the company discover this, for notice purposes, and what do you do now to protect the investigation?",
        ]),
        standby("Communications", "Nothing is public. The researcher is waiting for a reply."),
        standby("Operations", "Fraud operations and customer support are running normally."),
      ],
      expectedActions: {
        "IT and Security": [
          "Revokes the exposed key despite the dashboard impact",
          "Rotates related credentials and checks other warehouse accounts for missing MFA or network allow lists",
          "Preserves warehouse query and access logs",
          "Starts a scoped review of the exported fields",
          "Replies to the researcher and asks them to keep the report confidential",
        ],
        Executive: ["Declares an incident", "Names an incident lead", "Sets a decision schedule for the next 24 hours"],
        Legal: ["Records the discovery time", "Engages outside counsel", "Starts a legal hold on relevant logs and messages"],
      },
      capabilityKeys: ["DE.AE", "RS.MA", "RS.AN"],
      mitreTags: ["T1593.003", "T1552.001", "T1078.004", "T1530", "T1537"],
      clockUpdates: [{ key: "insurer_notice", action: "trigger" }],
    },
    {
      nodeId: "f2",
      title: "Scope confirmed and an extortion email",
      scenarioOffsetMin: 360,
      plannedDelayMin: 15,
      objectiveKeys: ["scope", "notify", "comms"],
      phase: "main",
      narrativeMd: [
        "By 20:10 the forensic firm confirms the export.",
        "",
        "**Known**",
        "- 1.4 million customers: names, emails, phone numbers, home addresses and dates of birth.",
        "- About 600,000 of them also had the last four digits of a Social Security number.",
        "- 211,000 linked bank account and routing numbers.",
        "- 38,000 of the customers live in the European Union.",
        "- No card data and no passwords.",
        "",
        "An email arrived at the press inbox: the sender claims to hold the data and demands $3 million in five days to delete it.",
        "",
        "**Unknown**",
        "- Whether the sender really holds the data or saw the same public key.",
      ].join("\n"),
      artifacts: [
        {
          id: "f2-extortion",
          kind: "email",
          title: "Extortion email",
          content: [
            "**From:** ledgerleaks@protonmail.example",
            "**To:** press@mercuryledgerfinancial.example",
            "**Sent:** Thu 19:44",
            "**Subject:** your customers",
            "",
            `We have 1.4 million ${MERCURY} customer records including bank accounts. Sample attached (10 rows).`,
            "",
            "Pay 3,000,000 USD in five days and we delete everything. If not, we sell it and we send a copy to every journalist covering fintech.",
            "",
            "Do not involve police.",
          ].join("\n"),
          from: "Unknown sender",
          sentAt: "Thu 19:44",
        },
      ],
      teamVariants: [
        active("Communications", "Customers do not know yet. The extortion email hit the press inbox, so several staff have seen it.", [
          "Do you notify customers before you have every fact, or wait? What do you tell staff tonight?",
          "Draft the first two sentences of the holding statement.",
        ]),
        active("Legal", "NYDFS, EU supervisory authorities, state attorneys general and the sponsor bank all have different duties.", [
          "Which notices does this scope trigger, and which deadlines run first?",
        ]),
        active("Executive", "The sponsor bank's contract requires notice within 24 hours of a confirmed incident affecting its customers.", [
          "Who calls the sponsor bank, and what do they say?",
          "How do you respond to the extortion email for now?",
        ]),
        active("IT and Security", "The sample in the email matches real rows.", [
          "What can you tell regulators as confirmed fact, and what remains open?",
        ]),
        active("Operations", "Linked bank account numbers can be used for ACH fraud.", [
          "What fraud controls do you change tonight for the affected accounts?",
        ]),
      ],
      expectedActions: {
        Communications: [
          "Recommends a customer notice plan with timing tied to confirmed facts",
          "Gives staff a short internal message with a no comment instruction and a contact",
          "Prepares a holding statement that says what is known and what customers should do",
        ],
        Legal: [
          "Maps each notice to its trigger, deadline and owner, including NYDFS and the EU lead authority",
          "Treats the extortion email as evidence and advises on law enforcement contact",
        ],
        Executive: ["Calls the sponsor bank within its contractual window and names the caller", "Decides not to engage the extortionist until legal and law enforcement advise"],
        "IT and Security": ["Gives a written scope statement with confirmed facts and open questions"],
        Operations: ["Raises fraud monitoring and adds friction to changes on affected linked accounts"],
      },
      capabilityKeys: ["RS.AN", "RS.CO", "RS.MI"],
      clockUpdates: [
        { key: "nydfs_72h", action: "trigger" },
        { key: "gdpr_72h", action: "trigger" },
        { key: "state_ag", action: "trigger" },
      ],
    },
    {
      nodeId: "f3a",
      title: "A reporter calls before you announce",
      scenarioOffsetMin: 1200,
      plannedDelayMin: 12,
      objectiveKeys: ["comms"],
      phase: "main",
      narrativeMd: [
        "It is 10:10 on Friday. A reporter emails the press team. She has the ten row sample from the extortion email and asks for comment before publishing this afternoon.",
        "",
        "Your customer notice and holding statement are drafted but not yet sent. You still control the timing, for about three hours.",
      ].join("\n"),
      artifacts: [kit("reporter-email", "f3a-reporter", { orgName: MERCURY, incidentSummary: "a breach of customer and bank account data", time: "Fri 10:10" })],
      teamVariants: [
        active("Communications", "The reporter's deadline is 13:00.", [
          "Do you publish your own statement before her story? What is the order of customers, staff, partners and media?",
        ]),
        active("Executive", "The chief executive could give a short interview or decline.", ["Who speaks for the company, and do you approve the release now?"]),
        active("Legal", "Regulators should not learn this from the news.", ["Which regulators and partners must hear from you before the statement goes out?"]),
        standby("IT and Security", "Scope is unchanged."),
        standby("Operations", "Support is ready with a script once the notice goes out."),
      ],
      expectedActions: {
        Communications: ["Publishes or schedules a statement before the reporter's deadline", "Sequences notice to customers, staff and partners with the public statement"],
        Executive: ["Approves the release and names one spokesperson"],
        Legal: ["Notifies key regulators and the sponsor bank before or with the public statement"],
      },
      capabilityKeys: ["RS.CO", "RC.CO"],
    },
    {
      nodeId: "f3b",
      title: "The story breaks before you are ready",
      scenarioOffsetMin: 1200,
      plannedDelayMin: 15,
      objectiveKeys: ["comms", "fraud"],
      phase: "main",
      narrativeMd: [
        `It is 10:10 on Friday. A news site publishes a story that ${MERCURY} customer data is for sale on a criminal forum. The forum post shows the ten row sample.`,
        "",
        "Customers learn about the breach from the news. The support queue triples in an hour. A post from a customer saying the company hid a breach for days is spreading.",
        "",
        "Your customer notice is still in review.",
      ].join("\n"),
      artifacts: [
        kit("news-article", "f3b-news", { orgName: MERCURY, incidentSummary: "a breach of customer account data now offered for sale online", time: "Fri 10:10" }),
        kit("social-post", "f3b-post", { orgName: MERCURY, incidentSummary: "a hack where they stole bank account numbers", time: "Fri 10:32" }),
        kit("customer-complaint", "f3b-customer", { orgName: MERCURY, incidentSummary: MERCURY_INCIDENT, time: "Fri 10:55" }, "Merchant customer complaint"),
      ],
      teamVariants: [
        active("Communications", "Reporters and customers are asking why the company stayed silent.", [
          "What do you publish in the next 30 minutes, and how do you address the question of timing?",
        ]),
        active("Executive", "The board chair asks why the board learned this from the news.", ["What do you decide now, and what do you tell the board?"]),
        active("Legal", "Regulators will ask when you knew.", ["What do you say about the timeline, and which regulators do you call first today?"]),
        active("Operations", "Support wait times are over an hour and agents have no approved script.", ["What do support agents tell customers today, and what can customers do to protect themselves?"]),
        standby("IT and Security", "Scope is unchanged. Keep supporting the response."),
      ],
      expectedActions: {
        Communications: ["Publishes a statement within the hour that confirms the facts and tells customers what to do", "Explains the timeline without blaming staff or vendors"],
        Executive: ["Briefs the board directly and approves the public response"],
        Legal: ["Calls key regulators the same day and gives an accurate discovery timeline"],
        Operations: ["Gives support agents an approved script and adds capacity"],
      },
      capabilityKeys: ["RS.CO", "RC.CO", "RS.MI"],
    },
    {
      nodeId: "f4",
      title: "Regulators and partners ask questions",
      scenarioOffsetMin: 1800,
      plannedDelayMin: 15,
      objectiveKeys: ["notify"],
      phase: "main",
      narrativeMd: [
        "It is Friday 20:10. NYDFS has acknowledged your notice and asks for a call on Monday. The Irish data protection authority, your EU lead authority, asks for details by Tuesday. Two state attorneys general have written.",
        "",
        "The sponsor bank wants a written incident report within 24 hours and asks whether its customers' data is in the set. Its contract lets it suspend the program if it is not satisfied with your controls.",
      ].join("\n"),
      artifacts: [kit("regulator-letter", "f4-ag", { orgName: MERCURY, incidentSummary: MERCURY_INCIDENT, time: "Fri 17:30" })],
      teamVariants: [
        active("Legal", "You have four regulators and a partner bank with different questions.", [
          "Who owns each response, and what is the one source of facts every response draws from?",
        ]),
        active("Executive", "The sponsor bank relationship carries most of the company's revenue.", [
          "Who leads the sponsor bank relationship this week, and what will you commit to?",
        ]),
        active("IT and Security", "Regulators ask how the key was exposed and what changed since.", ["What remediation can you state as done, and what is still planned?"]),
        standby("Communications", "Keep messages consistent with what regulators hear."),
        standby("Operations", "Fraud attempts are up, but contained so far."),
      ],
      expectedActions: {
        Legal: ["Assigns an owner and a date to each regulator response", "Uses one agreed fact sheet for all regulator and partner responses"],
        Executive: ["Names an executive owner for the sponsor bank and commits to a reporting schedule"],
        "IT and Security": ["Separates completed remediation from planned work in the regulator update"],
      },
      capabilityKeys: ["RS.CO", "GV.OC", "GV.SC"],
      clockUpdates: [{ key: "nydfs_72h", action: "met" }],
    },
    {
      nodeId: "f5",
      title: "Extortion escalates and fraud follows",
      scenarioOffsetMin: 4320,
      plannedDelayMin: 18,
      objectiveKeys: ["extortion", "fraud"],
      phase: "main",
      narrativeMd: [
        "It is Sunday. The extortionist emails again: pay $3 million by Tuesday or the data goes to every customer by email, with a note that the company refused to protect them.",
        "",
        "Fraud operations sees account takeover attempts against affected customers rise eight times overnight. Attackers call support pretending to be customers, using dates of birth and partial Social Security numbers from the leak.",
        "",
        "**Known**",
        "- Law enforcement says the sender is linked to a group that has sold data after being paid before.",
        "- The insurer covers extortion payments only with its written consent.",
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active("Executive", "The board meets tonight.", ["Do you pay, and why? Who approves the decision?"]),
        active("Legal", "A payment raises sanctions, insurance and reporting questions.", ["What has to be checked and documented before any payment, and what reports follow one?"]),
        active("Operations", "Support agents verify identity with the same data that leaked.", ["How do you change identity verification and fraud controls today?"]),
        active("IT and Security", "Attackers may try other credentials found in the same repository.", ["What else do you check, and what do you lock down?"]),
        standby("Communications", "Prepare for the possibility that customers receive the attacker's email."),
      ],
      expectedActions: {
        Executive: ["Makes a documented payment decision with the approver named and the reasons recorded"],
        Legal: ["Completes and documents a sanctions screening and insurer consent before any payment", "Names the reports a payment would trigger"],
        Operations: ["Stops using leaked data as identity proof and moves to stronger verification", "Adds monitoring or holds on high risk account changes"],
        "IT and Security": ["Scans repositories for other exposed secrets and rotates them"],
      },
      capabilityKeys: ["GV.RM", "PR.AA", "RS.MI"],
      gradingNotes: "Paying does not guarantee deletion. Rate whether the decision was informed, owned and documented, not which option was chosen.",
    },
    {
      nodeId: "f6",
      title: "Notices, remediation and what changes",
      scenarioOffsetMin: 17280,
      plannedDelayMin: 15,
      objectiveKeys: ["notify", "fraud", "comms"],
      phase: "resolution",
      narrativeMd: [
        "Twelve days in. Customer notices are ready to send with two years of credit and identity monitoring. The sponsor bank has agreed to keep the program running if it receives monthly control updates.",
        "",
        "The root cause review found that the key was pushed by a contractor working in a sandbox repository that was public by mistake. Secret scanning was not enabled for that repository.",
        "",
        "Each team says what it will change.",
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active("Executive", "The board wants a plan with owners and dates.", ["What changes, who owns each change, and how will the board track progress?"]),
        active("Legal", "Notices to customers and the remaining regulators go out this week.", ["Which notices remain, and who owns each one?"]),
        active("Communications", "Customers receive letters on Monday.", ["How do you communicate with customers after the letters, and how will you measure trust?"]),
        active("IT and Security", "The root cause is known.", ["What fixes address the root cause, and in what order?"]),
        active("Operations", "Fraud and support processes changed under pressure.", ["Which of those changes do you keep, and which do you undo?"]),
      ],
      expectedActions: {
        Executive: ["Commits to specific improvements with owners and dates", "Sets how progress will be reported to the board and the sponsor bank"],
        Legal: ["Lists remaining notices and deadlines with owners"],
        Communications: ["Plans follow up communication for customers after the notices"],
        "IT and Security": ["Names fixes for the root cause such as secret scanning, repository visibility controls and key rotation"],
        Operations: ["Keeps stronger identity verification and documents the new fraud controls"],
      },
      capabilityKeys: ["RC.CO", "ID.IM", "PR.DS"],
    },
  ],
  branches: [
    { from: "f1", to: "f2", condition: { type: "default" }, priority: 0 },
    // Communications fell behind on the scope inject, or the teams overall did: the story breaks first.
    { from: "f2", to: "f3b", condition: { type: "team_outcome", team: "Communications", outcome: "ineffective" }, priority: 0 },
    { from: "f2", to: "f3b", condition: { type: "score_below", value: 2 }, priority: 1 },
    { from: "f2", to: "f3a", condition: { type: "default" }, priority: 2 },
    { from: "f3a", to: "f4", condition: { type: "default" }, priority: 0 },
    { from: "f3b", to: "f4", condition: { type: "default" }, priority: 0 },
    { from: "f4", to: "f5", condition: { type: "default" }, priority: 0 },
    { from: "f5", to: "f6", condition: { type: "default" }, priority: 0 },
  ],
};

export const STRATEGIC_SEED_TEMPLATES: readonly StrategicSeedTemplate[] = [utility, fintech];
