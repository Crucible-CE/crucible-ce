// Crisis Sim: Qilin style ransomware at a three-hospital health system.
// Grounded in the Sophos (2024-08-22) and Trend Micro (2025-10) Qilin
// reporting, the Synnovis (2024) and Change Healthcare (2024) cases, HIPAA
// breach notification and EMTALA diversion rules, as summarized in the
// October 2026 threat brief and its addendum. Matches
// playbooks/ransomware-extortion.md (sections 7, 9, 12 and 14). All names
// are fictional; IP addresses are RFC 5737.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const HOSPITAL_RANSOMWARE_TEMPLATE_ID = "lib-general-crisissim-hospital-ransomware";

const ORG = "Corvane Valley Health";
const DOMAIN = "corvanehealth.example";
const EXEC = "Executive";
const CLIN = "Clinical Operations";
const SEC = "IT and Security";
const LEGAL = "Legal and Privacy";

const CLOCKS = {
  insurer: { key: "insurer_notice", label: "Cyber insurer notice (policy: 48 hours)", durationHours: 48 },
  hipaa: { key: "hipaa_60d", label: "HIPAA notice to individuals and HHS (45 CFR 164.404 and 164.408, 60 days)", durationHours: 60 * 24 },
  stateAg: { key: "state_ag", label: "Texas attorney general notice (30 days, 250 or more residents)", durationHours: 30 * 24 },
} as const;

const PROFILE =
  `**${ORG}** is a nonprofit health system in central Texas with three hospitals, 610 beds, about 4,200 staff and 30 clinics. ` +
  "The flagship, Corvane Valley Medical Center, is a Level II trauma center and a primary stroke center. " +
  "Clinical systems run on premises: the EHR, laboratory, pharmacy dispensing and imaging archive sit on a VMware cluster in the main data center, with backups to an on-premises appliance and a weekly immutable copy in cloud object storage. " +
  "Clinicians and contractors reach the network through an SSL VPN. Identity is on-premises Active Directory synced to Entra ID for Microsoft 365. " +
  "The system exchanges results with a regional health information exchange and an outside reference lab.";

const RANSOM_NOTE = {
  id: "a1",
  kind: "ransom_note" as const,
  title: "Ransom note on the EHR application server",
  from: "Unknown",
  sentAt: "Saturday 01:58",
  content: [
    "--- README-CORVANE.txt ---",
    "",
    "Corvane Valley Health. Your servers and hypervisors are encrypted. We also took your files, including patient records.",
    "",
    "Contact us within 72 hours or we publish the data and send it to your patients and local news.",
    "",
    "Do not restore or shut down systems. Do not hire people who will waste your time.",
    "",
    "Chat: [onion link]   ID: cvh-2c91",
  ].join("\n"),
};

const EDR_LOG = {
  id: "a2",
  kind: "log_excerpt" as const,
  title: "Last events before EDR went silent",
  from: "Security operations",
  sentAt: "Saturday 02:05",
  content: [
    "```",
    "01:31:04  CVH-FS03   System 7045   ServiceName=eskle  ImagePath=C:\\Windows\\Temp\\eskle.sys  ServiceType=kernel mode driver",
    "01:32:50  CVH-FS03   Security 1102 The audit log was cleared  SubjectUserName=adm-rcole",
    "01:36:12  EDR        sensor=inactive  devices=47",
    "01:49:30  CVH-ESX02  vmkernel      host not responding",
    "01:55:41  CVH-EHRAPP1  file=D:\\ehr\\README-CORVANE.txt  created",
    "```",
  ].join("\n"),
};

const EMS_EMAIL = {
  id: "a1",
  kind: "email" as const,
  title: "Regional EMS coordinator",
  from: "Regional EMS coordinator",
  sentAt: "Saturday 04:25",
  content:
    `**From:** EMS duty officer <dutyofficer@centraltexasems.example>\n**To:** ED charge nurse <ed.charge@${DOMAIN}>\n**Subject:** Your status tonight\n\n` +
    "Two crews report your ED cannot pull up prior records and CT reads are delayed. We have a STEMI and a possible stroke inbound in the next 30 minutes. Are you on diversion, and for which services? I need an answer I can put on the board.",
};

const IR_TIMELINE = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Incident response first timeline",
  from: "Outside incident response firm",
  sentAt: "Sunday 08:30",
  content: [
    "```",
    "Day 0   23:41  SSLVPN  user=ctr-mlopez  src=203.0.113.48  auth=password  mfa=none  result=success",
    "Day 14  02:12  CVH-DC01  Security 5136  Default Domain Policy changed  SubjectUserName=adm-rcole",
    "Day 14  02:14  SYSVOL\\Policies\\{31B2F340-...}\\User\\Scripts\\Logon\\IPScanner.ps1 created",
    "Day 15  07:50  SYSVOL\\scripts\\out\\CVH-WS-1188.log  size=22 KB",
    "Day 16  01:10  CVH-FS03  rclone  dest=198.51.100.91  bytes=1.1 TB over 31 hours",
    "Day 19  01:31  eskle.sys installed, encryption begins",
    "```",
  ].join("\n"),
};

const CHAT_PRICE = {
  id: "a1",
  kind: "chat" as const,
  title: "Attacker negotiation chat",
  from: "Attacker portal",
  sentAt: "Monday 08:40",
  content:
    "**support** 08:40\n\nCorvane. Price is $6,000,000 in Bitcoin. If you pay by Thursday we give the decryptor and delete your files. After Thursday the price is $9,000,000 and we start posting.\n\nProof attached: 200 rows from your behavioral health clinic. Your board should see this.",
};

const LEAK_POST = {
  id: "a1",
  kind: "social_post" as const,
  title: "Leak site listing",
  from: "Leak site",
  sentAt: "Tuesday 22:00",
  content:
    "**Corvane Valley Health (Texas, USA)**\n\nThree hospitals. Part 1: 210 GB. Patients, behavioral health notes, insurance, employee payroll.\n\nThey chose not to protect their patients. Part 2 in 5 days.",
};

