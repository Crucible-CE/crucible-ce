// Seed Crisis Sim templates: the solo practice run and two starter scenarios.
// Pure data. Every template here must pass validateTemplate with no issues
// (see crisissim-seed-data.test.ts). All organizations, people, vendors, and
// outlets are fictional.

import type { z } from "zod";
import type {
  templateConfigSchema,
  templateInjectContentSchema,
  templateInjectSecretSchema,
  TemplateObjective,
} from "@/lib/exercise/modes/crisissim/schema";

export interface SeedInject {
  title: string;
  /** Simulated minutes since T0. Strictly increasing. */
  scenarioOffsetMin: number;
  /** Real minutes to answer. Null in practice. */
  plannedDelayMin: number | null;
  /** Empty means all teams. */
  targetTeams: string[];
  objectiveKeys: string[];
  /** TemplateInject.expectedActions: 2 to 4 observable actions per team. */
  expectedActions: Array<{ team: string; actions: string[] }>;
  content: z.input<typeof templateInjectContentSchema>;
  secret: z.input<typeof templateInjectSecretSchema>;
}

export interface SeedTemplate {
  id: string;
  title: string;
  summary: string;
  /** Library collection label. Unset for the core library. */
  collection?: string;
  config: z.input<typeof templateConfigSchema>;
  objectives: TemplateObjective[];
  injects: SeedInject[];
}

export const PRACTICE_TEMPLATE_ID = "seed-crisissim-practice";
export const RANSOMWARE_TEMPLATE_ID = "seed-crisissim-ransomware";
export const THIRD_PARTY_TEMPLATE_ID = "seed-crisissim-third-party";

// ---------------------------------------------------------------------------
// Builders. Options are written once with their per-path quality, follow-up,
// and clock effects, then split into public content and hidden secret.
// ---------------------------------------------------------------------------

type ContentInput = z.input<typeof templateInjectContentSchema>;
type VariantInput = ContentInput["variants"]["optimal"];
type QuestionInput = ContentInput["questions"][number];
type DeliverableInput = NonNullable<ContentInput["deliverable"]>;
type QualityLevel = "great" | "good" | "neutral" | "bad";
interface ClockEffectInput {
  key: string;
  action: "trigger" | "met";
}

interface OptionSpec {
  id: "a" | "b" | "c" | "d";
  text: string;
  /** Quality on the optimal, degrading, and critical paths. */
  quality: [QualityLevel, QualityLevel, QualityLevel];
  followUp: string;
  /** One line on why the option is rated as it is. Shown only in the debrief. */
  rationale: string;
  /** Options only meet clocks, except sec_8k (materiality) and ransom payment clocks. */
  clocks?: ClockEffectInput[];
}

interface QuestionSpec {
  team: string;
  decisionOwner: string;
  stem: string;
  discussionPrompt: string;
  capabilityKeys: string[];
  type?: "standard" | "materiality" | "ransom";
  options: [OptionSpec, OptionSpec, OptionSpec, OptionSpec];
}

interface InjectSpec {
  title: string;
  scenarioOffsetMin: number;
  plannedDelayMin: number | null;
  objectiveKeys: string[];
  /** Clocks that start when this inject opens, on every path. */
  clockTriggers?: string[];
  /** Clocks that start when this inject opens on one path only. */
  clockTriggersByPath?: { optimal?: string[]; degrading?: string[]; critical?: string[] };
  /** 2 to 4 observable actions per team. */
  expectedActions: Array<{ team: string; actions: string[] }>;
  variants: { optimal: VariantInput; degrading: VariantInput; critical: VariantInput };
  questions: QuestionSpec[];
  deliverable?: DeliverableInput;
  deliverableCriteria?: string[];
}

/** Build one seed inject: options are written once with their per-path quality and split into content and secret. */
export function inject(spec: InjectSpec): SeedInject {
  const quality: Record<string, Record<string, { optimal: QualityLevel; degrading: QualityLevel; critical: QualityLevel }>> = {};
  const followUps: Record<string, Record<string, string>> = {};
  const rationales: Record<string, Record<string, string>> = {};
  const clockEffects: Record<string, Record<string, ClockEffectInput[]>> = {};

  const questions: QuestionInput[] = spec.questions.map((q) => {
    quality[q.team] = {};
    followUps[q.team] = {};
    rationales[q.team] = {};
    for (const o of q.options) {
      const [optimal, degrading, critical] = o.quality;
      quality[q.team][o.id] = { optimal, degrading, critical };
      followUps[q.team][o.id] = o.followUp;
      rationales[q.team][o.id] = o.rationale;
      if (o.clocks && o.clocks.length > 0) {
        clockEffects[q.team] ??= {};
        clockEffects[q.team][o.id] = o.clocks;
      }
    }
    return {
      team: q.team,
      stem: q.stem,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      decisionOwner: q.decisionOwner,
      discussionPrompt: q.discussionPrompt,
      type: q.type ?? "standard",
      capabilityKeys: q.capabilityKeys,
    };
  });

  return {
    title: spec.title,
    scenarioOffsetMin: spec.scenarioOffsetMin,
    plannedDelayMin: spec.plannedDelayMin,
    targetTeams: spec.questions.map((q) => q.team),
    objectiveKeys: spec.objectiveKeys,
    expectedActions: spec.expectedActions,
    content: {
      schemaVersion: 1,
      variants: spec.variants,
      questions,
      ...(spec.deliverable ? { deliverable: spec.deliverable } : {}),
    },
    secret: {
      schemaVersion: 1,
      quality,
      followUps,
      clockEffects,
      deliverableCriteria: spec.deliverableCriteria ?? [],
      rationales,
      clockTriggers: spec.clockTriggers ?? [],
      clockTriggersByPath: spec.clockTriggersByPath ?? {},
    },
  };
}

// ---------------------------------------------------------------------------
// Practice: ransomware outage (single player)
// ---------------------------------------------------------------------------

const RESPONSE_TEAM = "Response Team";

