// Crisis Sim: Scattered Spider style help desk social engineering against a
// healthcare analytics business associate. Grounded in CISA AA23-320A (rev.
// 2025-07-29) and the MGM and Caesars 2023 replays as summarized in the
// October 2026 threat brief. Matches playbooks/scattered-spider-help-desk.md.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { CLOCKS, CUSTOMERS, DOMAIN, HEALTHCARE_COLLECTION_LABEL, ORG, ORG_PROFILE_MD, PEOPLE, VENDORS } from "./org";

export const SCATTERED_SPIDER_TEMPLATE_ID = "lib-health-crisissim-help-desk";

const EXEC = "Executive";
const LEGAL = "Legal and Privacy";
const SEC = "Security";
const COMMS = "Communications";

const SIGNIN_LOG = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Entra ID audit and sign-in log, Tuesday",
  from: "Defender XDR",
  sentAt: "Tuesday 17:36",
  content: [
    "```",
    "16:52:07 AuditLogs  OperationName=\"Reset password (by admin)\"  InitiatedBy=helpdesk-l1-0417@" + DOMAIN + "  Target=rahul.desai@" + DOMAIN,
    "16:53:40 AuditLogs  OperationName=\"Admin deleted security info\"  InitiatedBy=helpdesk-l1-0417@" + DOMAIN + "  Target=rahul.desai@" + DOMAIN,
    "16:58:12 AuditLogs  OperationName=\"User registered security info\"  Target=rahul.desai@" + DOMAIN + "  Method=Microsoft Authenticator",
    "16:58:55 SigninLogs UserPrincipalName=rahul.desai@" + DOMAIN + "  IPAddress=198.51.100.23  ResultType=0  AppDisplayName=\"Microsoft Teams\"  DeviceDetail.isCompliant=false",
    "17:04:31 SigninLogs UserPrincipalName=rahul.desai@" + DOMAIN + "  IPAddress=198.51.100.23  AppDisplayName=\"Azure Databricks\"  ResultType=0",
    "17:21:09 SigninLogs UserPrincipalName=rahul.desai@" + DOMAIN + "  IPAddress=198.51.100.23  AppDisplayName=\"Office 365 SharePoint Online\"  ResultType=0",
    "```",
  ].join("\n"),
};

const EXTORTION_EMAIL = {
  id: "a1",
  kind: "email" as const,
  title: "Extortion email to the CEO",
  from: "Unknown sender",
  sentAt: "Thursday 08:12",
  content:
    `**From:** qsha-files@proton.example\n**To:** ${PEOPLE.ceo} <dana.whitlock@${DOMAIN}>\n**Subject:** your patients\n\n` +
    `We were in your tenant for two days. We have your Databricks warehouse extracts and your Salesforce cases. Ten sample rows are attached so you know this is real.\n\n` +
    "You have 72 hours to talk to us. After that we publish and we email your hospital customers ourselves. Do not bring in the FBI. We will know.",
};