const REPORTER = {
  id: "a2",
  kind: "email" as const,
  title: "Reporter asks about patient data",
  from: "Central Texas Ledger",
  sentAt: "Wednesday 08:15",
  content:
    "**From:** Mara Ostrowski <mostrowski@ctxledger.example>\n**Subject:** Corvane patient records online\n\nA ransomware site has posted files it says are Corvane patient records, including behavioral health notes. Have patients been told? Did Corvane pay? Filing at 14:00.",
};

const HOSPITAL_RANSOMWARE: LibraryCrisisSimTemplate = {
  id: HOSPITAL_RANSOMWARE_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Ransomware at a three-hospital health system",
  summary:
    "Qilin style ransomware encrypts the EHR, lab and imaging servers of a nonprofit health system at 02:00 on a Saturday. Four teams decide on downtime and ambulance diversion, network isolation, the ransom, and HIPAA notice while patient records leak.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, CLIN, SEC, LEGAL],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 6, time: "02:10" },
    orgName: ORG,
    threatActorKey: "qilin",
    replayKey: "synnovis-2024",
    industryKey: "healthcare-provider",
    capabilityKeys: ["RS.MA", "RS.MI", "RS.AN", "RS.CO", "RC.RP", "RC.CO", "GV.RR", "GV.OC"],
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.hipaa, CLOCKS.stateAg],
    executiveBriefMd: [
      PROFILE,
      "",
      "At 01:36 on Saturday the endpoint security console stopped hearing from 47 servers. By 02:05 the EHR, the laboratory system and the imaging archive are unreachable, two ESXi hosts are down, and a ransom note sits on the EHR application server.",
      "",
      "The Executive, Clinical Operations, IT and Security, and Legal and Privacy teams make decisions over eleven days of simulated time. Three clocks can start: cyber insurer notice, HIPAA notice to individuals and HHS, and Texas attorney general notice.",
      "",
      "Use your own incident response and downtime plans. The library playbook for this scenario is Ransomware and extortion response, including section 14 on patient care, diversion and HIPAA.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Start downtime procedures in every hospital within 30 minutes and keep clinical command separate from technical command.", capabilityKeys: ["RS.MA", "RC.CO"] },
    { key: "o2", text: "Make and record a diversion decision by service line, with EMS and nearby hospitals told and a review time set.", capabilityKeys: ["RS.MA", "GV.RR"] },
    { key: "o3", text: "Isolate the network and protect surviving backups before any restore, with the decision and time recorded.", capabilityKeys: ["RS.MI", "RC.RP"] },
    { key: "o4", text: "Make a documented ransom decision with OFAC screening, insurer consent, FBI input and board approval.", capabilityKeys: ["GV.RR", "GV.OC"] },
    { key: "o5", text: "Record the HIPAA discovery date and send notices on time, with what is known and a supplement plan.", capabilityKeys: ["GV.OC", "RS.CO"] },
  ],
  injects: [
    inject({
      title: "Downtime at 02:10",
      scenarioOffsetMin: 0,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o3"],
      clockTriggers: [CLOCKS.insurer.key],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Isolates encrypted and suspect hosts with EDR or at the switch, and leaves them powered on",
            "Takes the backup appliance off the domain network and checks the immutable cloud copy",
            "Disables the VPN for contractors and the account adm-rcole",
          ],
        },
        { team: CLIN, actions: ["Starts paper downtime procedures in all three hospitals", "Activates hospital incident command with a clinical lead"] },
        { team: EXEC, actions: ["Declares an incident and names an incident commander", "Sets an update cadence and an out-of-band bridge"] },
        { team: LEGAL, actions: ["Engages outside counsel and has counsel retain the IR firm", "Notifies the cyber insurer", "Records the time the organization first knew"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Saturday 02:10. The night security analyst saw 47 endpoint sensors go silent at 01:36 and called the on-call engineer, who called the CIO. The EHR, lab system and imaging archive are down. Two ESXi hosts do not respond. A ransom note is on the EHR application server.\n\n" +
            "**Known:** a kernel driver named eskle.sys was installed as a service minutes before the sensors went quiet. The weekly immutable backup copy in cloud storage is from Wednesday.\n\n" +
            "**Unknown:** how the attacker got in, and whether data was taken.\n\n" +
            "**Assumed:** any domain account may be compromised.",
          artifacts: [RANSOM_NOTE, EDR_LOG],
        },
        degrading: {
          narrativeMd:
            "Saturday 02:10. Nurses on three units call the help desk because the EHR is down. The help desk opens a ticket and pages the on-call engineer, who finds two ESXi hosts unresponsive and a ransom note on the EHR application server. Nobody looked at the endpoint console, where 47 sensors went silent at 01:36.\n\n" +
            "**Known:** the lab and imaging systems are also down.\n\n" +
            "**Unknown:** whether the backup appliance, which is joined to the domain, is still intact.",
          artifacts: [RANSOM_NOTE, EDR_LOG],
        },
        critical: {
          narrativeMd:
            "Saturday 02:10. The ED charge nurse calls the house supervisor: no EHR, no lab results, no images. The on-call engineer rebooted two ESXi hosts at 01:55 trying to fix them; they came back encrypted. The backup appliance console shows its jobs were deleted at 01:22.\n\n" +
            "**Known:** a ransom note is on the EHR application server. Endpoint sensors on 47 servers went silent at 01:36.\n\n" +
            "**Unknown:** whether any backup copy survived.",
          consequenceText: "The reboot destroyed memory evidence and the on-premises backups are gone. Recovery depends on the cloud copy.",
          artifacts: [RANSOM_NOTE, EDR_LOG],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CIO",
          stem: "Encryption has reached the EHR, lab and imaging servers. What do you do in the next 30 minutes?",
          discussionPrompt: "Which of your backup copies can a domain admin delete, and who on call knows how to protect the rest?",
          capabilityKeys: ["RS.MI", "RC.RP"],
          options: [
            {
              id: "a",
              text: "Isolate affected hosts and leave them on, pull the backup appliance off the domain, lock the cloud copy.",
              quality: ["great", "great", "great"],
              followUp: "Affected hosts are isolated and still powered. The backup appliance is off the domain and the cloud copy is locked.",
              rationale: "Protecting surviving backups comes before restoring anything, and powered hosts keep memory evidence and keys.",
            },
            {
              id: "b",
              text: "Shut down every server and ESXi host in the data center at once so encryption cannot spread further tonight.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "Every server and host is off. Encryption has stopped and so has every clinical system that was still running.",
              rationale: "A full shutdown stops spread but takes down working systems and destroys memory. Defensible only if isolation is impossible.",
            },
            {
              id: "c",
              text: "Restore the EHR from last night's backup on the appliance now, so clinicians have records by the morning.",
              quality: ["bad", "bad", "bad"],
              followUp: "A restore from the appliance has started on hosts the attacker still controls.",
              rationale: "Restoring onto a live intrusion, from a backup the attacker could reach, invites a second encryption.",
            },
            {
              id: "d",
              text: "Isolate the encrypted hosts and disable the VPN, and check the backup appliance after the IR firm arrives.",
              quality: ["good", "neutral", "bad"],
              followUp: "Encrypted hosts are isolated and the VPN is off. The backup appliance is still on the domain.",
              rationale: "Isolation and closing the VPN are right, but backups on the domain are the next thing ransomware crews delete.",
            },
          ],
        },
        {
          team: CLIN,
          decisionOwner: "Chief nursing officer",
          stem: "No EHR, lab results or images in three hospitals. What do clinical leaders do first?",
          discussionPrompt: "When did your units last run a full downtime drill, and where are the downtime kits tonight?",
          capabilityKeys: ["RS.MA", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Start paper downtime in all three hospitals, open hospital incident command, and send runners for lab results.",
              quality: ["great", "great", "great"],
              followUp: "Downtime procedures are running in all three hospitals and hospital incident command is open.",
              rationale: "Downtime procedures and clinical command protect patients while IT works. They are the first clinical action.",
            },
            {
              id: "b",
              text: "Wait for IT to say how long the outage will last before switching units to paper, to avoid a double entry.",
              quality: ["bad", "bad", "bad"],
              followUp: "Units are waiting for an estimate. Medication passes at 06:00 have no current records.",
              rationale: "Nobody can estimate a ransomware outage at 02:00. Waiting leaves patients without records at the next med pass.",
            },
            {
              id: "c",
              text: "Start downtime in the flagship only, since the two smaller hospitals have fewer inpatients overnight.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The flagship is on downtime procedures. The two smaller hospitals are improvising.",
              rationale: "All three hospitals share the same EHR. Partial downtime leaves two hospitals without a process.",
            },
            {
              id: "d",
              text: "Start downtime everywhere and have the house supervisor coordinate, with clinical command set up at 07:00.",
              quality: ["good", "good", "neutral"],
              followUp: "Downtime is running everywhere. Clinical command will open at 07:00.",
              rationale: "Downtime is right. Waiting five hours for command leaves the night without one clinical decision maker.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The CIO calls you at 02:20. What do you set in motion tonight?",
          discussionPrompt: "Who can cut the internet and partner links without asking you, and is that written down?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Declare an incident, name the CISO incident commander, open an out-of-band bridge and meet every four hours.",
              quality: ["great", "great", "great"],
              followUp: "An incident is declared, the CISO commands, and the executive bridge meets every four hours.",
              rationale: "A named commander, a cadence and a channel the attacker cannot see are what every later decision depends on.",
            },
            {
              id: "b",
              text: "Ask the CIO to call back at 07:00 with a full picture so the executive team can decide with complete facts.",
              quality: ["bad", "bad", "bad"],
              followUp: "The executive team will hear more at 07:00.",
              rationale: "Complete facts will not exist for days. The night is when containment and downtime decisions matter most.",
            },
            {
              id: "c",
              text: "Call the board chair now and ask the board to approve any payment needed to get the EHR back by Monday.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board chair has been asked to approve a payment before anyone knows the facts.",
              rationale: "A ransom decision needs OFAC screening, insurer consent, FBI input and a restore estimate. None exist at 02:20.",
            },
            {
              id: "d",
              text: "Have the CIO run the response tonight and bring in the IR retainer, with the executive team meeting at 08:00.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The CIO is running the response and the IR retainer is engaged. Executives meet at 08:00.",
              rationale: "Engaging the retainer is sound, but without a declared incident and a commander, clinical and IT decisions drift.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Nothing confirms patient data was taken yet. What does Legal and Privacy do tonight?",
          discussionPrompt: "Who records the time the organization knew, and where is it written?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Engage breach counsel, have counsel retain the IR firm, notify the insurer, and log the time of first knowledge.",
              quality: ["great", "great", "great"],
              followUp: "Counsel is engaged and retained the IR firm, the insurer has notice, and the first known time is logged.",
              rationale: "Insurer notice is often a condition of cover, and counsel directed forensics keeps privilege.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
            {
              id: "b",
              text: "Hold off on counsel and the insurer until forensics shows whether any patient data was accessed or copied.",
              quality: ["bad", "bad", "bad"],
              followUp: "Counsel and the insurer have not been contacted.",
              rationale: "Pre-notice costs may be denied, and forensic work started without counsel may not be privileged.",
            },
            {
              id: "c",
              text: "Draft a patient notice tonight saying records may have been exposed, so it is ready to post by the morning.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "A draft patient notice exists. It says more than anyone knows.",
              rationale: "Notices will be needed, but a draft written before any facts tends to leak or be wrong.",
            },
            {
              id: "d",
              text: "Notify the insurer tonight through its hotline and plan to engage breach counsel from its panel on Monday.",
              quality: ["good", "good", "neutral"],
              followUp: "The insurer has notice. Breach counsel will be engaged on Monday.",
              rationale: "Insurer notice is right. Two days of forensics without counsel risks privilege.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Ambulances inbound",
      scenarioOffsetMin: 150,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o3"],
      clockTriggers: [CLOCKS.hipaa.key],
      expectedActions: [
        {
          team: CLIN,
          actions: [
            "Decides diversion by service line based on what the outage breaks",
            "Tells EMS and nearby hospitals and sets a time to review",
            "Keeps screening and stabilizing anyone who arrives",
          ],
        },
        {
          team: SEC,
          actions: ["Cuts internet egress and the HIE and reference lab links, and tells each partner by phone", "Keeps the out-of-band bridge and safety systems connected"],
        },
        { team: EXEC, actions: ["Approves the network cut and records the time and reason", "Approves a holding statement for staff and media"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Saturday 04:40. Downtime procedures are running. CT scans can be taken but not read remotely, and lab results come back by runner in about 70 minutes instead of 20. The EMS coordinator asks whether the flagship is on diversion. A STEMI and a possible stroke are inbound.\n\n" +
            "**Known:** the EHR database server is encrypted, so patient records were in reach. The site-to-site links to the health information exchange and the reference lab are still up.\n\n" +
            "**Unknown:** whether the attacker still has access.",
          artifacts: [EMS_EMAIL],
        },
        degrading: {
          narrativeMd:
            "Saturday 04:40. Two units are still improvising without downtime forms. Lab results take about 90 minutes by runner. CT scans cannot be read remotely. The EMS coordinator asks whether the flagship is on diversion, with a STEMI and a possible stroke inbound.\n\n" +
            "**Known:** the EHR database server is encrypted. The links to the health information exchange and the reference lab are still up, and the reference lab has called to ask why its interface is failing.\n\n" +
            "**Unknown:** whether the attacker still has access.",
          artifacts: [EMS_EMAIL],
        },
        critical: {
          narrativeMd:
            "Saturday 04:40. The ED has 31 patients and no current records. A nurse gave a medication from memory of the last order; pharmacy caught a dose error. Lab results take about two hours. A local TV station has posted that ambulances are being turned away, which is not yet true.\n\n" +
            "**Known:** the EHR database server is encrypted. Outbound traffic from a file server to 198.51.100.91 is still running.\n\n" +
            "**Unknown:** what is in that traffic.",
          consequenceText: "Data may still be leaving, and patient safety is now at risk in the ED.",
          artifacts: [EMS_EMAIL],
        },
      },
      questions: [
        {
          team: CLIN,
          decisionOwner: "Chief medical officer",
          stem: "EMS wants an answer on diversion for the flagship. What do you decide?",
          discussionPrompt: "What does your outage actually break for stroke, STEMI and trauma, and who decides diversion at 04:40?",
          capabilityKeys: ["RS.MA", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Divert stroke and trauma for four hours, keep STEMI open, tell EMS and nearby hospitals, review at 08:30.",
              quality: ["great", "great", "good"],
              followUp: "Stroke and trauma are on diversion for four hours. STEMI stays open. EMS and nearby hospitals know, with a review at 08:30.",
              rationale: "Diversion by service line matches what the outage breaks. Imaging reads matter for stroke; the cath lab still works.",
            },
            {
              id: "b",
              text: "Go on full diversion for all ambulance traffic until the EHR is back, and turn away walk-in patients too.",
              quality: ["bad", "bad", "bad"],
              followUp: "The flagship told EMS it is on full diversion and staff are turning walk-ins away.",
              rationale: "Anyone who arrives must be screened and stabilized. Turning walk-ins away breaks the rule diversion depends on.",
            },
            {
              id: "c",
              text: "Stay fully open, since diversion would push patients to hospitals 40 minutes away and may harm them more.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The flagship stays open for all traffic, including stroke patients whose scans cannot be read remotely.",
              rationale: "Staying open is reasonable when downtime is working, but stroke care without timely reads is a real risk.",
            },
            {
              id: "d",
              text: "Divert stroke only, keep everything else open, and ask the stroke neurologist to come in and read on site.",
              quality: ["good", "good", "great"],
              followUp: "Stroke is on diversion and the neurologist is coming in. Trauma and STEMI stay open.",
              rationale: "A narrow diversion with an on-site read restores stroke capacity fastest, especially when the ED is strained.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "Incident commander",
          stem: "The partner links and internet egress are still up. What do you do with them?",
          discussionPrompt: "Which connections are needed for safety, and does every partner have a number you can call at 04:40?",
          capabilityKeys: ["RS.MI", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Cut internet egress and the HIE and lab links now, keep the bridge and safety systems, call each partner.",
              quality: ["great", "great", "great"],
              followUp: "Egress and partner links are cut, safety systems and the bridge stay up, and each partner had a call.",
              rationale: "Cutting links protects partners and stops any data still leaving. Calling first keeps their trust.",
            },
            {
              id: "b",
              text: "Leave every link up so the reference lab can keep sending results, which clinicians need tonight.",
              quality: ["bad", "bad", "bad"],
              followUp: "All links stay up. The lab interface is failing anyway because the receiving server is encrypted.",
              rationale: "An open link to an encrypted, attacker controlled network risks the partner and gains nothing.",
            },
            {
              id: "c",
              text: "Cut the internet but leave the HIE and lab links up, because partners will ask questions if links drop.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Internet egress is cut. The HIE and lab links are still up.",
              rationale: "Partner links are a path into their networks. Avoiding awkward questions is not a reason to keep them.",
            },
            {
              id: "d",
              text: "Cut the HIE and lab links and block the IP seen in outbound traffic, and review full egress at 08:00.",
              quality: ["good", "neutral", "neutral"],
              followUp: "Partner links are cut and one IP is blocked. Other egress is still open.",
              rationale: "Protecting partners is right. Blocking one IP leaves other exfiltration and command paths open.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Staff are asking questions and local TV is calling. What do you approve?",
          discussionPrompt: "Who approves public statements on a Saturday night, and do clinicians hear before the public?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "A short staff note and a holding statement: outage, downtime running, care continues, no detail on cause.",
              quality: ["great", "great", "great"],
              followUp: "Staff got a note and a holding statement went to media. It says care continues under downtime procedures.",
              rationale: "A short, true statement that staff hear first limits rumor without saying anything that may be wrong.",
            },
            {
              id: "b",
              text: "No comment to anyone until Monday, so nothing said now has to be corrected later by the lawyers.",
              quality: ["bad", "bad", "bad"],
              followUp: "There is no statement. Local TV reports that ambulances are being turned away.",
              rationale: "Silence lets the wrong story run, and patients may avoid the ED when they need it.",
            },
            {
              id: "c",
              text: "A statement naming a cyberattack by a ransomware group and saying no patient data was taken.",
              quality: ["bad", "bad", "bad"],
              followUp: "The statement says no patient data was taken.",
              rationale: "Nobody knows whether data was taken. A claim that later proves false damages trust and invites regulators.",
            },
            {
              id: "d",
              text: "A staff note tonight and a media statement after the 08:00 bridge, once diversion status is settled.",
              quality: ["good", "neutral", "neutral"],
              followUp: "Staff have a note. Media will get a statement after 08:00.",
              rationale: "Staff first is right. Waiting on media lets the diversion rumor run through the morning news.",
            },
          ],
        },
      ],
      deliverable: {
        team: EXEC,
        kind: "holding_statement",
        prompt: "Write the holding statement for media and the public. Say what is affected, that care continues, and what patients should do. Keep it under 120 words.",
      },
      deliverableCriteria: [
        "States that systems are disrupted and care continues under backup procedures",
        "Tells patients with emergencies to come to the ED or call 911",
        "Does not claim no data was taken or name a group",
        "Says when the next update will come",
      ],
    }),
    inject({
      title: "Nineteen days inside",
      scenarioOffsetMin: 1850,
      plannedDelayMin: 10,
      objectiveKeys: ["o3", "o5"],
      expectedActions: [
        {
          team: LEGAL,
          actions: [
            "Treats the encryption and the 1.1 TB transfer as a presumed HIPAA breach",
            "Records discovery as Saturday 01:36 or earlier and its basis",
            "Plans notices with known facts and a supplement date",
          ],
        },
        {
          team: SEC,
          actions: ["Treats every Chrome stored credential as compromised", "Resets krbtgt twice and rotates service and admin passwords", "Tells partners whose portal credentials were saved"],
        },
        { team: CLIN, actions: ["Starts a review of results that may have been missed during downtime", "Reports patient safety events through the normal process"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Sunday 09:00. The IR firm has a first timeline. Nineteen days ago a contractor VPN account without MFA logged in from **203.0.113.48**. Fourteen days later the attacker edited the Default Domain Policy to run a logon script that copied Chrome stored passwords from every machine. Two days after that, rclone sent about **1.1 TB** from a file server to **198.51.100.91** over 31 hours.\n\n" +
            "**Known:** the immutable cloud copy from Wednesday is clean and restorable. The file server held scanned records, behavioral health clinic notes and HR files.\n\n" +
            "**Unknown:** exactly whose records are in the 1.1 TB.",
          artifacts: [IR_TIMELINE],
        },
        degrading: {
          narrativeMd:
            "Sunday 09:00. The IR firm has a first timeline: a contractor VPN account without MFA, a GPO logon script that harvested Chrome stored passwords, and about **1.1 TB** sent to **198.51.100.91** over 31 hours.\n\n" +
            "**Known:** the immutable cloud copy from Wednesday is restorable. The file server held scanned records, behavioral health notes and HR files. Saved passwords include portals for the reference lab, two payers and the state immunization registry.\n\n" +
            "**Unknown:** whether the attacker used any of those portal passwords.",
          artifacts: [IR_TIMELINE],
        },
        critical: {
          narrativeMd:
            "Sunday 09:00. The IR firm's first timeline shows a contractor VPN account without MFA, a GPO logon script that harvested Chrome stored passwords, and about **1.1 TB** sent to **198.51.100.91**. Encryption ran on the on-premises backup appliance too.\n\n" +
            "**Known:** the only clean copy is the immutable cloud backup from Wednesday. A nurse manager reports that two critical potassium results from Saturday morning reached the floor four hours late.\n\n" +
            "**Unknown:** whether other results were missed.",
          consequenceText: "Patient safety events are now part of the incident record.",
          artifacts: [IR_TIMELINE],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "Encryption reached systems with ePHI and data left the network. How do you treat this under HIPAA?",
          discussionPrompt: "Which alert or event sets your discovery date, and could a regulator say you should have known earlier?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Treat it as a breach under the ransomware presumption, set discovery at Saturday 01:36, plan notices now.",
              quality: ["great", "great", "great"],
              followUp: "The breach is presumed, discovery is set at Saturday 01:36, and notice planning has started.",
              rationale: "Encryption of ePHI is a presumed breach unless a four-factor assessment shows low probability, and theft confirms it.",
            },
            {
              id: "b",
              text: "Wait for the full forensic report before deciding whether this is a reportable breach, likely four to six weeks.",
              quality: ["bad", "bad", "bad"],
              followUp: "The breach decision waits for the forensic report.",
              rationale: "The 60 day clock runs from discovery, not from the forensic report. Waiting can use most of it.",
            },
            {
              id: "c",
              text: "Run a four-factor risk assessment first, since encryption alone may not mean records were viewed or taken.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "A four-factor assessment is under way. The 1.1 TB transfer is noted as a factor.",
              rationale: "The assessment is the right tool for encryption alone, but a 1.1 TB transfer makes a low probability finding unlikely.",
            },
            {
              id: "d",
              text: "Treat it as a breach, set discovery at Sunday 09:00 when theft was confirmed, and plan notices from there.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The breach is treated as such with discovery on Sunday at 09:00.",
              rationale: "Treating it as a breach is right, but discovery is when anyone knew or should have known, which was Saturday.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "Incident commander",
          stem: "Every Chrome stored password on a domain machine is now known to the attacker. What do you reset first?",
          discussionPrompt: "Do you know which outside portals your staff saved passwords for, and who owns telling those partners?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Reset krbtgt twice, rotate admin and service passwords, and tell partners whose portal logins were saved.",
              quality: ["great", "great", "great"],
              followUp: "krbtgt was reset twice, admin and service passwords rotated, and partners told which logins were exposed.",
              rationale: "Domain trust comes first, and saved partner credentials extend the blast radius to systems you do not own.",
            },
            {
              id: "b",
              text: "Force every user to change their Windows password on next sign-in, which covers the saved credentials.",
              quality: ["bad", "bad", "bad"],
              followUp: "Users will change Windows passwords on next sign-in. Saved portal passwords are unchanged.",
              rationale: "Chrome saved passwords are for other systems. A Windows password change does nothing for them.",
            },
            {
              id: "c",
              text: "Rotate admin and service passwords now, and leave partner portals to each partner to manage on their own.",
              quality: ["good", "neutral", "bad"],
              followUp: "Admin and service passwords are rotated. Partners have not been told about saved logins.",
              rationale: "Rotating admin secrets is right. Partners cannot rotate what they do not know was exposed.",
            },
            {
              id: "d",
              text: "Rebuild Active Directory from scratch this week before any password reset, so nothing is done twice.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "An AD rebuild is planned. No passwords have been reset yet.",
              rationale: "A rebuild may be needed, but leaving harvested credentials valid for a week keeps the attacker's options open.",
            },
          ],
        },
        {
          team: CLIN,
          decisionOwner: "Chief medical officer",
          stem: "A nurse manager reports two critical results that reached the floor late. What do clinical leaders do?",
          discussionPrompt: "How would you find every result that was missed or late during downtime, across three hospitals?",
          capabilityKeys: ["RC.CO", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Start a daily review of late or missed results in all three hospitals and report events through patient safety.",
              quality: ["great", "great", "great"],
              followUp: "A daily review of late results is running in all three hospitals and events are being reported.",
              rationale: "The Synnovis case showed that delayed results can contribute to harm. A daily, system-wide review finds them.",
            },
            {
              id: "b",
              text: "Handle the two results with the unit and keep it quiet, since reporting now would add to the incident's profile.",
              quality: ["bad", "bad", "bad"],
              followUp: "The two late results were handled on the unit. Nothing was reported.",
              rationale: "Patient safety reporting is not optional because of an outage, and hiding events makes the review harder.",
            },
            {
              id: "c",
              text: "Review results at the flagship lab, which handles most critical values, and extend it if more problems appear.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The flagship lab is reviewing its results. The other hospitals are not.",
              rationale: "The flagship is a good start, but critical values are drawn in all three hospitals.",
            },
            {
              id: "d",
              text: "Review late results once systems are restored, when the lab system can produce a full report of turnaround.",
              quality: ["good", "neutral", "bad"],
              followUp: "A results review is planned for after restore.",
              rationale: "A full report helps later, but missed critical values need to be found while patients are still in the hospital.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The price and the board",
      scenarioOffsetMin: 3350,
      plannedDelayMin: 10,
      objectiveKeys: ["o4", "o3"],
      clockTriggers: [CLOCKS.stateAg.key],
      expectedActions: [
        {
          team: EXEC,
          actions: [
            "Puts OFAC screening, insurer consent, FBI input and the restore estimate in front of the board",
            "Records the decision, who made it and why",
            "States that payment would not end notice duties",
          ],
        },
        { team: LEGAL, actions: ["Runs the OFAC screen through counsel", "Confirms insurer consent terms in writing", "Reports to the FBI with indicators"] },
        { team: SEC, actions: ["Gives a written restore estimate by tier without a decryptor", "Sets restore order with clinical leaders"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 10:00. The attacker's chat names **$6 million**, rising to $9 million after Thursday, and attaches 200 rows from the behavioral health clinic. The board meets at 14:00.\n\n" +
            "**Known:** the immutable cloud backup is clean. The IR firm estimates the EHR back in read-only mode in four days and fully in nine. Counsel confirms at least 250 Texas residents are in the stolen files.\n\n" +
            "**Unknown:** whether the attacker would delete the data if paid.",
          artifacts: [CHAT_PRICE],
        },
        degrading: {
          narrativeMd:
            "Monday 10:00. The attacker's chat names **$6 million**, rising to $9 million after Thursday, with 200 behavioral health rows as proof. The board meets at 14:00.\n\n" +
            "**Known:** the cloud backup is clean but restoring three hospitals from it will take about twelve days for the EHR. Counsel confirms at least 250 Texas residents are in the stolen files.\n\n" +
            "**Unknown:** whether a decryptor would be faster, or would work at all.",
          artifacts: [CHAT_PRICE],
        },
        critical: {
          narrativeMd:
            "Monday 10:00. The attacker's chat names **$6 million**, rising to $9 million after Thursday, with 200 behavioral health rows as proof. A board member says the hospital should pay today. The board meets at 14:00.\n\n" +
            "**Known:** the cloud backup is the only clean copy. The EHR restore will take about two weeks. The ED is still on paper and two nurses have resigned citing workload. Counsel confirms at least 250 Texas residents are in the stolen files.\n\n" +
            "**Unknown:** whether the decryptor would work on the ESXi hosts.",
          consequenceText: "Pressure to pay is high and the facts for a sound decision are thin.",
          artifacts: [CHAT_PRICE],
        },
      },
      questions: [
        {
          team: EXEC,
          decisionOwner: "Board chair",
          type: "ransom",
          stem: "What do you recommend to the board at 14:00 on the ransom?",
          discussionPrompt: "What must be true before your board could approve a payment, and who records the decision?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Do not pay while restoring from the clean backup, after OFAC, insurer and FBI input, with the vote recorded.",
              quality: ["great", "good", "good"],
              followUp: "The board decided not to pay, on the record, with OFAC, insurer and FBI input and the restore estimate.",
              rationale: "A clean backup makes recovery possible without paying, and the decision record shows the basis.",
            },
            {
              id: "b",
              text: "Pay before Thursday to get the decryptor and deletion, and handle OFAC screening and the insurer after.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board approved payment before screening or insurer consent.",
              rationale: "Payment to a sanctioned party can violate sanctions on a strict liability basis, and the insurer may refuse cover.",
            },
            {
              id: "c",
              text: "Let the panel negotiator engage to buy time and test the decryptor while restoring, with no payment approved.",
              quality: ["good", "great", "great"],
              followUp: "The panel negotiator is engaged to buy time and test a sample decryption. No payment is approved.",
              rationale: "When restore is slow, buying time and testing the decryptor keeps options open without committing to pay.",
            },
            {
              id: "d",
              text: "Refuse to discuss payment at all and tell the attacker publicly that the health system will never pay.",
              quality: ["bad", "bad", "bad"],
              followUp: "The health system publicly refused. The attacker moved its publication date up.",
              rationale: "Refusing may be right, but a public taunt invites earlier publication and gains nothing.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The board wants the legal position on payment before 14:00. What do you put in front of it?",
          discussionPrompt: "Who runs your OFAC screen, and how long does it take on a Monday morning?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "OFAC screen by counsel, insurer consent terms in writing, FBI report and notice duties that payment won't end.",
              quality: ["great", "great", "great"],
              followUp: "The board has the OFAC screen, the insurer's written terms, the FBI report and the notice duties.",
              rationale: "These are the conditions any payment decision rests on, and payment does not change notice duties.",
            },
            {
              id: "b",
              text: "Advise that payment is legal if made through a crypto broker, so the hospital is not paying the attacker directly.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board was told a broker makes payment legal.",
              rationale: "Paying through an intermediary does not remove sanctions risk. Liability is strict.",
            },
            {
              id: "c",
              text: "Give the board the insurer's consent terms and leave the OFAC screen until a payment amount is agreed.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The board has the insurer's terms. No OFAC screen has been run.",
              rationale: "Screening after a deal is struck is too late to shape it, and the insurer will ask for it anyway.",
            },
            {
              id: "d",
              text: "Report to the FBI and screen with OFAC, and brief the board orally so nothing is put in writing for discovery.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The FBI has a report and the OFAC screen is done. The board was briefed orally.",
              rationale: "The steps are right, but a board decision without a written basis is hard to defend later.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CIO",
          stem: "The board asks how long recovery takes without paying. What do you give it?",
          discussionPrompt: "Has anyone timed a full restore of your EHR from your offsite copy?",
          capabilityKeys: ["RC.RP"],
          options: [
            {
              id: "a",
              text: "A written estimate by tier with assumptions, built with clinical leaders: EHR read-only first, then lab.",
              quality: ["great", "great", "great"],
              followUp: "The board has a written restore estimate by tier, with clinical priorities and stated assumptions.",
              rationale: "A tiered, written estimate tied to clinical priorities is what a ransom decision needs to weigh.",
            },
            {
              id: "b",
              text: "Tell the board two days, to take pressure off the payment question, and correct the number later if needed.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board heard two days.",
              rationale: "An optimistic number given to steer a decision undermines the board's ability to decide.",
            },
            {
              id: "c",
              text: "Say it cannot be estimated until every server has been examined, which the IR firm will finish next week.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "The board has no estimate.",
              rationale: "A range with assumptions is possible now. Without one the board cannot weigh the decryptor.",
            },
            {
              id: "d",
              text: "Give one estimate for full EHR recovery from the backup, and leave the order of other systems to IT.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The board has one estimate for the EHR. Other systems will come back in IT's order.",
              rationale: "An EHR number helps, but restore order is a clinical and executive decision, not only IT's.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Behavioral health notes online",
      scenarioOffsetMin: 16310,
      plannedDelayMin: 10,
      objectiveKeys: ["o5", "o1"],
      expectedActions: [
        {
          team: LEGAL,
          actions: [
            "Sends individual notices for confirmed patients now and plans supplements",
            "Notifies HHS and prominent media at the same time as individuals for 500 or more",
            "Files the Texas attorney general notice",
          ],
        },
        { team: EXEC, actions: ["Answers the ransom question truthfully without negotiation details", "Opens a patient call center and FAQ"] },
        { team: CLIN, actions: ["Validates restored records with clinicians before go-live", "Plans back entry of paper records with a deadline"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 10:00. Day 12. The leak site posted **210 GB** last night, including behavioral health notes, insurance cards and employee payroll. The EHR is back read-only; full go-live is planned for Friday.\n\n" +
            "**Known:** forensics has matched about 182,000 patients to files in the leak and in the 1.1 TB. Notices to individuals can go out next week.\n\n" +
            "**Unknown:** what part 2 of the leak will hold.",
          artifacts: [LEAK_POST, REPORTER],
        },
        degrading: {
          narrativeMd:
            "Wednesday 10:00. Day 12. The leak site posted **210 GB** last night, including behavioral health notes, insurance cards and payroll. The EHR is still down; read-only access is expected Saturday.\n\n" +
            "**Known:** forensics has matched about 182,000 patients so far and says the rest may take weeks.\n\n" +
            "**Unknown:** how many more patients are affected, and what part 2 holds.",
          artifacts: [LEAK_POST, REPORTER],
        },
        critical: {
          narrativeMd:
            "Wednesday 10:00. Day 12. The leak site posted **210 GB**, including behavioral health notes for named patients. A patient advocacy group is posting screenshots. The EHR is still down. A class action was filed this morning.\n\n" +
            "**Known:** forensics has matched about 182,000 patients so far. Staff are asking whether their payroll data is out.\n\n" +
            "**Unknown:** the final count, and what part 2 holds.",
          consequenceText: "Patients are learning from the news before hearing from the health system.",
          artifacts: [LEAK_POST, REPORTER],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "About 182,000 patients are matched so far. What notices go out, and when?",
          discussionPrompt: "What is your plan if the final patient list is not ready by day 60?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Notify matched patients next week with HHS and media, file with the Texas AG, and supplement as matching ends.",
              quality: ["great", "great", "great"],
              followUp: "Notices to matched patients, HHS, media and the Texas AG are scheduled, with supplements planned.",
              rationale: "Notice goes out without unreasonable delay with what is known, and supplements cover later matches.",
              clocks: [{ key: CLOCKS.hipaa.key, action: "met" }, { key: CLOCKS.stateAg.key, action: "met" }],
            },
            {
              id: "b",
              text: "Wait for the final patient list before sending anything, so each patient gets one accurate letter.",
              quality: ["bad", "bad", "bad"],
              followUp: "Notices wait for the final list.",
              rationale: "The 60 day limit does not wait for a final list, and Synnovis took over a year to finish one.",
            },
            {
              id: "c",
              text: "Post a notice on the website now and send letters only to patients whose behavioral health notes were posted.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "A website notice is up and letters went to patients with posted behavioral health notes.",
              rationale: "Speed helps the most exposed, but every matched patient is owed direct notice.",
            },
            {
              id: "d",
              text: "Notify matched patients and HHS next week, and leave the Texas AG filing until the final count is known.",
              quality: ["good", "good", "neutral"],
              followUp: "Patient and HHS notices are scheduled. The Texas AG filing waits.",
              rationale: "Patient notice is right, but the Texas clock runs 30 days from determining the breach, not from the final count.",
              clocks: [{ key: CLOCKS.hipaa.key, action: "met" }],
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The reporter files at 14:00 and asks whether the health system paid. What do you say?",
          discussionPrompt: "What does a patient who calls tomorrow hear, and who wrote it?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Confirm the leak, say no ransom was paid, explain notices and the call center, and apologize to patients.",
              quality: ["great", "great", "great"],
              followUp: "The statement confirms the leak, says no ransom was paid, and points patients to the call center.",
              rationale: "A true answer on payment, an apology and a way to get help is what patients and staff need.",
            },
            {
              id: "b",
              text: "Decline to comment on the leak and say the investigation is ongoing, to avoid confirming what was posted.",
              quality: ["bad", "bad", "bad"],
              followUp: "The story runs with no comment from the health system.",
              rationale: "The data is public. Refusing to confirm it leaves patients with no guidance.",
            },
            {
              id: "c",
              text: "Say the posted files may be fake and urge the public not to look at them while the claim is checked.",
              quality: ["bad", "bad", "bad"],
              followUp: "The statement suggests the files may be fake.",
              rationale: "Forensics has matched the files. Suggesting otherwise will be shown false quickly.",
            },
            {
              id: "d",
              text: "Confirm the leak and the call center, and decline to discuss whether a ransom was paid or negotiated.",
              quality: ["good", "good", "neutral"],
              followUp: "The statement confirms the leak and the call center and says nothing on payment.",
              rationale: "Confirming is right. Silence on payment is defensible but invites speculation.",
            },
          ],
        },
        {
          team: CLIN,
          decisionOwner: "Chief nursing officer",
          stem: "The EHR is coming back. What must be true before clinicians use it for live care?",
          discussionPrompt: "Who signs that a restored record is safe to chart in, and how do paper notes get back in?",
          capabilityKeys: ["RC.RP", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Clinicians validate a sample of records, then go live by unit, with paper back entry by a set deadline.",
              quality: ["great", "great", "great"],
              followUp: "Clinicians validated sample records and units go live in turn, with paper back entry scheduled.",
              rationale: "Clinical validation before go-live and a planned back entry protect patients from gaps between paper and system.",
            },
            {
              id: "b",
              text: "Go live everywhere as soon as IT says it is up, and let units enter paper notes when they have time.",
              quality: ["bad", "bad", "bad"],
              followUp: "Every unit went live at once. Paper notes are piling up.",
              rationale: "Unvalidated records and unscheduled back entry leave orders and allergies missing from the chart.",
            },
            {
              id: "c",
              text: "Stay on paper until every server is restored and checked, even if read-only access is available sooner.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Units stay on paper. Read-only access is not used.",
              rationale: "Caution is reasonable when restores are shaky, but read-only access to histories helps care now.",
            },
            {
              id: "d",
              text: "Go live at the flagship first after a validation sample, and keep the two smaller hospitals on paper a week.",
              quality: ["good", "good", "neutral"],
              followUp: "The flagship is live after validation. The other hospitals stay on paper.",
              rationale: "A staged go-live is sound, but a week of extra paper raises risk in the smaller hospitals.",
            },
          ],
        },
      ],
    }),
  ],
};

export const GENERAL_CRISISSIM_HOSPITAL_RANSOMWARE = HOSPITAL_RANSOMWARE;