const PRACTICE: SeedTemplate = {
  id: PRACTICE_TEMPLATE_ID,
  title: "Practice: ransomware outage",
  summary: "Single player practice. Three decisions on a ransomware outage, from detection to recovery.",
  config: {
    schemaVersion: 1,
    teams: [RESPONSE_TEAM],
    targetDurationMin: 15,
    practice: true,
    holdAfterClose: false,
    scenarioAnchor: { weekday: 2, time: "02:14" },
    orgName: "Brightwater Payments",
    capabilityKeys: ["RS.MA", "RS.MI", "RS.CO", "RC.RP"],
    executiveBriefMd:
      "A short single player practice run. Ransomware has started encrypting a core finance database and customer payments are slowing down. " +
      "You are the Response Team. Make the call on each inject and watch how your choices move the scenario between paths. " +
      "Nothing here is real. It pages no one, starts no clocks, and does not appear in reports.",
  },
  objectives: [
    { key: "o1", text: "Contain the spread quickly and record who approved taking systems offline.", capabilityKeys: ["RS.MI", "GV.RR"] },
    { key: "o2", text: "Communicate outside the company without getting ahead of the facts.", capabilityKeys: ["RS.CO"] },
    { key: "o3", text: "Restore service safely from verified backups.", capabilityKeys: ["RC.RP"] },
  ],
  injects: [
    inject({
      title: "Detection",
      scenarioOffsetMin: 0,
      plannedDelayMin: 4,
      objectiveKeys: ["o1"],
      expectedActions: [
        {
          team: RESPONSE_TEAM,
          actions: [
            "Names an incident commander",
            "Isolates FIN-DB-02 or disables the compromised service account",
            "Records who approved taking the finance database offline and when",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "02:14. EDR raises high confidence ransomware alerts on **FIN-DB-02**, the primary finance database host. Files are being renamed in bulk and a ransom note has appeared on the file share.\n\n" +
            "The on-call analyst caught it within minutes and the telemetry is clean. Any containment step will take the finance database offline during the morning close.",
        },
        degrading: {
          narrativeMd:
            "02:14. EDR alerts on **FIN-DB-02** were noisy and arrived late, so the encryptor has had time to run. Two nearby hosts show suspicious logins from the same service account.\n\n" +
            "Scope is unclear and time is short.",
        },
        critical: {
          narrativeMd:
            "02:14. The ransomware spread beyond **FIN-DB-02** to backup infrastructure before anyone noticed. Several finance and payment systems are encrypting.\n\n" +
            "Leadership is awake and asking questions you cannot yet answer.",
        },
      },
      questions: [
        {
          team: RESPONSE_TEAM,
          decisionOwner: "Incident commander",
          stem: "FIN-DB-02 is encrypting and a service account is logging in from an unfamiliar IP address. What is your first move?",
          discussionPrompt: "Who has the authority to take a critical production system offline at 02:14, and how would you record that decision?",
          capabilityKeys: ["RS.MI", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Disable the service account and pull EDR telemetry first, then isolate once you know the scope.",
              quality: ["good", "neutral", "bad"],
              followUp: "The service account was disabled and telemetry pulled before the host was isolated.",
              rationale: "Scoping first is reasonable while the spread is small, but every minute of delay lets the encryptor reach more files.",
            },
            {
              id: "b",
              text: "Isolate FIN-DB-02 from the network now and disable the account, accepting the finance outage.",
              quality: ["great", "great", "good"],
              followUp: "FIN-DB-02 was cut off from the network and the finance database went offline.",
              rationale: "Isolation stops the spread and keeps memory evidence on the host, which is the containment step NIST SP 800-61 favors.",
            },
            {
              id: "c",
              text: "Keep the host online and watch the attacker for an hour to learn their tools before acting.",
              quality: ["bad", "bad", "bad"],
              followUp: "The host stayed online while the team watched. Encryption continued.",
              rationale: "Watching an active encryptor trades production data for intelligence you can get later from logs and disk images.",
            },
            {
              id: "d",
              text: "Suspend the VM at the hypervisor to stop encryption at once and keep its memory for forensics.",
              quality: ["good", "good", "good"],
              followUp: "The VM was suspended. Encryption stopped and its memory was kept in the suspend file.",
              rationale: "Suspending halts encryption and keeps memory for forensics, unlike a power off. It stops the host but not the compromised account.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Customers are noticing",
      scenarioOffsetMin: 90,
      plannedDelayMin: 4,
      objectiveKeys: ["o2"],
      expectedActions: [
        {
          team: RESPONSE_TEAM,
          actions: [
            "Names one spokesperson for outside questions",
            "Gets Legal to clear any statement before it goes out",
            "Gives a time for the next update",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "03:44. Containment held. Encryption has stopped and the attacker's known access is cut off. The **02:00 backup** is verified free of encryption, but it was taken only 14 minutes before encryption began, so it may still hold what the attacker left. Customer impact was brief.\n\n" +
            "A reporter has emailed the press line asking about a short outage, and Legal wants to know whether any notice deadline has started.",
          consequenceText: "The outcome is controlled, but the public question still needs a careful answer.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Reporter asks about the outage",
              from: "Jonah Pell, Coastline Business Daily",
              sentAt: "03:40",
              content:
                "**From:** Jonah Pell <jpell@coastlinedaily.example>\n**Subject:** Payments outage overnight\n\n" +
                "Hello. Several readers say Brightwater payments failed for part of the night. Can you tell me what happened and whether customer data was involved? I am filing at 09:00.",
            },
          ],
        },
        degrading: {
          narrativeMd:
            "03:44. Containment is partial. One nearby host was hit before the spread stopped. Customer payments are degraded and support tickets are climbing.\n\n" +
            "A reporter is asking about the outage and leadership wants one message.",
          consequenceText: "You are now managing a live service impact and a public story at the same time.",
        },
        critical: {
          narrativeMd:
            "03:44. Encryption reached the backups and several payment systems are down. The outage is public, customers are posting about it, and a reporter has the story.\n\n" +
            "Leadership wants answers and counsel is warning about disclosure obligations.",
          consequenceText: "Every message now lands with regulators and customers who already know something is wrong.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Customer post",
              from: "@mkeller_builds",
              content: "**@mkeller_builds**\n\nThird failed payment today with Brightwater. Their status page says everything is fine. Does anyone know what is going on?",
            },
          ],
        },
      },
      questions: [
        {
          team: RESPONSE_TEAM,
          decisionOwner: "Communications lead",
          stem: "A reporter is asking about the outage, customers are noticing, and Legal is asking about notice deadlines. How do you handle outside communication right now?",
          discussionPrompt: "What can you say truthfully right now without getting ahead of the facts or your disclosure obligations?",
          capabilityKeys: ["RS.CO"],
          options: [
            {
              id: "a",
              text: "Route every question to one spokesperson and say nothing publicly until Legal confirms scope.",
              quality: ["good", "neutral", "bad"],
              followUp: "Questions went to one spokesperson. Nothing was said publicly.",
              rationale: "One voice is right, but silence only works while the outage is small. Once customers are posting, it reads as hiding.",
            },
            {
              id: "b",
              text: "Tell the reporter the outage was routine maintenance and that no security issue is involved.",
              quality: ["bad", "bad", "bad"],
              followUp: "The company blamed routine maintenance. That claim will be hard to take back.",
              rationale: "A false statement to the press is deceptive, will surface in the investigation, and destroys trust when it does.",
            },
            {
              id: "c",
              text: "Issue a short holding statement, cleared by Legal, that names a service issue and a next update time.",
              quality: ["great", "great", "good"],
              followUp: "A short holding statement went out with a time for the next update.",
              rationale: "A short, true statement with a next update time keeps control of the story without getting ahead of the facts.",
            },
            {
              id: "d",
              text: "Publicly confirm a ransomware attack now and describe which systems were hit, to get ahead of it.",
              quality: ["bad", "neutral", "good"],
              followUp: "The company named the attack and the affected systems publicly.",
              rationale: "Confirming the attack is sound once it is public, but early system detail can be wrong and helps the attacker.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Recovery",
      scenarioOffsetMin: 360,
      plannedDelayMin: 4,
      objectiveKeys: ["o3"],
      expectedActions: [
        {
          team: RESPONSE_TEAM,
          actions: [
            "Requires integrity checks before cutover",
            "Restores data onto rebuilt hosts instead of restoring whole systems",
            "Names who signs off that recovery is safe",
            "Gives leadership a realistic time estimate",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "08:14. The attacker's access is cut off and forensics has the indicators it needs. You have a verified **02:00 backup** and a tested restore runbook. The backup predates the encryption by 14 minutes, not the intrusion.\n\n" +
            "Finance is asking when it will be back online.",
          consequenceText: "A clean recovery is close, but restoring whole systems from a backup taken after the intrusion could bring back what the attacker left.",
        },
        degrading: {
          narrativeMd:
            "08:14. Eviction took longer than planned and one backup set is suspect. You have a usable restore point, but it is a few hours old, so some recent transactions will need manual reconciliation.",
          consequenceText: "Each recovery option now trades data freshness against the risk of restoring something tainted.",
        },
        critical: {
          narrativeMd:
            "08:14. Backups were partly encrypted before the spread was contained. Recovery means rebuilding from older offsite copies and accepting real data loss.\n\n" +
            "Leadership wants a timeline you cannot promise.",
          consequenceText: "No clean option is left. Pick the least bad one, defend it, and document it.",
        },
      },
      questions: [
        {
          team: RESPONSE_TEAM,
          decisionOwner: "Incident commander",
          stem: "There is pressure to restore service. How do you approach recovery of FIN-DB-02 and the payment systems?",
          discussionPrompt: "How would you choose between restoring and rebuilding, and who signs off that recovery is safe?",
          capabilityKeys: ["RC.RP", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Rebuild affected hosts from known good images while the data restore runs, to shorten the outage.",
              quality: ["good", "good", "good"],
              followUp: "Hosts were rebuilt from known good images alongside the restore.",
              rationale: "Clean rebuilds remove persistence on the hosts. It is solid on every path but does not by itself verify the data.",
            },
            {
              id: "b",
              text: "Restore now from the most recent backup to cut downtime, and run integrity checks after cutover.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Service came back fast, with integrity checks still pending.",
              rationale: "Tolerable when the backup is already verified. When a backup set is suspect, it risks restoring the infection.",
            },
            {
              id: "c",
              text: "Bring the original host back online once an antivirus scan comes back clean, to end the outage.",
              quality: ["bad", "bad", "bad"],
              followUp: "The original host went back online after a clean scan.",
              rationale: "A clean scan does not prove a compromised host is clean. Attackers often leave persistence that scanners miss.",
            },
            {
              id: "d",
              text: "Restore only data from the checked backup onto rebuilt hosts after forensic sign off.",
              quality: ["great", "great", "good"],
              followUp: "Data from the checked backup went onto rebuilt hosts after forensic sign off.",
              rationale: "The backup postdates the intrusion. Rebuilt hosts, restored data only, and a recorded sign off keep the attacker's leftovers out.",
            },
          ],
        },
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Ransomware decision sim
// ---------------------------------------------------------------------------

const EXEC = "Executive";
const LEGAL = "Legal";
const SEC = "Security";
const COMMS = "Communications";

const HP_RANSOM_NOTE = {
  id: "a1",
  kind: "ransom_note" as const,
  title: "Ransom note",
  from: "Unknown",
  sentAt: "Monday 03:10",
  content:
    "--- RESTORE_HARBORPOINT.txt ---\n\n" +
    "Harbor Point Logistics. Your network is encrypted.\n\n" +
    "We also copied 1.2 TB of your files, including HR and customer records. If you do not contact us within 72 hours, we will publish them and send them to your customers.\n\n" +
    "Do not rename files. Do not contact the police.\n\n" +
    "Contact: [private portal link]\nYour ID: HP-4471-0C2E",
};

const RANSOMWARE: SeedTemplate = {
  id: RANSOMWARE_TEMPLATE_ID,
  title: "Ransomware decision sim",
  summary: "Four teams work a ransomware attack on a public logistics company, from detection to the SEC filing.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, LEGAL, SEC, COMMS],
    targetDurationMin: 45,
    scenarioAnchor: { weekday: 1, time: "05:40" },
    orgName: "Harbor Point Logistics",
    capabilityKeys: ["RS.MA", "RS.MI", "RS.CO", "GV.RR", "GV.OC", "RC.RP"],
    regulatoryClocks: [
      { key: "sec_8k", label: "SEC Form 8-K Item 1.05", businessDays: 4 },
      { key: "insurer_notice", label: "Cyber insurer notice", durationHours: 48 },
      { key: "state_ag", label: "State attorney general notice", durationHours: 720 },
    ],
    executiveBriefMd:
      "Harbor Point Logistics is a publicly traded freight and warehousing company with 14 distribution centers. Ransomware has hit its warehouse systems.\n\n" +
      "Over four days of simulated time, the Executive, Legal, Security, and Communications teams make decisions on containment, the ransom demand, SEC disclosure, and public communication. " +
      "Three clocks can start: the SEC 8-K filing, the cyber insurer notice, and state attorney general notice.",
  },
  objectives: [
    { key: "o1", text: "Contain the attack and keep the attacker out while restoring operations.", capabilityKeys: ["RS.MI", "RC.RP"] },
    { key: "o2", text: "Make and record the materiality determination and meet the SEC filing deadline.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "o3", text: "Decide on the ransom demand with sanctions, insurer, and law enforcement input.", capabilityKeys: ["GV.RR", "RS.MA"] },
    { key: "o4", text: "Communicate with customers, drivers, staff, and the media accurately and on time.", capabilityKeys: ["RS.CO", "RC.CO"] },
  ],
  injects: [
    inject({
      title: "Detection",
      scenarioOffsetMin: 0,
      plannedDelayMin: 7,
      objectiveKeys: ["o1", "o3"],
      clockTriggers: ["insurer_notice"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Isolates the affected network segments",
            "Disables the compromised domain admin account",
            "Isolates backup infrastructure and rotates backup admin credentials",
            "States what evidence would show the attacker is contained",
          ],
        },
        {
          team: EXEC,
          actions: ["Activates the incident response plan", "Names an incident commander", "Sets an executive update cadence"],
        },
        {
          team: LEGAL,
          actions: [
            "Engages breach counsel from the insurer panel",
            "Contacts the insurer or broker",
            "Has counsel retain the forensic firm",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 05:40. The overnight SOC analyst sees mass file encryption on servers at the **Tacoma distribution center**. EDR quarantined the encryptor on most hosts within minutes, but the warehouse management system at two sites is down. A domain admin account is logging in from a print server.\n\n" +
            "Trucks are queuing at the Tacoma dock. The first shift starts at 06:30.",
        },
        degrading: {
          narrativeMd:
            "Monday 05:40. Overnight EDR alerts were missed until the morning shift. Encryption has spread across servers at **three distribution centers**, and the warehouse management system is down at all three. A domain admin account is logging in from a print server.\n\n" +
            "The ransom note is printing on warehouse printers.",
          artifacts: [HP_RANSOM_NOTE],
        },
        critical: {
          narrativeMd:
            "Monday 05:40. Encryption is running across most of the network. The warehouse management system is down at **11 of 14 sites**, and the backup console shows recent backup jobs were deleted overnight. A domain admin account is logging in from a print server.\n\n" +
            "The ransom note is printing on warehouse printers and drivers are being turned away at the gates.",
          artifacts: [HP_RANSOM_NOTE],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Encryption is active and a domain admin account is in use from a print server that should never use it. What is the first move?",
          discussionPrompt: "What would you need to see before you are confident the attacker no longer has domain admin access?",
          capabilityKeys: ["RS.MI", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Keep systems up and monitor the admin account for an hour to learn the attacker's tools first.",
              quality: ["bad", "bad", "bad"],
              followUp: "Security watched instead of acting. More hosts encrypted during the morning.",
              rationale: "Active encryption with domain admin access is a containment emergency. CISA's #StopRansomware guide puts isolation first.",
            },
            {
              id: "b",
              text: "Isolate the affected segments and disable the admin account now, accepting more sites may go down.",
              quality: ["great", "great", "good"],
              followUp: "Affected segments were isolated and the admin account was disabled.",
              rationale: "Cutting the attacker's access and stopping the spread comes first. The cost in downtime is smaller than further encryption.",
            },
            {
              id: "c",
              text: "Shut down every server company wide until scope is known, accepting an outage at all 14 sites.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Every server was shut down. All 14 sites lost their systems.",
              rationale: "Stops the spread but takes down healthy sites and loses memory evidence. It fits only when encryption is everywhere.",
            },
            {
              id: "d",
              text: "Spend an hour pulling EDR and login data to scope the spread, then isolate what you confirm.",
              quality: ["good", "neutral", "bad"],
              followUp: "Security scoped for an hour before isolating.",
              rationale: "Scoping before isolating is defensible when EDR has the spread in hand. When it does not, the hour costs more hosts.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The COO wants to keep unaffected sites running. The CISO wants authority to take more systems down if needed. Who decides, and how?",
          discussionPrompt: "Does your incident response plan say who can stop operations at a site, and has that person ever done it?",
          capabilityKeys: ["GV.RR", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Let the COO decide which systems stay up, since operations owns revenue and customer commitments.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The COO was given the call on which systems stay up.",
              rationale: "Operations input matters, but giving containment calls to the revenue owner slows isolation when the spread is real.",
            },
            {
              id: "b",
              text: "Hold major decisions until the board chair is briefed and agrees, given the likely financial impact.",
              quality: ["bad", "bad", "bad"],
              followUp: "Decisions waited on the board chair. Response stalled for two hours.",
              rationale: "The board oversees but does not run the response. Waiting for the chair stalls containment for hours.",
            },
            {
              id: "c",
              text: "Activate the response plan, make the CISO incident commander for technical calls, and set 2 hour updates.",
              quality: ["great", "great", "great"],
              followUp: "The plan was activated with the CISO as incident commander.",
              rationale: "A named incident commander with technical authority and a fixed update rhythm is what the plan exists for.",
            },
            {
              id: "d",
              text: "Ask the CISO for a scope estimate within the hour, then activate the plan at the right severity.",
              quality: ["good", "neutral", "bad"],
              followUp: "Plan activation waited for a scope estimate.",
              rationale: "Sizing the response is sensible when damage is small. When encryption is spreading, the plan should start now.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The cyber policy requires notice as soon as practicable and use of panel vendors. Outside counsel is not engaged yet. What do you do first?",
          discussionPrompt: "Who in your organization knows the insurer's breach hotline number and the panel vendor list today?",
          capabilityKeys: ["GV.OC", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Hire the forensic firm used last year directly to save time, and sort out insurance coverage later.",
              quality: ["neutral", "bad", "bad"],
              followUp: "An off panel forensic firm was hired directly. Coverage for its fees is now in question.",
              rationale: "Off panel fees are often not covered, and a firm hired by the business, not counsel, weakens privilege (Capital One, 2020).",
            },
            {
              id: "b",
              text: "Wait until scope is clear before contacting the insurer, so the claim describes the incident well.",
              quality: ["bad", "bad", "bad"],
              followUp: "Insurer contact was held back until scope is clear.",
              rationale: "Policies require notice of a potential claim as soon as practicable. Late notice can reduce or void coverage.",
            },
            {
              id: "c",
              text: "Call the broker to confirm coverage terms and panel rules before engaging counsel or forensics.",
              quality: ["good", "good", "neutral"],
              followUp: "The broker confirmed coverage terms. No one is engaged yet.",
              rationale: "Sensible, but it adds hours before forensics starts. Panel counsel can confirm terms in parallel.",
            },
            {
              id: "d",
              text: "Engage panel breach counsel now, have counsel retain the forensic firm, and call the insurer hotline.",
              quality: ["great", "great", "good"],
              followUp: "Panel counsel was engaged, the forensic firm was retained through counsel, and the insurer has been called.",
              rationale: "Panel counsel retaining forensics protects privilege, keeps fees covered, and starts the insurer relationship early.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The demand",
      scenarioOffsetMin: 360,
      plannedDelayMin: 7,
      objectiveKeys: ["o3", "o4"],
      expectedActions: [
        {
          team: EXEC,
          actions: [
            "Asks counsel for a sanctions check before any payment discussion",
            "Names who has authority to approve a payment",
            "Decides whether to engage a negotiator through the insurer",
          ],
        },
        {
          team: LEGAL,
          actions: ["Sends formal written notice to the insurer", "Returns the FBI call or assigns someone to", "Records what is shared with law enforcement"],
        },
        {
          team: COMMS,
          actions: ["Sends internal guidance to all staff", "Sets up direct calls to key customers", "Names one approver for outbound messages"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 11:40. The attacker's portal names a price: **$4.5 million** in bitcoin within 72 hours, doubling after that. They claim to hold 1.2 TB of files but have shown no proof.\n\n" +
            "Backups are intact and the warehouse system restore can start tonight. The two affected sites are running on paper.\n\n" +
            "The broker says the policy needs formal written notice within 48 hours of discovery. The FBI field office left a voicemail for the security lead.",
          consequenceText: "Fast containment kept the damage to two sites, but a large retail customer moved this week's freight to a competitor. That revenue is gone for the quarter.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Customer moves freight",
              from: "Renata Cole, Kessler Home Goods",
              sentAt: "Monday 10:55",
              content:
                "**From:** Renata Cole <rcole@kesslerhome.example>\n**Subject:** Tacoma pickups this week\n\n" +
                "We have not had a pickup confirmation since last night and your support line has no answers. We are moving this week's loads to another carrier. Please tell us when Tacoma will be reliable again.",
            },
          ],
        },
        degrading: {
          narrativeMd:
            "Monday 11:40. The attacker's portal names a price: **$4.5 million** in bitcoin within 72 hours, doubling after that. They posted a list of folder names that match the HR share.\n\n" +
            "One backup set is damaged. Restoring the three affected sites will take four to six days. Customers are calling about missed pickups.\n\n" +
            "The broker says the policy needs formal written notice within 48 hours of discovery. The FBI field office left a voicemail for the security lead.",
          consequenceText: "The late detection turned a two site outage into three, and the restore estimate is now measured in days.",
          artifacts: [
            {
              id: "a1",
              kind: "voicemail",
              title: "FBI field office voicemail",
              from: "FBI field office, cyber squad",
              sentAt: "Monday 10:20",
              content:
                "\"This message is for the security lead at Harbor Point Logistics. This is Special Agent Lena Ortiz with the cyber squad at the field office. We may have information related to activity on your network. We have seen the same group at other companies. Please call the field office and ask for the cyber duty agent.\"",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Monday 11:40. The attacker's portal names a price: **$4.5 million** in bitcoin within 72 hours, doubling after that. They posted screenshots of driver records and customer contracts.\n\n" +
            "Backups are gone. Rebuilding will take weeks. Shipments have stopped at most sites and two retail customers are citing penalty clauses.\n\n" +
            "The broker says the policy needs formal written notice within 48 hours of discovery. The FBI field office left a voicemail for the security lead.",
          consequenceText: "With backups deleted, every option now costs time, money, or both.",
          artifacts: [
            {
              id: "a1",
              kind: "chat",
              title: "Board chair text",
              from: "Board chair",
              sentAt: "Monday 11:15",
              content:
                "**Board chair**\n\nA friend at another shipper says we are down everywhere. Why am I hearing this from outside? I need a call in 30 minutes. Are we paying, and do we need to tell the SEC?",
            },
          ],
        },
      },
      questions: [
        {
          team: EXEC,
          type: "ransom",
          decisionOwner: "CEO",
          stem: "The attacker wants $4.5 million within 72 hours. How do you approach the payment question?",
          discussionPrompt: "Who in your company has the authority to approve a ransom payment, and what would they need to know first?",
          capabilityKeys: ["GV.RR", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Pay now through a crypto broker to get the decryptor before the price doubles, then tell the insurer.",
              quality: ["bad", "bad", "bad"],
              followUp: "Payment was approved before any sanctions check or insurer input.",
              rationale: "OFAC's 2021 ransomware advisory says paying a sanctioned party is a violation even without knowing it. Skipping the check and insurer risks both.",
            },
            {
              id: "b",
              text: "Announce publicly today that Harbor Point will not pay, to discourage the attacker and reassure clients.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The company said publicly it will not pay.",
              rationale: "Defensible when backups are intact, but it gives up leverage and can prompt early publication. A private decision keeps options open.",
            },
            {
              id: "c",
              text: "Do not engage yet. Have counsel run a sanctions check and retain the insurer's negotiator as recovery runs.",
              quality: ["great", "great", "good"],
              followUp: "A sanctions check and an insurer approved negotiator are in place. No contact with the attacker yet.",
              rationale: "Matches OFAC's 2021 advisory: screen for sanctions, involve law enforcement, and keep options open while recovery proceeds.",
            },
            {
              id: "d",
              text: "Defer the payment question to the full board meeting on Thursday and keep restoring in the meantime.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The payment question waits for Thursday's board meeting.",
              rationale: "The 72 hour deadline lands Thursday, so waiting for the board leaves no time for a sanctions check or negotiation.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The policy needs formal written notice within 48 hours of discovery. The FBI field office has also called. What do you do?",
          discussionPrompt: "What would you share with the FBI, and who decides what is shared?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Hold formal notice until forensics confirms whether data left the network, so the notice is accurate.",
              quality: ["bad", "bad", "bad"],
              followUp: "Formal insurer notice is still on hold.",
              rationale: "The 48 hour notice window has run since detection. Policies need notice of a potential claim, not a confirmed one.",
            },
            {
              id: "b",
              text: "Send formal written notice to the insurer today and return the FBI call through outside counsel.",
              quality: ["great", "great", "good"],
              followUp: "The insurer has formal notice and counsel is talking with the FBI.",
              rationale: "Meets the policy condition. OFAC's 2021 advisory treats early, full cooperation with law enforcement as a mitigating factor.",
              clocks: [{ key: "insurer_notice", action: "met" }],
            },
            {
              id: "c",
              text: "Send formal written notice to the insurer today, but hold the FBI call until counsel scopes what to share.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The insurer has formal notice. The FBI call has not been returned.",
              rationale: "Meets the insurer clock, but the delay loses FBI threat intelligence and the cooperation credit OFAC weighs.",
              clocks: [{ key: "insurer_notice", action: "met" }],
            },
            {
              id: "d",
              text: "Return the FBI call today and send formal insurer notice once panel counsel has drafted it.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "Counsel is talking with the FBI. The insurer notice is still in draft.",
              rationale: "Engaging the FBI is right, but the insurer notice clock is running and a polished draft can miss it.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP communications",
          stem: "Customers and drivers are asking what is going on, and staff are speculating in internal chat. What goes out first?",
          discussionPrompt: "Who approves internal messages during an incident, and how fast can they turn one around?",
          capabilityKeys: ["RS.CO"],
          options: [
            {
              id: "a",
              text: "Nothing goes out until Legal clears a full public statement, to avoid conflicting messages.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Nothing has gone out. Staff and customers are filling the gap themselves.",
              rationale: "Silence lets rumor fill the gap. Internal guidance does not need to wait for a full public statement.",
            },
            {
              id: "b",
              text: "A public statement confirming a ransomware attack and the amount demanded, to show candor early.",
              quality: ["bad", "bad", "neutral"],
              followUp: "The attack and the ransom amount are now public.",
              rationale: "Naming the demand invites public debate on payment and pressure from the attacker. It costs less once the attack is visible.",
            },
            {
              id: "c",
              text: "A short note to all staff on what to say and where to send questions, then calls to key customers.",
              quality: ["great", "great", "good"],
              followUp: "Staff have guidance and key customers got calls.",
              rationale: "Internal guidance cuts leaks and rumor, and direct calls protect the customers most likely to leave.",
            },
            {
              id: "d",
              text: "An email to customers that systems are down for planned maintenance, corrected once facts are known.",
              quality: ["bad", "bad", "bad"],
              followUp: "Customers were told it was planned maintenance.",
              rationale: "A false statement to customers is deceptive, creates FTC and contract exposure, and will surface.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Materiality",
      scenarioOffsetMin: 1880,
      plannedDelayMin: 9,
      objectiveKeys: ["o2", "o4"],
      clockTriggersByPath: { degrading: ["state_ag"], critical: ["state_ag"] },
      expectedActions: [
        {
          team: LEGAL,
          actions: [
            "Records the time of the materiality determination",
            "Lists the qualitative factors considered, not only revenue",
            "Names who approves the 8-K text",
          ],
        },
        {
          team: EXEC,
          actions: ["Sends the board a written update", "Lists the decisions the board will need to make", "Sets the next board update time"],
        },
        {
          team: COMMS,
          actions: ["Sends a holding statement cleared by Legal", "Gives a time for the next update", "Keeps statements within confirmed facts"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 13:00. Warehouse systems are back at one of the two sites. Forensics confirms the attacker sent out about 300 GB, mostly customer contracts and HR documents. Whether driver personal data is in the set is still being checked. Finance estimates a **$9 million** revenue impact this quarter, about 3 percent.\n\n" +
            "The disclosure committee meets at 14:00. The board chair wants a call within the hour. A reporter has asked for comment.",
          consequenceText: "Containment held, but data theft is now confirmed and that changes the legal picture.",
        },
        degrading: {
          narrativeMd:
            "Tuesday 13:00. Restore is slow and one site is still down. Forensics confirms that driver records with Social Security numbers left the network. Finance estimates a **$12 million** revenue impact this quarter, about 4 percent.\n\n" +
            "The disclosure committee meets at 14:00. The board chair wants a call within the hour. A reporter says sources describe a ransomware attack.",
          consequenceText: "Confirmed theft of driver records means state notice obligations beyond the SEC now apply.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Reporter asks for comment",
              from: "Theo Marsh, Northline Business Journal",
              sentAt: "Tuesday 12:20",
              content:
                "**From:** Theo Marsh <tmarsh@northlinebj.example>\n**Subject:** Request for comment: Harbor Point systems outage\n\n" +
                "Two sources tell me Harbor Point is dealing with a ransomware attack and that driver data may be involved. I plan to publish at 16:00. Can you confirm whether there was an attack, whether data was taken, and when operations will recover?",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Tuesday 13:00. Most sites are still down. Forensics confirms theft of driver records with Social Security numbers and customer contracts. Finance says the quarter could miss guidance by **$45 million** or more, about 15 percent.\n\n" +
            "The disclosure committee meets at 14:00. A trade outlet has already reported the attack, and the board chair wants a call within the hour.",
          consequenceText: "The story is public before the company has said anything, and the stock is down 8 percent this morning.",
          artifacts: [
            {
              id: "a1",
              kind: "news",
              title: "Trade outlet reports the attack",
              from: "Freightline Weekly",
              sentAt: "Tuesday 09:30",
              content:
                "**Harbor Point Logistics hit by ransomware, sources say**\n\n" +
                "Harbor Point Logistics has halted shipments at most of its distribution centers after a ransomware attack, according to two people familiar with the matter. One said driver records were stolen. Harbor Point did not respond to a request for comment.",
            },
            {
              id: "a2",
              kind: "email",
              title: "Reporter asks for comment",
              from: "Theo Marsh, Northline Business Journal",
              sentAt: "Tuesday 12:20",
              content:
                "**From:** Theo Marsh <tmarsh@northlinebj.example>\n**Subject:** Follow up on ransomware report\n\n" +
                "Freightline Weekly reports a ransomware attack and stolen driver records. Can you confirm, and say whether you have notified the SEC? I am filing at 16:00.",
            },
          ],
        },
      },
      questions: [
        {
          team: LEGAL,
          type: "materiality",
          decisionOwner: "General counsel, with the disclosure committee",
          stem: "The disclosure committee meets at 14:00. Forensics confirms data left the network and finance has a revenue estimate. What does the committee determine?",
          discussionPrompt: "Which qualitative factors, beyond revenue, would your disclosure committee weigh, and who records the time of the determination?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Determine the incident is material now, and record the basis for the decision and the time it was made.",
              quality: ["great", "great", "great"],
              followUp: "The committee determined the incident is material and recorded the basis and the time. The 8-K clock is running.",
              rationale: "Item 1.05 requires a determination without unreasonable delay. Confirmed data theft and lost customers point to material.",
              clocks: [{ key: "sec_8k", action: "trigger" }],
            },
            {
              id: "b",
              text: "Determine it is not material because the revenue impact is under 5 percent, and record that analysis.",
              quality: ["bad", "bad", "bad"],
              followUp: "The committee found the incident not material on revenue alone.",
              rationale: "SAB 99 says a numeric threshold alone is not enough. Data theft, reputational harm, and customer and regulatory exposure count.",
            },
            {
              id: "c",
              text: "Record a preliminary assessment today and set a final determination within 48 hours on named open facts.",
              quality: ["neutral", "bad", "bad"],
              followUp: "A preliminary assessment is recorded. A final determination is due Thursday.",
              rationale: "A short documented process is allowed, but the facts are already enough. Another 48 hours risks unreasonable delay.",
            },
            {
              id: "d",
              text: "Treat it as not yet material and file a voluntary Item 8.01 8-K describing the incident.",
              quality: ["good", "neutral", "bad"],
              followUp: "The committee treated the incident as not yet material and is preparing a voluntary Item 8.01 filing.",
              rationale: "SEC staff guidance from 2024 allows Item 8.01 before a determination, but it does not replace Item 1.05 once facts point to material.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The board chair wants a call within the hour and asks whether to pay and whether to tell investors. What do you bring to the board?",
          discussionPrompt: "The board chair asks whether the CFO should brief the largest shareholders privately. How does Regulation FD shape your answer?",
          capabilityKeys: ["GV.RR", "GV.OV"],
          options: [
            {
              id: "a",
              text: "A verbal update now, and a written summary once the disclosure committee has met at 14:00.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The chair got a verbal update. A written summary will follow the committee meeting.",
              rationale: "Fast, but decisions and open facts belong in writing. Board oversight under Caremark relies on a record.",
            },
            {
              id: "b",
              text: "A short written update with known facts, unknowns, decisions needed, and the materiality timeline.",
              quality: ["great", "great", "good"],
              followUp: "The board has a written update and knows which decisions are coming.",
              rationale: "A written brief with unknowns and pending decisions supports board oversight and the Item 106 governance record.",
            },
            {
              id: "c",
              text: "A full board briefing once recovery is complete and the facts are settled, with texts to the chair.",
              quality: ["bad", "bad", "bad"],
              followUp: "The full board has not been briefed.",
              rationale: "Waiting leaves the board uninformed through the decisions it oversees and invites oversight claims.",
            },
            {
              id: "d",
              text: "A request that the board take over the payment and disclosure decisions, with management advising.",
              quality: ["neutral", "neutral", "good"],
              followUp: "The board now owns the payment and disclosure decisions.",
              rationale: "Management normally runs the response. At the critical path's scale, board ownership of the payment call is reasonable.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP communications",
          stem: "A reporter has asked for comment by 16:00 and says sources describe a ransomware attack. How do you respond?",
          discussionPrompt: "What would you never say to a reporter during an active incident, and who checks that?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Decline to comment for now and promise a full statement after the disclosure committee decides.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The company declined to comment. The story ran without its side.",
              rationale: "No comment lets sources set the story. It is tolerable only when little is known outside the company.",
            },
            {
              id: "b",
              text: "Give the reporter an off the record briefing with more detail than the public statement.",
              quality: ["bad", "bad", "bad"],
              followUp: "An off the record briefing went to one reporter.",
              rationale: "Regulation FD exempts the press, but detail beyond the public record gets ahead of the 8-K and rarely stays off the record.",
            },
            {
              id: "c",
              text: "Wait for the materiality decision, then issue one statement timed with any 8-K filing.",
              quality: ["good", "neutral", "bad"],
              followUp: "The statement is waiting on the materiality decision.",
              rationale: "One aligned statement is tidy, but the reporter files at 16:00 either way. It works only if the story is not yet out.",
            },
            {
              id: "d",
              text: "Confirm a cybersecurity incident, state the operational impact and support line, and set a next update.",
              quality: ["great", "great", "great"],
              followUp: "A holding statement went out with a time for the next update.",
              rationale: "Confirms what is true and useful to customers, avoids cause and data claims, and keeps control with a next update time.",
            },
          ],
        },
      ],
      deliverable: {
        team: COMMS,
        kind: "holding_statement",
        prompt: "Write the holding statement you would send the reporter and post on the company website. Keep it under 150 words.",
      },
      deliverableCriteria: [
        "Confirms a cybersecurity incident without speculating on cause or who is behind it.",
        "States the operational impact in plain terms.",
        "Tells customers and drivers where to get help.",
        "Commits to a time for the next update.",
        "Makes no claim about data theft beyond what is confirmed.",
      ],
    }),
    inject({
      title: "Data leak threat",
      scenarioOffsetMin: 3140,
      plannedDelayMin: 6,
      objectiveKeys: ["o1", "o3", "o4"],
      clockTriggers: ["state_ag"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Resets krbtgt twice and privileged credentials before reconnecting sites",
            "Hunts for new accounts, GPOs, scheduled tasks and remote tools the attacker added",
            "States the evidence needed before reconnecting",
          ],
        },
        {
          team: COMMS,
          actions: ["Sends drivers an update on what is known", "Opens a help line for drivers", "Offers credit monitoring or identity protection"],
        },
        {
          team: EXEC,
          actions: [
            "Confirms the sanctions check status before any payment",
            "Records the payment decision and who made it",
            "Informs the FBI of the decision",
          ],
        },
        {
          team: LEGAL,
          actions: [
            "Closes or restricts the trading window in writing",
            "Lists everyone who knows of the incident",
            "Names who pre clears any trade",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 10:00. All but one site are back online. The attacker posted 200 sample files on its leak site, including names and license numbers of about **3,000 drivers**. They dropped the price to **$2 million** if paid within 24 hours.\n\n" +
            "The drivers' union has asked for a meeting today. The quarterly trading window is set to open Friday.",
          consequenceText: "Recovery is ahead of plan and there is no sign of the attacker on the network.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Union asks for a meeting",
              from: "Marcus Bell, Local 412",
              sentAt: "Wednesday 08:40",
              content:
                "**From:** Marcus Bell <mbell@local412.example>\n**Subject:** Driver data\n\n" +
                "Our members are seeing their names and license numbers on a website. We need a meeting today and a straight answer on what was taken and what you will do about it.",
            },
          ],
        },
        degrading: {
          narrativeMd:
            "Wednesday 10:00. One site is still down. The leak site lists Harbor Point with a 48 hour countdown. The sample includes driver names with Social Security numbers and pricing terms from customer contracts. The attacker will take **$2 million** if paid within 24 hours.\n\n" +
            "Drivers are posting about it. The quarterly trading window is set to open Friday.",
          consequenceText: "Customers are asking whether their contract terms are now visible to competitors.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Driver post",
              from: "@roadhaul_dee",
              content: "**@roadhaul_dee**\n\nJust found my SSN on a hacker site because of Harbor Point. Nobody has told us drivers what was taken.",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Wednesday 10:00. The attacker published the first 40 GB, including driver names with Social Security numbers. Customers are finding their contract terms online.\n\n" +
            "Security found a new login from a VPN account the attacker should not have, so they may still have a way in. The attacker offers to stop publishing for **$2 million** paid within 24 hours. The quarterly trading window is set to open Friday.",
          consequenceText: "The attacker may still be inside, and every hour of publication adds people to the notice list.",
          artifacts: [
            {
              id: "a1",
              kind: "news",
              title: "Leak story",
              from: "Freightline Weekly",
              sentAt: "Wednesday 07:15",
              content:
                "**Stolen Harbor Point files published online**\n\n" +
                "A ransomware group has posted files it says came from Harbor Point Logistics, including driver records and customer contracts. Two Harbor Point customers confirmed their contract terms appear in the files.",
            },
            {
              id: "a2",
              kind: "social_post",
              title: "Driver post",
              from: "@roadhaul_dee",
              content: "**@roadhaul_dee**\n\nMy SSN is on a hacker site because of Harbor Point. Still no straight answer on what they took.",
            },
          ],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The leaked sample matches files from the HR share. How do you make sure the attacker is out before reconnecting the remaining sites?",
          discussionPrompt: "How would you prove to the board that the attacker is gone?",
          capabilityKeys: ["RS.MI", "RC.RP"],
          options: [
            {
              id: "a",
              text: "Reconnect the remaining sites now to end the outage, and run the threat hunt in parallel.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The remaining sites were reconnected before the hunt finished.",
              rationale: "Reconnecting before eviction risks reinfection. It is tolerable only when the hunt is far along and access looks closed.",
            },
            {
              id: "b",
              text: "Reconnect once EDR shows no active alerts for 24 hours, since a leak does not need network access.",
              quality: ["bad", "bad", "bad"],
              followUp: "Sites are set to reconnect after a quiet day on EDR.",
              rationale: "No alerts is not proof of eviction. An attacker with valid credentials and persistence often triggers none.",
            },
            {
              id: "c",
              text: "Reset krbtgt twice and all privileged accounts, then hunt new accounts, GPOs and tasks before reconnecting.",
              quality: ["great", "great", "good"],
              followUp: "krbtgt and privileged credentials are being reset and the persistence hunt is underway before reconnection.",
              rationale: "Two krbtgt resets about 10 hours apart, Tier 0 and service account resets, and a hunt for added accounts, GPOs, tasks and remote tools are what eviction takes after a domain admin compromise.",
            },
            {
              id: "d",
              text: "Rebuild identity infrastructure from scratch and keep every affected site offline until it is done.",
              quality: ["neutral", "good", "great"],
              followUp: "Identity is being rebuilt from scratch and affected sites stay offline.",
              rationale: "A full identity rebuild is slow and costly, but justified when the attacker may still have access.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP communications",
          stem: "Drivers whose records appear in the sample are asking if they are affected. What do you tell them?",
          discussionPrompt: "How would you reach drivers who are on the road and not reading company email?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Say nothing to drivers until the full data set is analyzed, so every notice is accurate.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Drivers have heard nothing from the company.",
              rationale: "Accuracy matters, but drivers can already see their data online. Silence now reads as indifference.",
            },
            {
              id: "b",
              text: "Tell all drivers what is known now, offer credit monitoring, and open a help line, with notices to follow.",
              quality: ["great", "great", "good"],
              followUp: "Drivers got an update, a help line, and an offer of credit monitoring.",
              rationale: "Prompt, honest outreach with practical help limits harm and sets up the formal state notices that follow.",
            },
            {
              id: "c",
              text: "Tell drivers the posted sample looks old and there is no sign their current data was taken.",
              quality: ["bad", "bad", "bad"],
              followUp: "Drivers were told their data looks safe.",
              rationale: "Unverified reassurance is likely false, and state attorneys general treat it as deceptive.",
            },
            {
              id: "d",
              text: "Brief union leadership privately first and let them pass the message on to their drivers.",
              quality: ["good", "neutral", "neutral"],
              followUp: "Union leadership was briefed and is passing the message on.",
              rationale: "Respects the union, but the company owns the notice and not every driver is a member.",
            },
          ],
        },
        {
          team: EXEC,
          type: "ransom",
          decisionOwner: "CEO",
          stem: "The attacker drops the price to $2 million if paid within 24 hours. The insurer will cover part of a payment made through its negotiator. What is your call?",
          discussionPrompt: "What would a payment actually buy you at this point, and what would it not?",
          capabilityKeys: ["GV.RR", "GV.RM"],
          options: [
            {
              id: "a",
              text: "Decline to pay, keep restoring, and prepare drivers and customers for publication of the data.",
              quality: ["great", "great", "good"],
              followUp: "The company declined to pay and is preparing for publication.",
              rationale: "Recovery does not depend on the attacker, and a deletion promise cannot be verified. Preparing for publication is the real control.",
            },
            {
              id: "b",
              text: "Pay through the insurer's negotiator once the sanctions check clears, and demand proof of deletion.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Payment was made through the negotiator after the sanctions check.",
              rationale: "Lawful if OFAC screening clears and the FBI is told, per OFAC's 2021 advisory, but deletion proof is worthless.",
            },
            {
              id: "c",
              text: "Pay right away to stop the leak, and finish the sanctions check after the payment goes out.",
              quality: ["bad", "bad", "bad"],
              followUp: "Payment went out before the sanctions check finished.",
              rationale: "OFAC's 2021 advisory applies strict liability. Paying before screening risks a sanctions violation the insurer will not cover.",
            },
            {
              id: "d",
              text: "Have the negotiator keep the attacker talking for 48 hours while leadership decides.",
              quality: ["good", "neutral", "bad"],
              followUp: "The negotiator is stalling while leadership decides.",
              rationale: "Buys time while recovery runs, but on the critical path the attacker may still be inside and publishing.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The quarterly trading window opens Friday. A vice president who has been on the incident calls wants to sell shares. What do you do?",
          discussionPrompt: "Who outside the officer group knows about this incident today, and are they on any blackout list?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Impose a special blackout on everyone who knows of the incident, including IT staff, until disclosure.",
              quality: ["great", "great", "great"],
              followUp: "A special blackout covers everyone who knows of the incident until it is disclosed.",
              rationale: "Material nonpublic information reaches past officers. SEC cases after the Equifax breach charged employees outside that group.",
            },
            {
              id: "b",
              text: "Let the trading window open as scheduled, since the leak site posting means the attack is public.",
              quality: ["bad", "bad", "bad"],
              followUp: "The trading window opens Friday as scheduled.",
              rationale: "A leak site post is not disclosure by the company. Scope and impact stay nonpublic until the 8-K or a press release.",
            },
            {
              id: "c",
              text: "Close the window for directors and officers only, and remind other staff of the insider trading policy.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The window is closed for directors and officers. Other staff got a reminder.",
              rationale: "Covers the usual insiders but misses the IT staff and advisers working the incident, the group in the Equifax cases.",
            },
            {
              id: "d",
              text: "Close the trading window for all staff and suspend every trade under existing Rule 10b5-1 plans.",
              quality: ["good", "good", "good"],
              followUp: "The window is closed for everyone and existing 10b5-1 plan trades are suspended.",
              rationale: "Safe but broader than needed. Trades under 10b5-1 plans adopted before the incident keep their affirmative defense.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Disclosure",
      scenarioOffsetMin: 4880,
      plannedDelayMin: 7,
      objectiveKeys: ["o1", "o2"],
      expectedActions: [
        {
          team: LEGAL,
          actions: ["Files or schedules the 8-K by its deadline", "Plans how to amend the filing as facts change", "Records who approved the filing text"],
        },
        {
          team: EXEC,
          actions: ["Sets the restart order with security conditions", "Records the trade off decision and its owner", "Sets a board reporting cadence"],
        },
        {
          team: SEC,
          actions: ["Enforces multifactor sign in on remote access", "Starts a review of stale accounts", "Sets a date for the next restore test"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 15:00. All sites are running. The 8-K draft is ready for review. If the committee determined materiality on Tuesday, the filing is due Monday. Forensics traced the initial access to a VPN account with no multifactor sign in that belonged to a former contractor.\n\n" +
            "Operations wants full volume this week. The CISO wants two weeks of hardening first.",
          consequenceText: "Operations are restored, but two analysts have downgraded the stock.",
        },
        degrading: {
          narrativeMd:
            "Thursday 15:00. Every site is running at reduced volume. The 8-K draft is ready for review. If the committee determined materiality on Tuesday, the filing is due Monday. Forensics traced the initial access to a VPN account with no multifactor sign in that belonged to a former contractor.\n\n" +
            "Operations wants full volume this week. The CISO wants two weeks of hardening first.",
          consequenceText: "Customer penalty claims are arriving and the restore backlog will take another week to clear.",
        },
        critical: {
          narrativeMd:
            "Thursday 15:00. Five sites are still down and the attacker keeps publishing. The 8-K draft is ready for review. If the committee determined materiality on Tuesday, the filing is due Monday. Forensics traced the initial access to a VPN account with no multifactor sign in that belonged to a former contractor. The second entry used another stale account.\n\n" +
            "Operations wants to reopen sites as fast as possible. The CISO wants hardening first.",
          consequenceText: "A shareholder suit has been filed and the board has asked for an independent review.",
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The 8-K draft covers the nature, scope, and timing of the incident and its likely material impact. Investigators are still confirming the full data set. What do you do?",
          discussionPrompt: "Who signs off on the 8-K text, and how would you handle an amendment if facts change?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Hold the filing until the investigation is complete, so the 8-K will not need an amendment.",
              quality: ["bad", "bad", "bad"],
              followUp: "The 8-K has not been filed.",
              rationale: "Item 1.05 Instruction 2 says to file on time with what is known and amend once new facts are determined.",
            },
            {
              id: "b",
              text: "File with technical detail on the vulnerabilities and security tools involved, to show thoroughness.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The 8-K was filed with technical detail on the company's defenses.",
              rationale: "Meets the deadline, but Item 1.05 does not call for technical detail and the SEC noted it could help attackers.",
              clocks: [{ key: "sec_8k", action: "met" }],
            },
            {
              id: "c",
              text: "File the Item 1.05 8-K now with what is known, and amend it within four business days as facts firm up.",
              quality: ["great", "great", "great"],
              followUp: "The 8-K was filed with a plan to amend.",
              rationale: "Files on time with the required content and follows the rule's 8-K/A path for facts not yet known.",
              clocks: [{ key: "sec_8k", action: "met" }],
            },
            {
              id: "d",
              text: "Ask the FBI to refer a national security delay request to DOJ (Item 1.05(c)) and hold the filing.",
              quality: ["neutral", "bad", "bad"],
              followUp: "A delay request went to the FBI for referral to DOJ. The filing is on hold.",
              rationale: "DOJ grants delays only for a substantial risk to national security or public safety. A commercial ransomware case rarely qualifies.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Operations wants full volume this week. The CISO wants two weeks of hardening first. What do you decide?",
          discussionPrompt: "Who should own the trade off between restart speed and security, and how would you record it?",
          capabilityKeys: ["RC.RP", "GV.RM"],
          options: [
            {
              id: "a",
              text: "Return to full volume now to win back customers, and schedule the hardening for next quarter.",
              quality: ["bad", "bad", "bad"],
              followUp: "Full volume resumed with hardening deferred to next quarter.",
              rationale: "Leaves the same entry points open while the attacker still has the company's data and attention.",
            },
            {
              id: "b",
              text: "Phase sites back in once the CISO's must fix items are done at each, and report progress weekly.",
              quality: ["great", "great", "good"],
              followUp: "Sites are phasing back in behind the must fix items.",
              rationale: "Ties restart to the controls that failed and keeps the board informed, balancing revenue and risk.",
            },
            {
              id: "c",
              text: "Keep all sites at reduced volume until every hardening item is complete across the network.",
              quality: ["neutral", "neutral", "good"],
              followUp: "All sites stay at reduced volume until hardening is complete.",
              rationale: "Safe but slow. It fits when the attacker may still be inside, and costs revenue otherwise.",
            },
            {
              id: "d",
              text: "Have the outside forensic firm set the restart order and sign off on each site before it reopens.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The forensic firm is setting the restart order.",
              rationale: "Expert input helps, but the restart is a business risk decision that management has to own.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The initial access was a former contractor's VPN account with no multifactor sign in. What do you prioritize in the next 30 days?",
          discussionPrompt: "How many accounts in your environment today belong to people who have left?",
          capabilityKeys: ["PR.AA", "ID.IM"],
          options: [
            {
              id: "a",
              text: "Replace the EDR product first, since the encryptor ran on several hosts before it was stopped.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "A new EDR product is being bought.",
              rationale: "EDR was not the root cause. The attacker walked in through an account that should not have existed.",
            },
            {
              id: "b",
              text: "Disable the contractor account, log the gap in the risk register, and close the incident finding.",
              quality: ["bad", "bad", "bad"],
              followUp: "The contractor account was disabled and the finding closed.",
              rationale: "Treats a control failure as one account. Other stale accounts and missing multifactor remain open.",
            },
            {
              id: "c",
              text: "Commission a full security program review first, and change nothing until its findings are in.",
              quality: ["neutral", "bad", "bad"],
              followUp: "A program review was commissioned. Nothing has changed yet.",
              rationale: "A review has value, but known gaps should close now rather than wait months for a report.",
            },
            {
              id: "d",
              text: "Enforce multifactor sign in on all remote access, remove stale accounts, and test restores monthly.",
              quality: ["great", "great", "great"],
              followUp: "Multifactor sign in is enforced, stale accounts are gone, and restore tests are scheduled.",
              rationale: "Closes the entry point, removes the same weakness elsewhere, and proves recovery works.",
            },
          ],
        },
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// Third-party compromise
// ---------------------------------------------------------------------------

const QUILLON_ADVISORY = {
  id: "a1",
  kind: "email" as const,
  title: "Vendor security advisory",
  from: "Quillon Security",
  sentAt: "Tuesday 08:30",
  content:
    "**From:** Quillon Security <security@quillon.example>\n**Subject:** Security advisory QS-2026-07: Quillon Connect 6.2.1\n\n" +
    "We have found unauthorized code in Quillon Connect version 6.2.1. An attacker gained access to our build system and added a backdoor to this release.\n\n" +
    "We recommend that customers uninstall 6.2.1 and block these domains: cdn-sync.quillon-update.example and telemetry.qcx-node.example. Version 6.2.3 will be available within 24 hours. We will share more indicators as our investigation continues.",
};

const STATE_AG_LETTER = {
  id: "a1",
  kind: "regulator_letter" as const,
  title: "State attorney general letter",
  from: "Office of the State Attorney General, Consumer Protection Division",
  sentAt: "Wednesday",
  content:
    "**Office of the State Attorney General**\nConsumer Protection Division, Privacy Unit\n\n" +
    "**Re: Reported security incident at Calloway Outdoor Co.**\n\n" +
    "Our office is aware of public reports that customer data held by Calloway Outdoor Co. was accessed through compromised vendor software. Within 10 business days, please provide:\n\n" +
    "1. A description of the incident and when it was discovered.\n2. The categories of personal information involved and the number of residents affected.\n" +
    "3. The timeline of notices made or planned.\n4. Steps taken to contain the incident.\n\nPlease preserve all records related to this matter.",
};

const THIRD_PARTY: SeedTemplate = {
  id: THIRD_PARTY_TEMPLATE_ID,
  title: "Third-party compromise",
  summary: "A trusted software vendor pushes a backdoored update. Four teams weigh containment, notice deadlines, and the vendor relationship.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, LEGAL, SEC, COMMS],
    targetDurationMin: 45,
    scenarioAnchor: { weekday: 2, time: "09:00" },
    orgName: "Calloway Outdoor Co.",
    capabilityKeys: ["GV.SC", "RS.MI", "RS.AN", "RS.CO", "GV.OC"],
    regulatoryClocks: [
      { key: "gdpr_72h", label: "GDPR supervisory authority notice", durationHours: 72 },
      { key: "state_ag", label: "State attorney general notice", durationHours: 720 },
      { key: "insurer_notice", label: "Cyber insurer notice", durationHours: 48 },
    ],
    executiveBriefMd:
      "Calloway Outdoor Co. is an outdoor gear retailer that sells online to customers in the US and the EU. Its order integration vendor, Quillon Software, has disclosed that an update to its agent was backdoored.\n\n" +
      "Over six days of simulated time, the Executive, Legal, Security, and Communications teams decide how to contain the vendor software, what data was exposed, which notices are due, and how to handle the vendor. " +
      "Three clocks can start: GDPR supervisory authority notice, state attorney general notice, and cyber insurer notice.",
  },
  objectives: [
    { key: "o1", text: "Contain the compromised vendor software without losing control of operations.", capabilityKeys: ["RS.MI", "GV.SC"] },
    { key: "o2", text: "Determine what data was exposed and meet GDPR, state, and insurer notice deadlines.", capabilityKeys: ["RS.AN", "GV.OC"] },
    { key: "o3", text: "Communicate with customers, partners, and the media accurately.", capabilityKeys: ["RS.CO", "RC.CO"] },
    { key: "o4", text: "Strengthen how the company manages vendor risk.", capabilityKeys: ["GV.SC", "ID.IM"] },
  ],
  injects: [
    inject({
      title: "Vendor advisory",
      scenarioOffsetMin: 0,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o2"],
      clockTriggers: ["gdpr_72h", "insurer_notice"],
      expectedActions: [
        {
          team: SEC,
          actions: ["Blocks the command domains", "Lists every server running the agent", "Isolates or removes the backdoored agent"],
        },
        {
          team: EXEC,
          actions: ["Names who decides containment", "Sets a manual workaround for orders", "Records the trade off decision"],
        },
        {
          team: LEGAL,
          actions: [
            "Records whether and when Calloway became aware",
            "Writes down the basis for that view",
            "Asks Quillon for details under its processor duties",
          ],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 09:00. Quillon Software emails customers: version **6.2.1** of its Quillon Connect agent, released 11 days ago, contained a backdoor added through Quillon's build system. Calloway runs the agent on 240 servers. It moves online orders from the web store to the warehouses.\n\n" +
            "EDR shows 6 servers contacted the two command domains Quillon listed. The egress filter has blocked both domains since day 3. Tomorrow is the first day of the holiday sale.",
          artifacts: [QUILLON_ADVISORY],
        },
        degrading: {
          narrativeMd:
            "Tuesday 09:00. Quillon Software emails customers: version **6.2.1** of its Quillon Connect agent, released 11 days ago, contained a backdoor. Calloway runs the agent on 240 servers, including the order database.\n\n" +
            "EDR shows 140 servers contacted the command domains, and the egress filter did not block them. Quillon's advisory gives few details. Tomorrow is the first day of the holiday sale.",
          artifacts: [QUILLON_ADVISORY],
        },
        critical: {
          narrativeMd:
            "Tuesday 09:00. Quillon Software emails customers: version **6.2.1** of its Quillon Connect agent, released 11 days ago, contained a backdoor. Calloway runs the agent on 240 servers, including the order database.\n\n" +
            "Every server running the agent has contacted the command domains. Last night the order database server sent 14 GB to an unknown host. Quillon's support line is not answering. Tomorrow is the first day of the holiday sale.",
          artifacts: [QUILLON_ADVISORY],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Quillon recommends uninstalling version 6.2.1. Orders reach the warehouses only through the agent. What do you do first?",
          discussionPrompt: "Do you know every place a given vendor's software runs in your environment, and how long would it take to find out?",
          capabilityKeys: ["RS.MI", "GV.SC"],
          options: [
            {
              id: "a",
              text: "Block the command domains, isolate servers that called them, and keep the agent running elsewhere.",
              quality: ["great", "good", "neutral"],
              followUp: "The command domains are blocked and the affected servers isolated. The agent still runs elsewhere.",
              rationale: "Cuts command and control and isolates exposed hosts while orders keep flowing. It is weaker as the spread grows.",
            },
            {
              id: "b",
              text: "Uninstall the agent everywhere now, accepting that orders stop reaching the warehouses until 6.2.3.",
              quality: ["good", "great", "great"],
              followUp: "The agent was removed everywhere. Orders are no longer reaching the warehouses.",
              rationale: "Removing backdoored software everywhere is the safe call once many hosts have called out. Capture triage images of the hosts that called out before uninstalling, or the evidence goes with the agent.",
            },
            {
              id: "c",
              text: "Wait for Quillon's full indicator list before acting, so containment covers every affected host.",
              quality: ["bad", "bad", "bad"],
              followUp: "Security is waiting on Quillon's indicator list.",
              rationale: "Waiting on the vendor leaves a known backdoor active. The advisory already gives enough to contain.",
            },
            {
              id: "d",
              text: "Roll the agent back to version 6.2.0 on every server and block the two command domains.",
              quality: ["good", "neutral", "bad"],
              followUp: "The agent was rolled back to 6.2.0 and the command domains are blocked.",
              rationale: "Version 6.2.0 came from the same build system, which the attacker held for five weeks, so it is not known to be clean. A rollback also leaves whatever the attacker installed on hosts that called out.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Orders stop flowing to the warehouses if the agent is removed, and the holiday sale starts tomorrow. Who decides the trade off?",
          discussionPrompt: "Which vendors could stop your revenue if you had to switch them off today?",
          capabilityKeys: ["GV.RR", "GV.SC"],
          options: [
            {
              id: "a",
              text: "Delay the holiday sale by a day and tell customers it is a scheduling change while you contain.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The sale moved by a day with a scheduling explanation.",
              rationale: "Buys time, but a false reason for the delay becomes a deceptive statement once the breach is public.",
            },
            {
              id: "b",
              text: "Keep the agent running with extra monitoring until the sale ends, then contain the next week.",
              quality: ["bad", "bad", "bad"],
              followUp: "The agent stays in place through the sale.",
              rationale: "Leaving a known backdoor running for revenue is the kind of choice regulators cite as unreasonable security.",
            },
            {
              id: "c",
              text: "Convene the full executive team this morning to agree on the trade off together before acting.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Containment waits for a full executive meeting.",
              rationale: "Shared ownership slows containment. The plan should already say who decides technical containment.",
            },
            {
              id: "d",
              text: "The CISO decides containment, and operations builds a manual order export with an executive sponsor.",
              quality: ["great", "great", "good"],
              followUp: "The CISO owns containment and operations is building a manual order export.",
              rationale: "Clear authority for containment plus a business workaround keeps both security and revenue moving.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Has Calloway become aware of a personal data breach under Art. 33?",
          discussionPrompt: "What does your company treat as awareness of a breach, and who writes down when it happened?",
          capabilityKeys: ["GV.OC", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Yes. Treat today as awareness, record the basis, and start drafting the Art. 33 notice to the authority.",
              quality: ["good", "great", "great"],
              followUp: "Awareness is recorded as today and the Art. 33 notice is being drafted.",
              rationale: "Awareness means reasonable certainty that personal data was compromised. That is clear once order data left, cautious when it is not.",
            },
            {
              id: "b",
              text: "Not yet. Run a short investigation of a day or two to establish whether personal data was compromised.",
              quality: ["great", "good", "bad"],
              followUp: "Legal opened a short investigation and will decide on awareness within two days.",
              rationale: "EDPB guidance allows a brief investigation to reach reasonable certainty. The order database upload on the critical path already gives it.",
            },
            {
              id: "c",
              text: "No. Quillon is the processor, so under Art. 33(2) it notifies the authority and Calloway can wait.",
              quality: ["bad", "bad", "bad"],
              followUp: "Legal is leaving the authority notice to Quillon.",
              rationale: "Art. 33(2) requires the processor to notify the controller without undue delay. The notice to the authority stays with Calloway.",
            },
            {
              id: "d",
              text: "Not until forensics proves data was accessed, which may take weeks given how thin the advisory is.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Legal is waiting for forensic proof of access before treating this as a breach.",
              rationale: "Awareness does not require forensic proof. Waiting weeks for it is undue delay under Art. 33(1).",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Customer exposure",
      scenarioOffsetMin: 1080,
      plannedDelayMin: 9,
      objectiveKeys: ["o2", "o3"],
      clockTriggers: ["state_ag"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "States what the logs prove and what they do not",
            "Names the four day gap in the report",
            "Gives Legal a record count with a confidence level",
            "Decides on a forced customer password reset when password hashes were taken",
          ],
        },
        {
          team: LEGAL,
          actions: [
            "Sends an initial notice to the lead supervisory authority",
            "Records the time and content of the notice",
            "Sets a date for the follow up notice",
          ],
        },
        {
          team: COMMS,
          actions: ["Confirms Calloway uses the affected software", "Gets Legal sign off on the statement", "Sets a time for the next update"],
        },
        {
          team: EXEC,
          actions: ["Gives the insurer formal notice", "Confirms which vendors the policy covers", "Names an owner for incident costs"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 03:00. Forensics shows the backdoor reached the order database. Query logs show the attacker read about **41,000 customer records**: names, email and postal addresses, and order history. Card numbers are tokenized and were not exposed. About 6,200 of the customers live in the EU.\n\n" +
            "Query logs only cover the last 7 days. The backdoor was present for 11. Quillon released a clean version 6.2.3 overnight.",
          consequenceText: "The early block on the command domains kept the exposure to one table.",
          artifacts: [
            {
              id: "a1",
              kind: "news",
              title: "Vendor names customers",
              from: "Retail Systems Report",
              sentAt: "Wednesday 01:30",
              content:
                "**Quillon names customers hit by tampered update**\n\n" +
                "Quillon Software said in a blog post that customers including Calloway Outdoor Co. installed a version of its Quillon Connect agent that contained a backdoor. Quillon said it is working with affected customers.",
            },
          ],
        },
        degrading: {
          narrativeMd:
            "Wednesday 03:00. Forensics shows the backdoor reached the order database. Query logs show the attacker read about **410,000 customer records**: names, email and postal addresses, phone numbers, and order history. About 52,000 live in the EU.\n\n" +
            "Query logs only cover the last 7 days. The backdoor was present for 11. Quillon has published a blog post naming affected customers, including Calloway.",
          consequenceText: "Order flow is backed up going into the first sale day and support queues are three hours long.",
        },
        critical: {
          narrativeMd:
            "Wednesday 03:00. The attacker copied the full customer table, about **1.3 million records**, including hashed passwords. A sample is for sale on a criminal forum. About 160,000 of the customers live in the EU.\n\n" +
            "The password hashes use an older unsalted algorithm. Support asks whether to force every customer to reset their password before the sale opens.\n\n" +
            "Query logs only cover the last 7 days. The backdoor was present for 11. Quillon has published a blog post naming affected customers, including Calloway.",
          consequenceText: "Order flow has stopped going into the first sale day, and customers are reporting phishing emails that quote their recent orders.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Customer post",
              from: "@trailmix_jo",
              content: "**@trailmix_jo**\n\nGot an email quoting my exact Calloway order asking me to confirm my card. Calloway, what is going on?",
            },
          ],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Legal needs to know exactly what data was taken. Logs cover 7 days, and the backdoor was present for 11. What do you report?",
          discussionPrompt: "How long do you keep database query logs, and who decided that?",
          capabilityKeys: ["RS.AN", "DE.AE"],
          options: [
            {
              id: "a",
              text: "Hold the report until the forensic firm rebuilds the missing four days from other sources.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The data report is on hold until the missing days are reconstructed.",
              rationale: "Notice deadlines do not wait for reconstruction. Give Legal what is known now and update it.",
            },
            {
              id: "b",
              text: "Report only what the logs prove, since the four day gap cannot be confirmed either way.",
              quality: ["bad", "bad", "bad"],
              followUp: "Legal got a report that leaves out the four day gap.",
              rationale: "Leaving out a known gap misleads Legal and regulators. Art. 33(4) allows phased detail, not omission.",
            },
            {
              id: "c",
              text: "Report the full customer database as exposed, so notices cover everyone who could be affected.",
              quality: ["neutral", "good", "great"],
              followUp: "Legal is working from the full customer database as exposed.",
              rationale: "Over notice is costly and alarms customers when logs show limits, but it fits when the whole table was taken.",
            },
            {
              id: "d",
              text: "Report what the logs show, state the four day gap plainly, and assume the worst for that window.",
              quality: ["great", "great", "good"],
              followUp: "Legal has the log findings and a clear statement of the gap.",
              rationale: "Separates proven facts from assumptions, which is what counsel and regulators need to scope notice.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The GDPR 72 hour clock is running and the picture is incomplete. What do you send the lead supervisory authority?",
          discussionPrompt: "Which supervisory authority is your lead authority, and who has the contact details?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Wait until the investigation is complete, then send one full notice with the final record counts.",
              quality: ["bad", "bad", "bad"],
              followUp: "No notice has gone to the supervisory authority.",
              rationale: "Art. 33(4) allows notice in phases. A late notice must give reasons for the delay, and incomplete facts rarely qualify.",
            },
            {
              id: "b",
              text: "Send an initial notice now with what is known, and say further details will follow in phases.",
              quality: ["great", "great", "great"],
              followUp: "An initial notice went to the supervisory authority with details to follow.",
              rationale: "Meets the 72 hour deadline with the facts in hand, exactly as Art. 33(4) intends.",
              clocks: [{ key: "gdpr_72h", action: "met" }],
            },
            {
              id: "c",
              text: "Ask Quillon to file a joint notice with Calloway, and wait for its draft before sending anything.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Legal is waiting on Quillon's draft of a joint notice.",
              rationale: "The controller owns the Art. 33 notice. Coordinating with Quillon is fine but cannot hold the deadline.",
            },
            {
              id: "d",
              text: "Notify affected EU customers directly first, then send the authority a notice once they are told.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "EU customers are being notified. The authority has not been.",
              rationale: "Art. 34 notice to individuals does not replace Art. 33 notice to the authority, which is due within 72 hours.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP communications",
          stem: "Quillon's blog post names Calloway and reporters are calling. What do you say?",
          discussionPrompt: "When a vendor names you publicly, who on your side approves the response?",
          capabilityKeys: ["RS.CO"],
          options: [
            {
              id: "a",
              text: "Refer all questions about the breach to Quillon, since its build system was the source.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Reporters were referred to Quillon.",
              rationale: "Customers trusted Calloway with their data. Deflecting to the vendor reads as dodging responsibility.",
            },
            {
              id: "b",
              text: "Say Calloway has found no evidence that customer data was affected while the review continues.",
              quality: ["bad", "bad", "bad"],
              followUp: "Calloway said it has no evidence customer data was affected.",
              rationale: "The logs already show records were read. The statement is false and will be quoted back by regulators.",
            },
            {
              id: "c",
              text: "Confirm Calloway uses the affected software, describe steps taken, and say customer notices will follow.",
              quality: ["great", "great", "good"],
              followUp: "Calloway confirmed it uses the software and said customer notices will follow.",
              rationale: "True, useful, and leaves room for the facts still being confirmed.",
            },
            {
              id: "d",
              text: "Publish a detailed account of the data accessed today, with record counts by country.",
              quality: ["bad", "neutral", "good"],
              followUp: "Calloway published record counts and data types.",
              rationale: "Counts are still moving because of the log gap. Early detail invites corrections, though candor helps once phishing starts.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The cyber policy requires notice within 48 hours of discovery, and costs for forensics, notices, and a call center are mounting. What do you do?",
          discussionPrompt: "Who in your company owns the cyber insurance relationship during an incident?",
          capabilityKeys: ["GV.RM", "GV.SC"],
          options: [
            {
              id: "a",
              text: "Give the insurer formal notice today through the broker and use panel vendors for notices and calls.",
              quality: ["great", "great", "great"],
              followUp: "The insurer has formal notice and panel vendors are handling notices and the call center.",
              rationale: "Meets the policy condition and keeps vendor costs inside coverage.",
              clocks: [{ key: "insurer_notice", action: "met" }],
            },
            {
              id: "b",
              text: "Hold the claim until Quillon accepts liability, so the loss runs through Quillon's insurer instead.",
              quality: ["bad", "bad", "bad"],
              followUp: "No claim has been made. Calloway is waiting on Quillon.",
              rationale: "Calloway's own policy has its own notice condition. Waiting on the vendor can forfeit coverage.",
            },
            {
              id: "c",
              text: "Give the insurer formal notice once the record count is final, so the claim is right the first time.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Insurer notice is waiting on the final record count.",
              rationale: "Policies need notice of a potential claim, not a final one. Waiting for the count risks missing the 48 hours.",
            },
            {
              id: "d",
              text: "Give the insurer formal notice today, but keep Calloway's usual forensic firm instead of a panel firm.",
              quality: ["good", "good", "neutral"],
              followUp: "The insurer has formal notice. Calloway kept its usual forensic firm.",
              rationale: "Meets notice, but off panel vendors may not be paid without the insurer's prior consent.",
              clocks: [{ key: "insurer_notice", action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Notice obligations",
      scenarioOffsetMin: 2880,
      plannedDelayMin: 11,
      objectiveKeys: ["o2", "o3"],
      expectedActions: [
        {
          team: LEGAL,
          actions: ["Lists the states whose notice laws apply", "Sets a deadline for each attorney general notice", "Records the date notice duties were determined"],
        },
        {
          team: EXEC,
          actions: ["Declines to sign a release before legal review", "Requests Quillon's forensic report", "Reviews the contract's indemnity and notice terms"],
        },
        {
          team: COMMS,
          actions: ["Drafts the customer notice for Legal review", "Sets up a support line or FAQ", "Chooses a direct channel to reach customers"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 09:00. The count is final. Affected customers live in 38 US states and 9 EU countries. There is no sign the data has been misused.\n\n" +
            "Quillon offers six months of service credits if Calloway signs a release of claims this week.",
          consequenceText: "Two wholesale partners have paused their order integrations until Calloway completes a security review. That will cost about 4 percent of holiday revenue.",
        },
        degrading: {
          narrativeMd:
            "Thursday 09:00. Affected customers live in 46 US states and 14 EU countries. One state attorney general's office has sent a letter asking for details.\n\n" +
            "Quillon offers six months of service credits if Calloway signs a release of claims this week.",
          consequenceText: "At least one regulator is now watching how fast notices go out.",
          artifacts: [STATE_AG_LETTER],
        },
        critical: {
          narrativeMd:
            "Thursday 09:00. Affected customers live in all 50 states and 22 EU countries. A class action was filed yesterday and two state attorneys general have sent letters.\n\n" +
            "Quillon offers six months of service credits if Calloway signs a release of claims this week.",
          consequenceText: "Every statement the company makes will now be read by plaintiffs' counsel.",
          artifacts: [
            STATE_AG_LETTER,
            {
              id: "a2",
              kind: "news",
              title: "Class action filed",
              from: "Retail Systems Report",
              sentAt: "Wednesday 17:10",
              content:
                "**Calloway customers sue over vendor breach**\n\n" +
                "A proposed class action filed Wednesday claims Calloway Outdoor Co. failed to protect customer data and failed to vet its software vendor. Calloway has not commented on the suit.",
            },
          ],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Affected customers live in many states. Several require notice to the attorney general, some before notice to residents. How do you proceed?",
          discussionPrompt: "Do you have a current list of state notice rules, and who keeps it up to date?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Wait for Quillon's final forensic report before deciding which state notice laws apply.",
              quality: ["neutral", "bad", "bad"],
              followUp: "State notice decisions are waiting on Quillon's report.",
              rationale: "Calloway already knows which residents were affected. State deadlines run from that, not from the vendor's report.",
            },
            {
              id: "b",
              text: "Notify the states with the most affected residents now, and the rest once the count is checked.",
              quality: ["bad", "bad", "bad"],
              followUp: "Only the largest states are getting notice for now.",
              rationale: "Each state law protects its own residents regardless of count. Partial notice leaves violations elsewhere.",
            },
            {
              id: "c",
              text: "Build a state by state plan today with deadlines and order, and draft every resident and AG notice.",
              quality: ["great", "great", "good"],
              followUp: "A state by state plan is in place and every notice is being drafted.",
              rationale: "A plan that tracks each state's deadline and required order is the only reliable way to meet them all.",
            },
            {
              id: "d",
              text: "Email all affected residents today and send the attorney general notices once those are out.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Residents are being emailed. Attorney general notices will follow.",
              rationale: "Fast for customers, but some states, such as New Jersey, require notice to the state before residents.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Quillon offers six months of service credits if Calloway signs a release of claims this week. What do you do?",
          discussionPrompt: "What does your contract with this kind of vendor say about security incidents, notice, and indemnity?",
          capabilityKeys: ["GV.SC", "GV.RM"],
          options: [
            {
              id: "a",
              text: "Sign the release to restore the relationship quickly and take the six months of service credits.",
              quality: ["bad", "bad", "bad"],
              followUp: "Calloway signed the release and gave up its claims.",
              rationale: "Gives up indemnity before costs are known. Notice, credit monitoring, and litigation costs will far exceed the credits.",
            },
            {
              id: "b",
              text: "Decline for now, preserve contract rights, and ask Quillon for its forensic report and indemnity terms.",
              quality: ["great", "great", "great"],
              followUp: "Calloway declined the offer and asked for the forensic report and indemnity terms.",
              rationale: "Keeps every option open and gets the facts needed to value the claim.",
            },
            {
              id: "c",
              text: "Give notice to terminate the Quillon contract today and start moving to a competitor's product.",
              quality: ["neutral", "bad", "neutral"],
              followUp: "Calloway gave notice to terminate with no replacement in place.",
              rationale: "Understandable, but a rushed switch adds operational risk while orders depend on the integration.",
            },
            {
              id: "d",
              text: "Refer the offer to the board's audit committee and respond to Quillon once it gives direction.",
              quality: ["neutral", "neutral", "good"],
              followUp: "The offer is with the audit committee.",
              rationale: "Slower, but with a class action and regulator letters, board review of a release is reasonable.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP communications",
          stem: "Customer notices are ready to draft. How do you send them?",
          discussionPrompt: "How would you know whether customers understood the notice?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Post a notice on the website with a banner on the store, and answer questions as they come in.",
              quality: ["neutral", "bad", "bad"],
              followUp: "A notice is on the website. No one was contacted directly.",
              rationale: "Most state laws allow web posting only as substitute notice when direct contact is not possible.",
            },
            {
              id: "b",
              text: "Include a discount code in the notice to thank customers and keep them buying during the sale.",
              quality: ["bad", "bad", "bad"],
              followUp: "The notice went out with a discount code.",
              rationale: "Marketing in a breach notice reads as minimizing the harm and draws criticism from regulators and plaintiffs.",
            },
            {
              id: "c",
              text: "Send a short notice now and a full notice when the investigation closes and the facts are final.",
              quality: ["good", "neutral", "neutral"],
              followUp: "A short notice went out. The full notice will follow later.",
              rationale: "Early warning helps, but two notices confuse customers and the first may lack content state laws require.",
            },
            {
              id: "d",
              text: "Email customers the facts, what Calloway is doing, steps to take, and a support line, then post an FAQ.",
              quality: ["great", "great", "good"],
              followUp: "Customers got a full email notice and an FAQ is posted.",
              rationale: "Direct notice with the content state laws require and a way to get help.",
            },
          ],
        },
      ],
      deliverable: {
        team: COMMS,
        kind: "customer_notice",
        prompt: "Write the email to affected customers. Keep it under 200 words.",
      },
      deliverableCriteria: [
        "Says what happened and when in plain terms.",
        "Lists the types of data involved.",
        "Tells customers what steps to take, including watching for phishing.",
        "Gives a way to get help.",
      ],
    }),
    inject({
      title: "Vendor review",
      scenarioOffsetMin: 8640,
      plannedDelayMin: 8,
      objectiveKeys: ["o2", "o4"],
      expectedActions: [
        {
          team: LEGAL,
          actions: ["Sends attorney general notices before state deadlines", "Keeps a log of each notice sent", "Checks that facts match across all notices"],
        },
        {
          team: SEC,
          actions: ["Sets a test ring for vendor updates", "Limits vendor agent network access", "Names an owner for vendor risk reviews"],
        },
        {
          team: EXEC,
          actions: ["Brings a written report to the board", "Lists open legal exposure", "Assigns owners and dates to vendor risk changes"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 09:00. Customer questions to the support line are routine. Quillon confirms the attacker was in its build system for five weeks.\n\n" +
            "The attorney general notices are drafted. State deadlines range from 30 to 45 days. The board meets tomorrow.",
          consequenceText: "Press coverage has mentioned Calloway only in passing.",
        },
        degrading: {
          narrativeMd:
            "Monday 09:00. The support line has a backlog and some customers say they are confused about what happened. Quillon confirms the attacker was in its build system for five weeks.\n\n" +
            "The attorney general notices are drafted. The board meets tomorrow.",
          consequenceText: "Some customers are closing their accounts, and the support backlog is a day long.",
        },
        critical: {
          narrativeMd:
            "Monday 09:00. Many customers learned of the breach from the news first. Phishing using the stolen order data continues. Quillon confirms the attacker was in its build system for five weeks.\n\n" +
            "The attorney general notices are drafted. The board meets tomorrow.",
          consequenceText: "The class action now claims Calloway failed to vet its vendor.",
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The attorney general notices are drafted. What do you do with them?",
          discussionPrompt: "How would you keep the facts consistent across every notice you send?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Send each notice on the state's last allowed day, to give the investigation the most time.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Each notice is scheduled for the last allowed day.",
              rationale: "Most laws say without unreasonable delay. The outer deadline is a limit, not a target, and regulators notice.",
            },
            {
              id: "b",
              text: "Send all attorney general notices this week with consistent facts, and log what went where and when.",
              quality: ["great", "great", "great"],
              followUp: "All attorney general notices went out with a log.",
              rationale: "Prompt, consistent notices with a record are what regulators and later litigation will test.",
              clocks: [{ key: "state_ag", action: "met" }],
            },
            {
              id: "c",
              text: "Hold the notices until the class action is resolved, so nothing sent conflicts with the litigation.",
              quality: ["bad", "bad", "bad"],
              followUp: "The notices are on hold for the class action.",
              rationale: "Litigation does not suspend statutory notice duties. Holding notices adds violations to the suit.",
            },
            {
              id: "d",
              text: "Send one standard notice to every state this week, without resident counts, and add counts on request.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "A standard notice without resident counts went to every state.",
              rationale: "Meets timing, but many states require the number of residents affected, so a generic notice can be deficient.",
              clocks: [{ key: "state_ag", action: "met" }],
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "How do you change the way Calloway trusts vendor updates?",
          discussionPrompt: "Which vendor agents in your environment can reach the internet freely today?",
          capabilityKeys: ["GV.SC", "PR.PS"],
          options: [
            {
              id: "a",
              text: "Stop all automatic updates from every vendor and approve each one by hand before it installs.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "All automatic vendor updates are stopped, including security patches.",
              rationale: "Slows security patches across the board and does not scale. A test ring gets the benefit at lower cost.",
            },
            {
              id: "b",
              text: "Send Quillon a detailed security questionnaire and close the issue once its answers are reviewed.",
              quality: ["bad", "bad", "bad"],
              followUp: "Quillon got a questionnaire and the issue was closed.",
              rationale: "A questionnaire would not have caught a build system compromise and changes nothing on Calloway's side.",
            },
            {
              id: "c",
              text: "Stage vendor updates in a test ring, limit each vendor agent's network access, and monitor it.",
              quality: ["great", "great", "great"],
              followUp: "Vendor updates now go through a test ring with limited network access.",
              rationale: "Limits what a poisoned update can reach and gives time to spot it, in line with NIST SP 800-161.",
            },
            {
              id: "d",
              text: "Review every vendor with privileged access and rank them by risk, starting with order systems.",
              quality: ["good", "good", "good"],
              followUp: "A ranked review of privileged vendors is underway.",
              rationale: "Good prioritization, but a review alone does not change how updates are trusted.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The board meets tomorrow. What do you bring?",
          discussionPrompt: "What would your board need to see to be confident this will not happen again?",
          capabilityKeys: ["GV.OV", "GV.SC"],
          options: [
            {
              id: "a",
              text: "A short written report on what happened, costs, notices, legal exposure, and vendor changes with owners.",
              quality: ["great", "great", "good"],
              followUp: "The board got a written report with owners and dates.",
              rationale: "Gives the board what it needs to oversee the response and the fixes, with clear accountability.",
            },
            {
              id: "b",
              text: "A verbal update that makes clear Quillon's build system, not Calloway, was the source of the breach.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board heard a verbal update blaming Quillon.",
              rationale: "Blame does not help oversight, and the class action is about Calloway's own vendor diligence.",
            },
            {
              id: "c",
              text: "A request to postpone the update until the investigation closes and the full costs are known.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The board update was postponed.",
              rationale: "The board needs interim facts to oversee live legal and regulatory exposure.",
            },
            {
              id: "d",
              text: "A briefing by outside counsel and the forensic firm, with management available for questions.",
              quality: ["good", "good", "neutral"],
              followUp: "Outside counsel and the forensic firm briefed the board.",
              rationale: "Expert detail helps, but management should own the account and the plan going forward.",
            },
          ],
        },
      ],
    }),
  ],
};

export const CRISISSIM_SEED_TEMPLATES: readonly SeedTemplate[] = [PRACTICE, RANSOMWARE, THIRD_PARTY];