const SCATTERED_SPIDER: LibraryCrisisSimTemplate = {
  id: SCATTERED_SPIDER_TEMPLATE_ID,
  collection: HEALTHCARE_COLLECTION_LABEL,
  title: "Help desk social engineering at a health analytics company",
  summary:
    "A caller talks the outsourced help desk into resetting an engineer's password and MFA. Four teams work account takeover, Entra admin abuse, PHI warehouse theft, possible VM encryption and extortion at a HIPAA business associate.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, LEGAL, SEC, COMMS],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 2, time: "17:40" },
    orgName: ORG,
    replayKey: "mgm-2023",
    capabilityKeys: ["PR.AA", "RS.MA", "RS.MI", "RS.AN", "RS.CO", "GV.RR", "GV.OC", "GV.SC", "RC.RP"],
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.baa, CLOCKS.hipaa, CLOCKS.stateAg, CLOCKS.sec],
    executiveBriefMd: [
      ORG_PROFILE_MD,
      "",
      `At 16:50 on Tuesday a caller reached ${VENDORS.helpDesk} claiming to be Rahul Desai, a senior data engineer, locked out before a customer release. The agent verified him with his employee ID and the last four digits of his Social Security number, reset his password, and removed his MFA method so he could register a new phone.`,
      "",
      "The Executive, Legal and Privacy, Security and Communications teams make decisions over six days of simulated time. Five clocks can start: cyber insurer notice, the contractual BAA notice to customers, HIPAA business associate notice, Texas attorney general notice and the SEC Form 8-K.",
      "",
      "Use your own incident response plan. The library playbook for this scenario is Help desk social engineering response.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Cut the attacker out of Entra ID within two hours of detection and record each containment decision.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "o2", text: "Close the help desk reset path with a verification rule that holds against a caller who knows employee data.", capabilityKeys: ["PR.AA", "GV.SC"] },
    { key: "o3", text: "Record the HIPAA discovery time and send the BAA notices to affected customers inside the contract window.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "o4", text: "Make and record the materiality determination and a ransom decision with OFAC, insurer and FBI input.", capabilityKeys: ["GV.RR", "GV.OC"] },
    { key: "o5", text: "Keep customers, staff and media informed with statements that match the confirmed facts.", capabilityKeys: ["RS.CO", "RC.CO"] },
  ],
  injects: [
    inject({
      title: "A second Rahul Desai",
      scenarioOffsetMin: 0,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o2"],
      clockTriggers: [CLOCKS.insurer.key],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Disables the account in on-premises AD and Entra ID and revokes sessions with Revoke-MgUserSignInSession",
            "Removes the attacker's MFA method and reviews every sign-in from 198.51.100.23",
            "Pulls Entra audit, sign-in and Databricks audit logs and preserves them before retention runs out",
          ],
        },
        { team: EXEC, actions: ["Declares an incident and names an incident commander", "Sets an update cadence for the executive team"] },
        {
          team: LEGAL,
          actions: ["Engages breach counsel and has counsel retain the IR firm", "Gives notice to the cyber insurer", "Starts a legal hold on help desk call recordings and tickets"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 17:40. The real **Rahul Desai** calls the security on-call line from his desk phone. His laptop says his password changed, and he did not change it. Defender XDR has already raised an alert: a new Microsoft Authenticator method was registered at 16:58 and the account signed in from **198.51.100.23**, a residential proxy, eight minutes later.\n\n" +
            "**Known:** the help desk reset the password and MFA at 16:52 after a call. The new session reached Teams, SharePoint and the Databricks workspace that holds customer PHI.\n\n" +
            "**Unknown:** what the caller looked at in Databricks and SharePoint.\n\n" +
            "**Assumed:** the attacker has had the account for about 45 minutes.",
          artifacts: [SIGNIN_LOG],
        },
        degrading: {
          narrativeMd:
            "Tuesday 17:40. The real **Rahul Desai** emails the help desk, not security, to say he is locked out. The help desk ticket reaches the security queue 40 minutes later. Defender XDR raised a medium alert at 16:58 for a new MFA method and an unfamiliar sign-in from **198.51.100.23**. Nobody picked it up.\n\n" +
            "**Known:** the session reached Teams, SharePoint and the Databricks workspace that holds customer PHI.\n\n" +
            "**Unknown:** whether the caller has done anything beyond reading. Rahul is in two SharePoint sites that hold IT runbooks.",
          artifacts: [SIGNIN_LOG],
        },
        critical: {
          narrativeMd:
            "Tuesday 17:40. A Databricks admin notices a personal access token created on **Rahul Desai's** account and a cluster running large queries. Rahul is on a flight. Defender XDR raised a medium alert at 16:58 for a new MFA method and a sign-in from **198.51.100.23**. It is still open.\n\n" +
            "**Known:** the account has been in the attacker's hands for at least 45 minutes and has a token that does not need MFA.\n\n" +
            "**Unknown:** how much data the queries returned and where it went.",
          consequenceText: "Every hour now matters for scope, and the token survives a password reset.",
          artifacts: [SIGNIN_LOG],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The account is in the attacker's hands and has reached the PHI warehouse. What do you do with it in the next 15 minutes?",
          discussionPrompt: "Which of your tokens and sessions survive a password reset, and who on call knows how to revoke them?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Disable the account in AD and Entra, revoke sessions and tokens including Databricks, remove the new MFA method.",
              quality: ["great", "great", "great"],
              followUp: "The account is disabled on both sides, refresh tokens and the Databricks token are revoked, and the attacker's MFA method is gone.",
              rationale: "Microsoft's emergency revoke covers AD and Entra together. Entra does not revoke app sessions or tokens the app issued itself.",
            },
            {
              id: "b",
              text: "Have the help desk reset the password again, with Rahul on the line, and let him register MFA on his phone.",
              quality: ["bad", "bad", "bad"],
              followUp: "The help desk reset the password again. Existing sessions and the Databricks token were left alone.",
              rationale: "A reset does not revoke refresh tokens or app tokens, and it runs through the same channel the attacker just used.",
            },
            {
              id: "c",
              text: "Keep the session live for an hour with Defender recording, so you can learn the caller's tools and targets.",
              quality: ["bad", "bad", "bad"],
              followUp: "The session stayed live while the team watched.",
              rationale: "Watching an attacker inside a PHI warehouse trades patient data for intelligence you can get from logs afterward.",
            },
            {
              id: "d",
              text: "Disable the Entra account and revoke sessions now, and leave the AD account and app tokens for the morning.",
              quality: ["good", "neutral", "bad"],
              followUp: "The Entra account is disabled and sessions revoked. The AD account and the Databricks token are still active.",
              rationale: "Cloud revocation stops new sign-ins, but a live AD account syncs back and a PAT keeps working without MFA.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The CISO calls you at 17:50 with what is known. What do you set in motion tonight?",
          discussionPrompt: "Who has the authority to pull customer facing systems offline overnight, and is that written down?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Wait for the overnight investigation and decide in the morning whether this is an incident or a help desk error.",
              quality: ["bad", "bad", "bad"],
              followUp: "The decision on whether to declare an incident waits until morning.",
              rationale: "A confirmed account takeover that reached a PHI warehouse meets any declaration threshold. Waiting loses the night.",
            },
            {
              id: "b",
              text: "Declare an incident, name the CISO incident commander, and set an executive call every four hours tonight.",
              quality: ["great", "great", "great"],
              followUp: "An incident is declared. The CISO is incident commander and the executive team meets every four hours.",
              rationale: "Early declaration gives the response a commander, a cadence and a record, which every later decision depends on.",
            },
            {
              id: "c",
              text: "Take every customer dashboard offline at once as a precaution, until the investigation shows what was touched.",
              quality: ["bad", "neutral", "good"],
              followUp: "Every customer dashboard is offline. Customers are asking why.",
              rationale: "Shutting down customer service before scope is known causes its own outage and notice questions. Defensible only once theft is likely.",
            },
            {
              id: "d",
              text: "Bring in the IR retainer through counsel tonight and ask the board chair to stand by for a call tomorrow.",
              quality: ["good", "good", "good"],
              followUp: "Counsel engaged the IR retainer and the board chair is on standby.",
              rationale: "Engaging the retainer through counsel is sound and keeps privilege, but it does not by itself give the response a commander.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Nothing confirms PHI was taken yet. What does Legal and Privacy do tonight?",
          discussionPrompt: "Who records the time the company knew, or should have known, about this, and where is it recorded?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Engage breach counsel, notify the insurer, start a legal hold, and log the time security first knew of the takeover.",
              quality: ["great", "great", "great"],
              followUp: "Breach counsel is engaged, the insurer has notice, a legal hold is out and the first known time is logged.",
              rationale: "Insurer notice is often a condition of cover, and HIPAA discovery is when any workforce member knew or should have known.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
            {
              id: "b",
              text: "Hold off on outside counsel and the insurer until forensics confirms that PHI was accessed or copied.",
              quality: ["bad", "bad", "bad"],
              followUp: "Counsel and the insurer have not been contacted.",
              rationale: "Costs incurred before notice may not be covered, and work done without counsel may not be privileged.",
            },
            {
              id: "c",
              text: "Call every covered entity customer tonight to say there may be an incident, before anyone knows the scope.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "Customers heard there may be an incident. They are asking for details nobody has.",
              rationale: "Early contact is honest but without facts it sets off 46 customer escalations. The BAA window gives time to scope first.",
            },
            {
              id: "d",
              text: "Notify the insurer tonight and plan to engage breach counsel from the insurer panel in the morning.",
              quality: ["good", "good", "neutral"],
              followUp: "The insurer has notice. Breach counsel will be engaged in the morning.",
              rationale: "Insurer notice is the right first call, but overnight forensic work without counsel risks privilege.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Global Administrator at 20:31",
      scenarioOffsetMin: 200,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o2"],
      clockTriggersByPath: { critical: [CLOCKS.baa.key, CLOCKS.hipaa.key] },
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Signs in with a break-glass account and removes the attacker's role assignments and accounts",
            "Revokes sessions for every privileged account and reviews PIM activations since 16:50",
            "Has the help desk vendor stop all resets for privileged accounts",
          ],
        },
        { team: COMMS, actions: ["Moves incident coordination to a channel outside the tenant", "Confirms each participant's identity before adding them"] },
        { team: EXEC, actions: ["Approves a help desk verification rule that applies to executives too", "Tells the help desk vendor's leadership directly"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 21:00. At 20:31 a caller asked the help desk to reset **Kevin Marsh**, an IT systems engineer who is eligible for Global Administrator in PIM. The agent followed your new hold on resets and refused. Defender XDR shows the same proxy range trying Kevin's account.\n\n" +
            "**Known:** Rahul's session spent 20 minutes in SharePoint reading the IT runbook site, including the page that names PIM approvers and the break-glass process.\n\n" +
            "**Unknown:** whether the caller has other accounts lined up.\n\n" +
            "The incident is being coordinated in a Teams channel named **qs-incident-0001**.",
        },
        degrading: {
          narrativeMd:
            "Tuesday 21:00. At 20:31 the help desk reset MFA for **Kevin Marsh**, an IT systems engineer eligible for Global Administrator in PIM. Activation needs only MFA, which the caller now holds. At 20:44 Kevin's account activated Global Administrator and created a user named **svc-backup-sync** with its own MFA method.\n\n" +
            "**Known:** the attacker read the IT runbook site, including PIM approvers and break-glass steps.\n\n" +
            "**Unknown:** what else svc-backup-sync has done. The incident is being coordinated in Teams.",
        },
        critical: {
          narrativeMd:
            "Tuesday 21:00. At 20:31 the help desk reset MFA for **Kevin Marsh**, who is eligible for Global Administrator in PIM. His account activated the role at 20:44, created **svc-backup-sync**, and granted it Owner on the analytics subscription.\n\n" +
            "**Known:** Databricks audit logs show bulk queries against claims and encounter tables from Rahul's token since 17:10. Azure egress from the analytics subscription is about **2.1 TB** to a cloud storage provider.\n\n" +
            "**Unknown:** which customers' tables were in the queries.\n\n" +
            "At 20:58 Kevin Marsh's account posted in the incident Teams channel: \"Is the IR call still at 21:30?\"",
          consequenceText: "The attacker is an administrator, has PHI, and is reading your incident channel.",
          artifacts: [
            {
              id: "a1",
              kind: "chat",
              title: "Teams, qs-incident-0001",
              from: "Kevin Marsh",
              sentAt: "Tuesday 20:58",
              content: "**Kevin Marsh** 20:58\n\nIs the IR call still at 21:30? Can someone drop the bridge number and the break-glass doc link here, I lost the email.",
            },
          ],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "Incident commander",
          stem: "An account eligible for Global Administrator is under attack or already used. What do you do in the next hour?",
          discussionPrompt: "When did you last sign in with your break-glass accounts, and who can do it tonight without the help desk?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Use break-glass to remove the attacker's roles and accounts, revoke all admin sessions, and freeze privileged resets.",
              quality: ["great", "great", "great"],
              followUp: "Break-glass was used to remove the attacker's roles and accounts, admin sessions are revoked and privileged resets are frozen.",
              rationale: "Break-glass exists for this case. Removing the foothold, revoking every admin session and closing the reset path together stops the cycle.",
            },
            {
              id: "b",
              text: "Shut down the Entra Connect server and disable all synced accounts so nobody can sign in until rebuilt.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "Entra Connect is off and synced accounts are disabled. Staff cannot sign in. Cloud-only admin accounts still work.",
              rationale: "MGM shows that cutting identity sync causes its own outage. It does not touch cloud roles, which is where this attacker sits.",
            },
            {
              id: "c",
              text: "Ask the help desk to reset Kevin Marsh's credentials again tonight so the attacker loses the account.",
              quality: ["bad", "bad", "bad"],
              followUp: "The help desk reset Kevin's credentials again through the same process.",
              rationale: "The reset path is the attack path. Using it again hands the next caller another chance.",
            },
            {
              id: "d",
              text: "Require approval on every PIM activation and make all admin roles eligible only, then review tomorrow.",
              quality: ["good", "neutral", "bad"],
              followUp: "PIM now needs approval for every activation. Active sessions were left in place until tomorrow.",
              rationale: "Approval on activation is a real fix, but it leaves any role already activated and its sessions in the attacker's hands.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP Communications",
          stem: "The incident is being run in Teams on the same tenant the attacker is in. How do you coordinate from here on?",
          discussionPrompt: "Where would your incident team meet tonight if Microsoft 365 could not be trusted, and who holds that list?",
          capabilityKeys: ["RS.CO", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Keep using Teams, but make the incident channel private and remove anyone who does not need to be there.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The channel is now private. It is still on the tenant the attacker administers.",
              rationale: "A private channel does not stop a tenant administrator. Vendor reports say this group joins victims' incident calls.",
            },
            {
              id: "b",
              text: "Move to the out-of-band bridge and chat group in the plan, and verify each person by a call before adding them.",
              quality: ["great", "great", "great"],
              followUp: "The response moved to the out-of-band bridge. Each participant was verified by a callback.",
              rationale: "Out-of-band coordination with members verified by callback keeps a tenant administrator out of the response.",
            },
            {
              id: "c",
              text: "Email the whole company tonight to warn staff about calls from people claiming to be IT or the help desk.",
              quality: ["good", "neutral", "neutral"],
              followUp: "All staff got a warning about callers posing as IT. The attacker can read it too.",
              rationale: "A staff warning helps against the next call, but it does not fix where the response team talks.",
            },
            {
              id: "d",
              text: "Stop all written communication about the incident until the morning, and use personal phones only.",
              quality: ["bad", "bad", "bad"],
              followUp: "No written records are being kept. People are calling each other on personal phones.",
              rationale: "Unrecorded decisions on personal phones lose the timeline that notice and insurance decisions depend on.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The help desk vendor's process let two resets through. What do you require of Altamesa from tonight?",
          discussionPrompt: "Would your own executives accept a video call and a manager check before an MFA reset?",
          capabilityKeys: ["GV.SC", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Require a video call with ID and the manager on the line for every MFA reset, executives included.",
              quality: ["great", "great", "great"],
              followUp: "Every MFA reset now needs a video call with ID and the manager on the line, with no executive exception.",
              rationale: "CISA's July 2025 update puts new weight on help desk calls. Knowledge checks fail against callers who hold employee data.",
            },
            {
              id: "b",
              text: "Add two more security questions to the help desk script, such as hire date and office location.",
              quality: ["bad", "bad", "bad"],
              followUp: "The script now asks two more questions. Both answers are on LinkedIn.",
              rationale: "More knowledge questions are easy for a caller who researched the target. This is how the attacker got in.",
            },
            {
              id: "c",
              text: "Terminate the Altamesa contract tonight and route all resets to the internal IT team on call.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The contract is being terminated and three internal engineers now handle every reset.",
              rationale: "It removes one weak link but overwhelms a small team mid incident, and the process gap would move with it.",
            },
            {
              id: "d",
              text: "Stop all MFA resets for 48 hours except for staff who come to the Columbus office in person with ID.",
              quality: ["good", "good", "good"],
              followUp: "MFA resets are paused for 48 hours except in person at the Columbus office.",
              rationale: "A short freeze with in-person checks is strong, but remote staff are stuck and it is not a lasting rule.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "What left the warehouse",
      scenarioOffsetMin: 940,
      plannedDelayMin: 8,
      objectiveKeys: ["o3", "o5"],
      clockTriggersByPath: { optimal: [CLOCKS.baa.key, CLOCKS.hipaa.key], degrading: [CLOCKS.baa.key, CLOCKS.hipaa.key] },
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Exports Entra, Unified Audit Log and Databricks audit records to storage the attacker cannot reach",
            "Checks whether storage and Databricks data plane logging was on before the incident",
            "Gives a written scope statement that separates confirmed, likely and unknown",
          ],
        },
        { team: LEGAL, actions: ["Records Tuesday 17:40 or earlier as the discovery time", "Maps each affected customer's BAA notice window"] },
        { team: COMMS, actions: ["Answers the reporter with a short true statement", "Does not confirm the help desk detail or the actor"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 09:20. The attacker is out. Kestrel Point has the Databricks audit logs: before the token was revoked, it ran 14 queries against the encounter tables of **Saint Aldric Health** and **Northvale Regional Medical Center** and returned about **38,000 rows** with names, dates of birth, MRNs and diagnosis codes.\n\n" +
            "**Unknown:** whether the rows left the workspace. Storage data plane logging was off for the export container.\n\n" +
            "**Assumed:** no other customer's data was touched.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Reporter asks about a help desk call",
              from: "Jonah Reyes, Health Systems Ledger",
              sentAt: "Wednesday 09:05",
              content:
                "**From:** Jonah Reyes <jreyes@healthsystemsledger.example>\n**Subject:** Help desk call\n\n" +
                `A source says someone talked their way past ${ORG}'s help desk on Tuesday and got into patient data. Can you confirm, and say whether hospital customers have been told? I am filing at 14:00.`,
            },
          ],
        },
        degrading: {
          narrativeMd:
            "Wednesday 09:20. The attacker is out of Entra ID. Kestrel Point confirms bulk Databricks queries against the claims and encounter tables of **six customers** and about **640 GB** of egress to a cloud storage provider before the token was revoked.\n\n" +
            "**Known:** the tables hold names, dates of birth, member IDs, diagnosis and procedure codes.\n\n" +
            "**Unknown:** exactly which rows were in the egress. Storage data plane logs were never turned on.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Reporter asks about a help desk call",
              from: "Jonah Reyes, Health Systems Ledger",
              sentAt: "Wednesday 09:05",
              content:
                "**From:** Jonah Reyes <jreyes@healthsystemsledger.example>\n**Subject:** Help desk call\n\n" +
                `A source says someone talked their way past ${ORG}'s help desk on Tuesday and got into patient data. Can you confirm, and say whether hospital customers have been told? I am filing at 14:00.`,
            },
          ],
        },
        critical: {
          narrativeMd:
            "Wednesday 09:20. svc-backup-sync was removed at 02:10, nine hours after it was created. Kestrel Point confirms about **2.1 TB** left the analytics subscription, including Databricks extracts for **eleven customers** and a Salesforce report of open support cases.\n\n" +
            "**Unknown:** what the attacker changed while it was Owner. Azure Activity Log shows new role assignments and a disabled diagnostic setting.\n\n" +
            "A reporter has the help desk detail and is filing this afternoon.",
          consequenceText: "Scope is large and still moving, and the story is about to break without you.",
          artifacts: [
            {
              id: "a1",
              kind: "email",
              title: "Reporter asks about a help desk call",
              from: "Jonah Reyes, Health Systems Ledger",
              sentAt: "Wednesday 09:05",
              content:
                "**From:** Jonah Reyes <jreyes@healthsystemsledger.example>\n**Subject:** Help desk call\n\n" +
                `A source says someone talked their way past ${ORG}'s help desk on Tuesday and got into patient data. Can you confirm, and say whether hospital customers have been told? I am filing at 14:00.`,
            },
          ],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "PHI in the warehouse was accessed. When did the company discover this for HIPAA and the BAAs, and what follows?",
          discussionPrompt: "Under 164.410, discovery is when any workforce member knew or should have known. Who knew first here?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Discovery is Tuesday 17:40, when security confirmed the takeover. Start the BAA and HIPAA clocks from then.",
              quality: ["great", "great", "good"],
              followUp: "Discovery is recorded as Tuesday 17:40. The BAA and HIPAA clocks run from then.",
              rationale: "The takeover reaching PHI was known Tuesday. On the critical path the 16:58 alert sat unread, so even 17:40 may be late.",
            },
            {
              id: "b",
              text: "Discovery is this morning, when forensics confirmed that PHI was queried. Start the clocks from 09:20 today.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Discovery is recorded as Wednesday 09:20.",
              rationale: "HIPAA counts from when the breach was known or should have been known, not from when forensics finished.",
            },
            {
              id: "c",
              text: "Treat discovery as the date the full scope is confirmed, since notices must name each affected patient.",
              quality: ["bad", "bad", "bad"],
              followUp: "Legal decided the clocks start when the full scope is known.",
              rationale: "The 60 days run from discovery. Synnovis took over a year to scope. Notices go out with what is known and are supplemented.",
            },
            {
              id: "d",
              text: "Record Tuesday 16:58, when Defender first alerted, as the time the company should have known.",
              quality: ["good", "good", "great"],
              followUp: "Discovery is recorded as Tuesday 16:58, the first Defender alert.",
              rationale: "The conservative reading of should have known. It costs about 40 minutes and removes an argument with regulators.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Customers will ask exactly which records left. How do you build a scope you can stand behind?",
          discussionPrompt: "Which of your data plane logs are on today, and how long does your Entra ID license keep sign-in logs?",
          capabilityKeys: ["RS.AN", "DE.AE"],
          options: [
            {
              id: "a",
              text: "Rebuild the queries from Databricks audit logs, map tables to customers, and state what logs cannot prove.",
              quality: ["great", "great", "great"],
              followUp: "Scope is being rebuilt from the audit logs, mapped to customers, with the logging gaps written down.",
              rationale: "Query level audit is the best evidence here. Saying what cannot be proven keeps the scope honest for notices.",
            },
            {
              id: "b",
              text: "Assume every customer in the warehouse is affected and stop the analysis to save time for notices.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "Every customer is being treated as affected. The analysis has stopped.",
              rationale: "Over-notifying 46 customers when the logs can narrow it causes needless notices and still needs a basis.",
            },
            {
              id: "c",
              text: "Turn on diagnostic logging for storage and Databricks now and use the new logs to measure what was taken.",
              quality: ["bad", "bad", "bad"],
              followUp: "Diagnostic logging is now on. It records nothing from before today.",
              rationale: "Logs that were off cannot be turned on after the fact. Enabling them helps from now, not for this scope.",
            },
            {
              id: "d",
              text: "Export Entra, audit and Databricks logs to immutable storage first, then start the scope with Kestrel Point.",
              quality: ["good", "good", "good"],
              followUp: "Logs are preserved in immutable storage. The scope work starts after.",
              rationale: "Preservation first is right, since Entra logs on P1 last 30 days. It delays the scope answer customers need.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP Communications",
          stem: "The reporter knows about the help desk call and files at 14:00. Customers have not been told. What do you do?",
          discussionPrompt: "Which customers should hear from you before they read about it, and who calls them?",
          capabilityKeys: ["RS.CO"],
          options: [
            {
              id: "a",
              text: "Decline to comment and ask the reporter to hold the story until the investigation is complete.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The company declined to comment. The story runs at 14:00 without your account.",
              rationale: "No comment cedes the story, and customers then learn from the press, which damages trust under the BAA.",
            },
            {
              id: "b",
              text: "Confirm an incident in a short statement, call affected customers before 14:00, and give no actor detail.",
              quality: ["great", "great", "great"],
              followUp: "Affected customers were called before 14:00. The reporter got a short statement confirming an incident.",
              rationale: "Customers hear it first, the statement is true, and nothing confirms the method or actor before forensics does.",
            },
            {
              id: "c",
              text: "Tell the reporter it was a phishing test by the help desk vendor and that no patient data was involved.",
              quality: ["bad", "bad", "bad"],
              followUp: "The company told a reporter it was a vendor test with no patient data involved.",
              rationale: "A false statement about patient data will surface in notices and regulator reviews and will be quoted back.",
            },
            {
              id: "d",
              text: "Confirm the incident to the reporter now and send all customers a written notice the same hour.",
              quality: ["good", "good", "neutral"],
              followUp: "The reporter has a confirmation and every customer got a written notice within the hour.",
              rationale: "Fast and open, but a mass notice before scope is mapped tells unaffected customers they may be in it.",
            },
          ],
        },
      ],
      deliverable: {
        team: COMMS,
        kind: "holding_statement",
        prompt: "Write the statement you give the reporter and post on the website. Keep it under 120 words.",
      },
      deliverableCriteria: [
        "Confirms a cybersecurity incident without naming the actor or the method.",
        "Says customers are being contacted directly.",
        "Makes no claim about patient data beyond what is confirmed.",
        "Gives a contact and a time for the next update.",
      ],
    }),
    inject({
      title: "Encryption on the analytics VMs",
      scenarioOffsetMin: 1280,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o3"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Isolates affected VMs with Defender for Endpoint and stops Run Command and Contributor access on the subscription",
            "Checks Azure Backup soft delete and immutable vault state before any restore",
            "Rotates storage account keys and revokes SAS for the analytics storage",
          ],
        },
        { team: EXEC, actions: ["Decides which customer feeds to pause and tells those customers", "Names a recovery owner and a restore order"] },
        { team: LEGAL, actions: ["Applies the OCR ransomware presumption of breach", "Sends or schedules the BAA notices inside the window"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 15:00. Defender XDR blocks an encryptor on three analytics VMs. The file was pushed by Azure **Run Command** at 14:22 from a service principal the attacker added on Tuesday night that nobody removed. Attack disruption contained the VMs within minutes.\n\n" +
            "**Known:** the service principal had Contributor on the analytics subscription.\n\n" +
            "**Unknown:** whether other credentials were added. Customer dashboards are slow but up.",
        },
        degrading: {
          narrativeMd:
            "Wednesday 15:00. An encryptor ran on **41 analytics VMs** through Azure Run Command at 14:22, from a service principal added on Tuesday night. The notes name **DragonForce**. Customer dashboards for 19 customers are down.\n\n" +
            "**Known:** Azure Backup has VM recovery points from Tuesday 02:00 in a vault with soft delete on. The vault is not locked.\n\n" +
            "**Unknown:** whether the Tuesday points are clean, since the intrusion started Tuesday afternoon.",
          artifacts: [
            {
              id: "a1",
              kind: "ransom_note",
              title: "Ransom note on an analytics VM",
              from: "Unknown",
              sentAt: "Wednesday 14:31",
              content:
                "--- README_QSHA.txt ---\n\nQuarrystone. Your analytics servers are encrypted and we hold your warehouse data.\n\nUse the portal below with your ID. If we do not hear from you, your hospital customers will hear from us.\n\nPortal: [onion link]\nID: QSHA-2210-77B1",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Wednesday 15:00. An encryptor ran on **all 120 analytics VMs** and on the on-premises VMware cluster that hosts two domain controllers and the Entra Connect server. The notes name **DragonForce**. Customer dashboards are down for every customer and staff cannot sign in to on-premises systems.\n\n" +
            "**Known:** someone deleted VM restore points and snapshots at 14:05. Recovery Services vault soft delete keeps deleted backup data for 14 days.\n\n" +
            "**Unknown:** whether any recovery point predates the intrusion and is clean.",
          consequenceText: "You are now running a recovery and a data theft response at the same time.",
          artifacts: [
            {
              id: "a1",
              kind: "ransom_note",
              title: "Ransom note on an analytics VM",
              from: "Unknown",
              sentAt: "Wednesday 14:31",
              content:
                "--- README_QSHA.txt ---\n\nQuarrystone. Your analytics servers and your domain are encrypted and we hold your warehouse data.\n\nUse the portal below with your ID. If we do not hear from you, your hospital customers will hear from us.\n\nPortal: [onion link]\nID: QSHA-2210-77B1",
            },
          ],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Encryption came through Azure Run Command from a service principal nobody removed. What do you do now?",
          discussionPrompt: "How would you list every credential an attacker added to your tenant and subscriptions while they were Global Administrator?",
          capabilityKeys: ["RS.MI", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Restore every affected VM from the latest recovery point now to get customer dashboards back today.",
              quality: ["bad", "bad", "bad"],
              followUp: "Restores from the latest recovery points started while the service principal was still active.",
              rationale: "Restoring while the attacker's credentials work invites a second round, and the points may postdate the intrusion.",
            },
            {
              id: "b",
              text: "Remove the service principal, sweep for every app, credential and role added since Tuesday, then contain VMs.",
              quality: ["great", "great", "great"],
              followUp: "The service principal is gone and a sweep of every added app, credential and role assignment is running.",
              rationale: "The first eviction missed a credential. As Midnight Blizzard showed, apps and service principal credentials persist until swept.",
            },
            {
              id: "c",
              text: "Remove Contributor from every non-human identity on the subscription and isolate the affected VMs.",
              quality: ["good", "good", "neutral"],
              followUp: "Non-human identities lost Contributor and the affected VMs are isolated.",
              rationale: "Fast and broad, but it misses user accounts, federated credentials and Entra apps the attacker may have added.",
            },
            {
              id: "d",
              text: "Delete the analytics subscription's VMs and rebuild the whole environment from infrastructure code.",
              quality: ["bad", "bad", "neutral"],
              followUp: "The VMs are being deleted for a rebuild. Disk evidence goes with them.",
              rationale: "A rebuild may be right later, but deleting now destroys evidence and does nothing about the attacker's credentials.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Customers depend on daily feeds and dashboards. What do you decide about customer integrations today?",
          discussionPrompt: "Which customers use your outputs for care operations, not just reporting, and do you know who they are?",
          capabilityKeys: ["RC.RP", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Pause inbound and outbound feeds for affected customers, tell them by phone, and set a restore order by need.",
              quality: ["great", "great", "great"],
              followUp: "Feeds for affected customers are paused, each was called, and restores follow a published order.",
              rationale: "Change Healthcare disconnected on day one. Telling customers and ranking by clinical need limits harm downstream.",
            },
            {
              id: "b",
              text: "Keep all customer feeds running so hospitals see no disruption while the security team works the problem.",
              quality: ["neutral", "bad", "bad"],
              followUp: "All feeds stayed open, including to the affected subscription.",
              rationale: "Open integrations into a compromised environment can carry the attacker to customers and breach BAA terms.",
            },
            {
              id: "c",
              text: "Disconnect every customer integration at once, without calls, until the forensic firm signs off.",
              quality: ["neutral", "good", "good"],
              followUp: "Every integration is cut. Customers are learning from failed jobs.",
              rationale: "Disconnecting is defensible once encryption spreads, but silence turns a safety step into a customer crisis.",
            },
            {
              id: "d",
              text: "Leave the decision on feeds to each customer and send them the indicators so they can choose.",
              quality: ["bad", "bad", "bad"],
              followUp: "Each customer was sent indicators and asked to decide on its own feed.",
              rationale: "Customers cannot judge your environment. The business associate has to make and own the call.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "Encryption reached systems that process PHI. How does this change the breach analysis and the customer notices?",
          discussionPrompt: "What would a four-factor risk assessment need to show to rebut the presumption here?",
          capabilityKeys: ["GV.OC"],
          options: [
            {
              id: "a",
              text: "Treat it as a breach under OCR's ransomware guidance and send BAA notices to affected customers this week.",
              quality: ["great", "great", "great"],
              followUp: "The encryption is treated as a presumed breach. BAA notices to affected customers go out this week.",
              rationale: "OCR treats ransomware on ePHI as a presumed breach unless a four-factor assessment shows low probability of compromise.",
              clocks: [{ key: CLOCKS.baa.key, action: "met" }],
            },
            {
              id: "b",
              text: "Wait for the forensic report before deciding, since encryption alone may not mean PHI was viewed.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The breach decision waits for the forensic report.",
              rationale: "The BAA window runs from discovery, and the presumption applies now. Waiting risks missing the contract window.",
            },
            {
              id: "c",
              text: "Run a documented four-factor assessment this week and notify only customers it cannot clear.",
              quality: ["good", "neutral", "neutral"],
              followUp: "A four-factor assessment is under way. Customers it cannot clear will be notified.",
              rationale: "The assessment is the legal route, but with confirmed exfiltration it will rarely clear anyone. The BAA window still runs.",
            },
            {
              id: "d",
              text: "Advise that encrypted data is unreadable, so no breach occurred and no customer notice is needed.",
              quality: ["bad", "bad", "bad"],
              followUp: "Legal advised that no breach occurred.",
              rationale: "The attacker encrypted the data, not the company. OCR's ransomware guidance treats exactly this as a presumed breach.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Extortion and the disclosure committee",
      scenarioOffsetMin: 2420,
      plannedDelayMin: 8,
      objectiveKeys: ["o4", "o3"],
      clockTriggers: [CLOCKS.stateAg.key],
      expectedActions: [
        { team: LEGAL, actions: ["Records the materiality determination and its time", "Considers a voluntary Item 8.01 filing if not yet material"] },
        {
          team: EXEC,
          actions: ["Has counsel run an OFAC sanctions check before any contact", "Gets the insurer's consent and the FBI's input before any payment decision", "Briefs the board in writing"],
        },
        { team: SEC, actions: ["Validates the sample rows against the warehouse", "Shares indicators with the FBI field office"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 10:00. The CEO received an extortion email at 08:12 with ten sample rows. Kestrel Point matched them to Saint Aldric encounter records that the attacker queried on Tuesday. The sender wants contact within 72 hours.\n\n" +
            "**Known:** about 38,000 patients across two customers, including about 9,000 Texas residents. Systems are up.\n\n" +
            "**Unknown:** whether the sender holds more than the sample.\n\n" +
            "The disclosure committee meets at 11:00. Finance estimates direct costs at $4 million to $6 million.",
          artifacts: [EXTORTION_EMAIL],
        },
        degrading: {
          narrativeMd:
            "Thursday 10:00. The CEO received an extortion email at 08:12 with ten sample rows matching claims data from two of the six affected customers. Nineteen customers have had no dashboards for a day.\n\n" +
            "**Known:** about 1.6 million patients and members across six customers, about 210,000 of them in Texas.\n\n" +
            `**${CUSTOMERS.plan}**, a public company, says it is weighing its own 8-K. The disclosure committee meets at 11:00. Finance estimates $18 million to $30 million in costs and lost revenue.`,
          artifacts: [EXTORTION_EMAIL],
        },
        critical: {
          narrativeMd:
            "Thursday 10:00. The CEO received an extortion email at 08:12 with sample rows from claims and support case data. Every customer has been without dashboards for a day and on-premises systems are still down.\n\n" +
            "**Known:** data for about 4.2 million patients and members across eleven customers, about 600,000 in Texas.\n\n" +
            `Two customers have said they will review the contract. **${CUSTOMERS.plan}** is weighing its own 8-K. The disclosure committee meets at 11:00. Finance estimates $45 million to $70 million.`,
          artifacts: [EXTORTION_EMAIL],
        },
      },
      questions: [
        {
          team: LEGAL,
          type: "materiality",
          decisionOwner: "General counsel, with the disclosure committee",
          stem: "The disclosure committee meets at 11:00. What does it determine about materiality under Item 1.05?",
          discussionPrompt: "Which qualitative factors, beyond cost, would your committee weigh for a business associate that holds PHI for 46 customers?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Determine the incident is material now and record the basis and the time. File Item 1.05 within four business days.",
              quality: ["good", "great", "great"],
              followUp: "The committee determined the incident is material and recorded the basis and time. The 8-K clock is running.",
              rationale: "Item 1.05 calls for a determination without unreasonable delay. Customer loss, PHI scale and regulator exposure point to material.",
              clocks: [{ key: CLOCKS.sec.key, action: "trigger" }],
            },
            {
              id: "b",
              text: "Determine it is not material because costs are under 5 percent of revenue, and close the question.",
              quality: ["bad", "bad", "bad"],
              followUp: "The committee found the incident not material on cost alone.",
              rationale: "A numeric threshold alone is not enough. Patient data at scale, customer contracts and regulators are qualitative factors.",
            },
            {
              id: "c",
              text: "Treat it as not yet material, file a voluntary Item 8.01 8-K now, and reassess as scope firms up.",
              quality: ["great", "good", "neutral"],
              followUp: "The committee treated it as not yet material and is filing a voluntary Item 8.01 report.",
              rationale: "The SEC's May 2024 staff statement points to Item 8.01 for incidents not yet determined material. It is weaker as scope grows.",
            },
            {
              id: "d",
              text: "Defer the materiality question until the forensic firm's final report, expected in about three weeks.",
              quality: ["bad", "bad", "bad"],
              followUp: "The materiality determination is deferred for about three weeks.",
              rationale: "The rule requires a determination without unreasonable delay. Waiting weeks for a final report does not meet that.",
            },
          ],
        },
        {
          team: EXEC,
          type: "ransom",
          decisionOwner: "CEO, with the board",
          stem: "The sender wants contact within 72 hours and threatens to email your hospital customers. How do you approach it?",
          discussionPrompt: "Who in your company can approve a payment, and what must be true before they could?",
          capabilityKeys: ["GV.RR", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Pay quietly through a crypto broker to stop the leak before customers hear from the attacker directly.",
              quality: ["bad", "bad", "bad"],
              followUp: "A payment was arranged before any sanctions check, insurer consent or FBI contact.",
              rationale: "Under OFAC's 2021 advisory, paying a sanctioned party can violate sanctions on a strict liability basis. Paying does not undo theft.",
            },
            {
              id: "b",
              text: "Do not engage yet. Counsel runs an OFAC check, the insurer's negotiator is retained, and the FBI is briefed.",
              quality: ["great", "great", "great"],
              followUp: "No contact yet. Sanctions screening, the insurer's negotiator and an FBI briefing are in place.",
              rationale: "Matches OFAC's 2021 advisory, which counts prompt law enforcement reporting as a significant mitigating factor.",
            },
            {
              id: "c",
              text: "Announce publicly today that the company will never pay, to remove the attacker's leverage over customers.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The company said publicly it will not pay.",
              rationale: "Salesforce took this line in 2025. It is defensible, but announcing it now can speed up the leak to customers.",
            },
            {
              id: "d",
              text: "Have the CISO open a chat with the attacker today to learn what they hold and buy time.",
              quality: ["neutral", "bad", "bad"],
              followUp: "The CISO opened a chat with the attacker without counsel or a negotiator.",
              rationale: "Unplanned contact by staff without counsel or a negotiator risks commitments, privilege and the insurer's consent terms.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The sample rows are real. What does Security do with the extortion email and the attacker's infrastructure?",
          discussionPrompt: "What would the FBI need from you to be useful, and who has authority to share it?",
          capabilityKeys: ["RS.AN", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Preserve the email with headers, match the rows to source tables, and share indicators with the FBI.",
              quality: ["great", "great", "great"],
              followUp: "The email is preserved, the rows are matched to source tables and the FBI has the indicators.",
              rationale: "Preserving and matching the sample sizes the claim. FBI reporting is what OFAC counts in mitigation.",
            },
            {
              id: "b",
              text: "Reply from a fresh mailbox asking for proof of the full data set before anyone decides anything.",
              quality: ["bad", "bad", "bad"],
              followUp: "Security replied to the attacker from a new mailbox.",
              rationale: "Contact outside the agreed negotiation process undercuts counsel, the insurer and law enforcement.",
            },
            {
              id: "c",
              text: "Block the sender's domain and IP ranges and delete the email from the CEO's mailbox to stop spread.",
              quality: ["bad", "bad", "bad"],
              followUp: "The sender is blocked and the email was deleted from the CEO's mailbox.",
              rationale: "Deleting the email destroys evidence the FBI and counsel need. Blocking one domain stops nothing.",
            },
            {
              id: "d",
              text: "Hunt for the samples in the Salesforce exports and warehouse logs to tell customers which records are in it.",
              quality: ["good", "good", "good"],
              followUp: "The team is matching the samples against Salesforce exports and warehouse logs.",
              rationale: "Useful for customer notices, but it leaves the email and indicators unshared with law enforcement for now.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Customer CISOs and the leak site",
      scenarioOffsetMin: 8120,
      plannedDelayMin: 8,
      objectiveKeys: ["o3", "o5", "o2"],
      expectedActions: [
        { team: LEGAL, actions: ["Sends BAA and HIPAA notices with what is known and commits to supplements", "Offers to send individual notices on customers' behalf where they delegate"] },
        { team: SEC, actions: ["Shares indicators and a written timeline with customer security teams", "States return-to-service criteria and who signs them"] },
        { team: COMMS, actions: ["Updates staff, customers and media on the same facts the same day", "Gives the patient call center a script and an escalation path"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 09:00. Systems are stable. The sender has gone quiet. Saint Aldric and Northvale have BAA notices and are asking whether you will send patient letters for them.\n\n" +
            `**${CUSTOMERS.plan}**'s CISO, not affected, asks for indicators and a written attestation that its data was not touched.`,
        },
        degrading: {
          narrativeMd:
            "Monday 09:00. A leak site lists Quarrystone with a countdown of five days and a sample of claims rows. Fourteen customers still have no dashboards.\n\n" +
            `**${CUSTOMERS.plan}**'s CISO demands indicators, the forensic timeline and an attestation by Wednesday, or it will suspend data feeds. Two other customers ask whether you will send patient letters for them.`,
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Leak site listing",
              from: "Leak site",
              sentAt: "Sunday 22:40",
              content: "**QUARRYSTONE HEALTH ANALYTICS**\n\nHealthcare analytics, USA. 640 GB. Claims, encounters, member IDs.\n\nPublishing in 5 days.",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Monday 09:00. A leak site published **200 GB** of claims and support case data on Sunday night. A class action was filed this morning. Customer dashboards are still down for most customers.\n\n" +
            `**${CUSTOMERS.plan}**'s CISO has suspended data feeds and demands indicators, the forensic timeline and an attestation. Several customers ask whether you will send patient letters for them.`,
          consequenceText: "The data is public. Every remaining decision is about customers, patients and the record you leave.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Leak site post",
              from: "Leak site",
              sentAt: "Sunday 22:40",
              content: "**QUARRYSTONE HEALTH ANALYTICS**\n\nPart 1 published. 200 GB. Claims, encounters, member IDs, support cases.\n\nPart 2 in 7 days.",
            },
          ],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "Customers ask whether you will send the patient notices for them. What do you offer?",
          discussionPrompt: "Do your BAAs say who pays for and sends individual notices, and has anyone read them this week?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Offer to send individual, HHS and media notices for each customer that delegates in writing.",
              quality: ["great", "great", "great"],
              followUp: "Each customer was offered delegated notice in writing. Several have accepted.",
              rationale: "OCR's Change Healthcare FAQ confirms a covered entity may delegate notice to its business associate and only one needs to notify.",
              clocks: [{ key: CLOCKS.hipaa.key, action: "met" }],
            },
            {
              id: "b",
              text: "Decline. Patient notice is each covered entity's duty under HIPAA, and the company only owes BAA notice.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customers were told to send their own patient notices.",
              rationale: "Legally arguable, but 46 customers writing different letters about one incident confuses patients and strains contracts.",
            },
            {
              id: "c",
              text: "Send patient letters directly to every patient in the warehouse now, without waiting for customers.",
              quality: ["bad", "bad", "bad"],
              followUp: "Letters are going to every patient in the warehouse.",
              rationale: "Notifying patients whose data was not affected, without the covered entity's agreement, breaks the BAA relationship.",
            },
            {
              id: "d",
              text: "Offer to send notices for customers that ask, and fund credit monitoring for every affected patient.",
              quality: ["good", "good", "good"],
              followUp: "Notices are offered to customers that ask, with credit monitoring for affected patients.",
              rationale: "Generous and practical, but without written delegation the duty and the record stay unclear.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Bayline's CISO wants indicators, a timeline and an attestation. What do you give customer security teams?",
          discussionPrompt: "Who in your company can sign an attestation to a customer, and what evidence would they need?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Indicators and a written timeline through counsel, with an attestation limited to what the evidence shows.",
              quality: ["great", "great", "great"],
              followUp: "Customers got indicators and a timeline through counsel, and an attestation scoped to the evidence.",
              rationale: "Sharing through counsel protects privilege. An attestation scoped to evidence will not be contradicted later.",
            },
            {
              id: "b",
              text: "A signed statement that Bayline's data was not affected, so its feeds come back as fast as possible.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Bayline has a signed statement that its data was not affected.",
              rationale: "On the optimal path it may be true. Where logs were off, it cannot be proven and will not hold up.",
            },
            {
              id: "c",
              text: "Send the full forensic report to every customer that asks, so nobody can say anything was hidden.",
              quality: ["bad", "bad", "bad"],
              followUp: "The full forensic report went to every customer that asked.",
              rationale: "Releasing the full report waives privilege and spreads other customers' details across 46 organizations.",
            },
            {
              id: "d",
              text: "Indicators now, and a call with Kestrel Point for customer CISOs this week before anything in writing.",
              quality: ["good", "good", "neutral"],
              followUp: "Customers have indicators and a call with Kestrel Point is set for this week.",
              rationale: "Indicators help customers hunt, but customers that suspended feeds want something in writing.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "VP Communications",
          stem: "The leak site and customer calls are making news. What do you publish this week, and to whom?",
          discussionPrompt: "If a patient calls tomorrow, what does the person who answers say, and who wrote it?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "One update with the same facts for staff, customers and the website, plus a patient call script.",
              quality: ["great", "great", "great"],
              followUp: "Staff, customers and the website got one update with the same facts, and the call center has a script.",
              rationale: "One set of facts across audiences avoids contradictions that regulators and plaintiffs will compare.",
            },
            {
              id: "b",
              text: "Say nothing more until the investigation ends, and refer every inquiry to the earlier statement.",
              quality: ["neutral", "bad", "bad"],
              followUp: "No new statement. Inquiries are referred to Wednesday's statement.",
              rationale: "Silence after a leak lets the attacker and plaintiffs set the story for patients.",
            },
            {
              id: "c",
              text: "A detailed public timeline naming the help desk vendor as the cause, to explain the failure.",
              quality: ["bad", "bad", "bad"],
              followUp: "The public timeline named Altamesa as the cause.",
              rationale: "Blaming a vendor in public invites litigation and ignores that the reset process was Quarrystone's to set.",
            },
            {
              id: "d",
              text: "A customer letter this week and a public update after notices land, to keep customers first.",
              quality: ["good", "good", "neutral"],
              followUp: "Customers get a letter this week. The public update follows the notices.",
              rationale: "Customers first is right, but once data is public a public update cannot wait for every notice.",
            },
          ],
        },
      ],
    }),
  ],
};

export const HEALTHCARE_CRISISSIM_HELP_DESK = SCATTERED_SPIDER;
