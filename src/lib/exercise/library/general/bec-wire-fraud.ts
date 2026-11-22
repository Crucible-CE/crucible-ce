// Crisis Sim: vendor payment fraud at a mid-market manufacturer. An attacker
// in an accounts payable mailbox (inbox rule and OAuth app persistence)
// replies inside a real supplier thread with new bank details. Grounded in
// the FBI IC3 BEC guidance, the IC3 Recovery Asset Team brochure, the FinCEN
// Rapid Response Program and Microsoft's compromised mailbox guidance, as
// summarized in the threat brief addendum. Matches playbooks/bec-wire-fraud.md
// (W1 to W4, W-A, V-A and section 12). All names are fictional; IP addresses
// are RFC 5737.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const BEC_WIRE_FRAUD_TEMPLATE_ID = "lib-general-crisissim-bec-wire-fraud";

const ORG = "Pellworth Precision Components";
const DOMAIN = "pellworth.example";
const VENDOR = "Graywick Castings";
const EXEC = "Executive";
const FIN = "Finance and Treasury";
const SEC = "IT and Security";
const LEGAL = "Legal";

const CLOCKS = {
  fincen: { key: "fincen_rrp_72h", label: "Wire reported to law enforcement inside 72 hours of transfer (FinCEN RRP, 19 hours left)", durationHours: 19 },
  lender: { key: "lender_notice", label: "Lender notice of a loss over $1 million (credit agreement, 5 business days)", businessDays: 5 },
  insurer: { key: "insurer_notice", label: "Crime policy notice of loss (policy: 30 days)", durationHours: 30 * 24 },
} as const;

const PROFILE =
  `**${ORG}, Inc.** is a privately held maker of machined and cast components for agricultural and construction equipment, based in Wisconsin, with about 900 staff, two plants and $410 million in annual revenue. ` +
  `Its largest supplier of iron castings is ${VENDOR}, paid about $1.8 million a month by wire. ` +
  "Email is Microsoft 365. Accounts payable runs in the ERP, where any AP specialist can edit vendor bank details and a second person approves wires over $250,000 in the bank portal. " +
  "There is no call-back rule for bank detail changes. The company has a revolving credit facility with covenants, and a crime policy with social engineering fraud coverage.";

const VENDOR_CALL = {
  id: "a1",
  kind: "voicemail" as const,
  title: "Voicemail from the supplier's receivables lead",
  from: `Receivables, ${VENDOR}`,
  sentAt: "Thursday 15:22",
  content:
    `Hi, this is Ruth Calder at ${VENDOR}. We still have not received payment on the September invoices, about one point eight four million. Your portal says paid on Tuesday. We have not changed our bank. Can someone call me back today? Our CFO is asking whether to hold shipments.`,
};

const CHANGE_EMAIL = {
  id: "a2",
  kind: "email" as const,
  title: "Bank change request in the supplier thread",
  from: `Ruth Calder, ${VENDOR}`,
  sentAt: "Friday two weeks ago, 10:14",
  content:
    `**From:** Ruth Calder <rcalder@graywick.example>\n**To:** Jenna Moss <jmoss@${DOMAIN}>\n**Subject:** RE: September invoices and remittance\n\n` +
    "Hi Jenna, as mentioned on our call, we have moved our receivables to a new bank after an audit. Please update our remittance details before the next run. New details attached on letterhead. Do not use the old account as it will be closed at month end.\n\nThanks, Ruth",
};

const RULE_LOG = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Mailbox rules, consent and sign-ins for the AP specialist",
  from: "IT and Security",
  sentAt: "Thursday 17:20",
  content: [
    "```",
    "Get-InboxRule -Mailbox jmoss@" + DOMAIN + " -IncludeHidden",
    "  Name=\".\"  Enabled=True  SubjectOrBodyContainsWords={Graywick, remittance, bank, payment}  MoveToFolder=RSS Subscriptions  MarkAsRead=True",
    "",
    "UnifiedAuditLog  Operation=Consent to application  User=jmoss@" + DOMAIN + "  App=\"Mail Sync Pro\"  Permissions=Mail.ReadWrite Mail.Send offline_access",
    "SigninLogs  jmoss@" + DOMAIN + "  IPAddress=203.0.113.77  AppDisplayName=\"Office 365 Exchange Online\"  three weeks ago 08:51",
    "SigninLogs  jmoss@" + DOMAIN + "  IPAddress=198.51.100.140  AppDisplayName=\"Mail Sync Pro\"  daily since",
    "```",
  ].join("\n"),
};

const BANK_REPLY = {
  id: "a1",
  kind: "email" as const,
  title: "Bank fraud team update",
  from: "Fraud operations, Lakeshore Commerce Bank",
  sentAt: "Friday 08:35",
  content:
    `**From:** Fraud Operations <fraudops@lakeshorecommerce.example>\n**To:** Treasury <treasury@${DOMAIN}>\n**Subject:** Recall case 26-10-4471\n\n` +
    "The beneficiary bank reports $612,400 remains in the receiving account and has been placed on hold pending your indemnity letter. The balance, $1,230,200, left the account on Wednesday by international wire to a bank in Singapore. We cannot recall funds from the foreign bank directly. Please confirm your IC3 complaint number and law enforcement contact.",
};

const LOOKALIKE = {
  id: "a1",
  kind: "email" as const,
  title: "Second request from a lookalike domain",
  from: `Ruth Calder, ${VENDOR}`,
  sentAt: "Monday 08:02",
  content:
    `**From:** Ruth Calder <rcalder@graywick-casting.example>\n**To:** Dev Patel <dpatel@${DOMAIN}>\n**Subject:** URGENT October invoices, payment failed\n\n` +
    "Dev, Jenna is out so I am writing to you. Our bank returned last week's payment because of the account change. Please resend the October invoices, $1,912,300, to the account below today so we do not have to stop shipments.",
};

const EXTORTION = {
  id: "a1",
  kind: "email" as const,
  title: "Email to the CFO",
  from: "Unknown sender",
  sentAt: "Wednesday 09:12",
  content:
    `**From:** recovery-desk@proton.example\n**To:** CFO <cfo@${DOMAIN}>\n**Subject:** your payroll file\n\n` +
    "We have the payroll spreadsheet from your AP mailbox with names, addresses and Social Security numbers for 1,140 employees. Pay $50,000 in Bitcoin by Friday and we delete it. If not, it goes on a forum and to your staff.",
};

const BEC_WIRE_FRAUD: LibraryCrisisSimTemplate = {
  id: BEC_WIRE_FRAUD_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Vendor payment fraud at a manufacturer",
  summary:
    "A supplier calls to say a $1.84 million payment never arrived. The money went to an account set up through an attacker in an AP mailbox. Four teams race the recall window, contain the mailbox, decide whether to pay the supplier again, and handle an extortion threat over employee data.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, FIN, SEC, LEGAL],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 4, time: "15:40" },
    orgName: ORG,
    industryKey: "manufacturing",
    capabilityKeys: ["RS.MA", "RS.MI", "RS.AN", "RS.CO", "PR.AA", "GV.RR", "GV.OC", "ID.IM"],
    regulatoryClocks: [CLOCKS.fincen, CLOCKS.lender, CLOCKS.insurer],
    executiveBriefMd: [
      PROFILE,
      "",
      `At 15:22 on Thursday ${VENDOR}'s receivables lead left a voicemail: the September invoices, $1,842,600, were never received. The ERP shows the wire was released on Tuesday at 11:02 to an account at a bank ${VENDOR} has never used. The bank details were changed two weeks ago after an email in a real thread with the supplier.`,
      "",
      "The Executive, Finance and Treasury, IT and Security, and Legal teams make decisions over six days of simulated time. Three clocks can start: the 72 hour window in which FinCEN's Rapid Response Program has the best chance with international wires, a lender notice under the credit agreement, and crime policy notice.",
      "",
      "Use your own payment and incident procedures. The library playbook for this scenario is Business email compromise and wire fraud response.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Call the bank for a recall and file with IC3 within one hour of discovery.", capabilityKeys: ["RS.MA", "RS.CO"] },
    { key: "o2", text: "Contain the compromised mailbox, including inbox rules and OAuth consent, within two hours.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "o3", text: "Stop further fraudulent payments with a hold on recent bank changes and a call-back rule.", capabilityKeys: ["RS.MI", "GV.RR"] },
    { key: "o4", text: "Meet insurer, lender and employee notice duties and record the decision to pay the supplier.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "o5", text: "Make a documented extortion decision and report control changes to the board.", capabilityKeys: ["GV.RR", "ID.IM"] },
  ],
  injects: [
    inject({
      title: "The payment that never arrived",
      scenarioOffsetMin: 0,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o2"],
      clockTriggers: [CLOCKS.fincen.key, CLOCKS.insurer.key],
      expectedActions: [
        {
          team: FIN,
          actions: [
            "Calls the bank fraud line and requests a recall and a message to the beneficiary bank",
            "Files an IC3 complaint with every banking field filled in",
            "Holds pending payments to the changed account",
          ],
        },
        { team: SEC, actions: ["Preserves the bank change email with full headers", "Starts a review of the AP specialist's sign-ins and mailbox rules"] },
        { team: EXEC, actions: ["Names the CFO incident commander for the payment fraud", "Has someone call the supplier back from a number on file"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Thursday 15:40. The AP manager played the voicemail to the treasurer within ten minutes. The ERP shows the September run, **$1,842,600**, released Tuesday at 11:02 to an account at Harbor Point Bank. ${VENDOR} has banked with Lakeshore Commerce Bank for eleven years.\n\n` +
            "**Known:** the bank details were changed two weeks ago by AP specialist Jenna Moss after an email in a real thread with the supplier. The treasurer has the bank fraud line on a printed card.\n\n" +
            "**Unknown:** whether the email came from the supplier's mailbox, Jenna's, or neither.",
          artifacts: [VENDOR_CALL, CHANGE_EMAIL],
        },
        degrading: {
          narrativeMd:
            `Thursday 15:40. The voicemail sat for an hour before the AP manager heard it. The ERP shows **$1,842,600** released Tuesday at 11:02 to an account at Harbor Point Bank, which ${VENDOR} has never used.\n\n` +
            "**Known:** Jenna Moss changed the bank details two weeks ago after an email in a real supplier thread. Nobody in treasury knows the bank's fraud line; the relationship manager is on leave.\n\n" +
            "**Unknown:** whether the email came from the supplier or from inside.",
          artifacts: [VENDOR_CALL, CHANGE_EMAIL],
        },
        critical: {
          narrativeMd:
            `Thursday 15:40. The AP manager replied to the supplier by email saying the payment was sent and asking it to check its bank. ${VENDOR}'s CFO has now called the CEO directly. The ERP shows **$1,842,600** released Tuesday at 11:02 to an account at Harbor Point Bank.\n\n` +
            "**Known:** the AP manager's reply went into the same thread where the bank change came from. Jenna Moss changed the bank details two weeks ago.\n\n" +
            "**Unknown:** who else is reading that thread.",
          consequenceText: "The attacker may now know the fraud is discovered, and the recall window is closing.",
          artifacts: [VENDOR_CALL, CHANGE_EMAIL],
        },
      },
      questions: [
        {
          team: FIN,
          decisionOwner: "Treasurer",
          stem: "The money left on Tuesday at 11:02. What does treasury do in the next 30 minutes?",
          discussionPrompt: "Where is your bank's fraud line written down, and who can request a recall at 16:00 on a Thursday?",
          capabilityKeys: ["RS.MA", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Call the bank fraud line for a recall and beneficiary bank message, then file IC3 with every banking field.",
              quality: ["great", "great", "great"],
              followUp: "The bank opened recall case 26-10-4471 and messaged the beneficiary bank. IC3 has a complaint.",
              rationale: "IC3 says time is of the essence: call the bank for a recall and file a complaint at once, whatever the amount.",
              clocks: [{ key: CLOCKS.fincen.key, action: "met" }],
            },
            {
              id: "b",
              text: "Email the relationship manager with the details and wait for the bank to say whether a recall is possible.",
              quality: ["bad", "bad", "bad"],
              followUp: "An email is waiting in the relationship manager's inbox while she is on leave.",
              rationale: "Email to one person is slow and may go unread. Fraud lines exist because hours decide whether funds are frozen.",
            },
            {
              id: "c",
              text: "Confirm with the supplier that its bank has not changed before calling the bank, to be sure it is fraud.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Treasury is trying to reach the supplier's CFO before calling the bank.",
              rationale: "The voicemail already says the bank did not change. Another check costs time the recall needs.",
            },
            {
              id: "d",
              text: "Call the bank fraud line for a recall now, and file with IC3 tomorrow once the facts are written down.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The bank opened a recall case. The IC3 complaint will be filed tomorrow.",
              rationale: "The bank call is right, but the Recovery Asset Team acts on IC3 complaints, and each hour counts.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "IT director",
          stem: "Finance forwards you the bank change email. What do you do first?",
          discussionPrompt: "Can you tell from headers alone whether mail came from your tenant, the vendor's, or a lookalike?",
          capabilityKeys: ["RS.AN", "DE.AE"],
          options: [
            {
              id: "a",
              text: "Export the email with headers, check Jenna's sign-ins, inbox rules and app consents, and tell nobody in the thread.",
              quality: ["great", "great", "great"],
              followUp: "The email is preserved with headers and Jenna's sign-ins, rules and consents are under review.",
              rationale: "Headers show where the mail came from, and mailbox rules and consents are where BEC attackers persist.",
            },
            {
              id: "b",
              text: "Reset Jenna's password and close the ticket, since a reset logs the attacker out of the mailbox.",
              quality: ["bad", "bad", "bad"],
              followUp: "Jenna's password was reset. Nothing else was checked.",
              rationale: "A reset does not stop an OAuth app with consent or remove inbox rules, and app passwords survive it.",
            },
            {
              id: "c",
              text: "Delete the fraudulent emails from every mailbox so nobody acts on them again before the weekend.",
              quality: ["bad", "bad", "bad"],
              followUp: "The emails were deleted from every mailbox.",
              rationale: "Deleting the emails destroys the evidence the bank, the FBI and the insurer will ask for.",
            },
            {
              id: "d",
              text: "Export the email with headers and block the sender address, then review Jenna's mailbox in the morning.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The email is preserved and the sender is blocked. Jenna's mailbox review waits until morning.",
              rationale: "Preserving is right, but if the mail came from inside, the attacker keeps reading overnight.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: `${VENDOR}'s CFO wants an answer today. What do you set in motion?`,
          discussionPrompt: "Who owns a payment fraud in your company: finance, security, or both?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Name the CFO incident commander, have someone call the supplier back on a number on file, meet at 18:00.",
              quality: ["great", "great", "great"],
              followUp: "The CFO commands, the supplier got a call back on its known number, and the team meets at 18:00.",
              rationale: "A named owner and a call to a known number keep the supplier informed without using the compromised thread.",
            },
            {
              id: "b",
              text: "Reply to the supplier's CFO by email with what is known, so there is a written record of what was said.",
              quality: ["bad", "bad", "bad"],
              followUp: "The CEO replied by email, copying the thread.",
              rationale: "Email may be the channel the attacker controls. A known phone number is the safe channel.",
            },
            {
              id: "c",
              text: "Tell the supplier it will be paid again tomorrow so shipments continue, and sort out the loss later.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The supplier was promised a second payment tomorrow.",
              rationale: "Keeping supply is important, but promising to pay again before counsel and insurer input limits your options.",
            },
            {
              id: "d",
              text: "Ask the CFO to handle it and report back tomorrow morning, with IT and legal pulled in as needed.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The CFO is handling it and will report tomorrow.",
              rationale: "The CFO is the right owner, but without a set meeting tonight security and legal may not join in time.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "A rule named with a dot",
      scenarioOffsetMin: 110,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o3"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Disables the account, revokes sessions and removes the attacker's MFA method",
            "Removes the inbox rule and revokes the Mail Sync Pro consent",
            "Searches the tenant for the same rule pattern and app",
          ],
        },
        { team: FIN, actions: ["Holds payments to every vendor whose bank details changed in 90 days", "Verifies each by call-back to a number on file"] },
        { team: LEGAL, actions: ["Notifies the crime insurer", "Starts a legal hold on mailbox and ERP records"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 17:30. IT found the cause. Three weeks ago Jenna Moss's account signed in from **203.0.113.77** after a phishing email, and she consented to an app called **Mail Sync Pro** with read, write and send rights to her mail. A hidden inbox rule named \".\" moves every message mentioning Graywick, remittance, bank or payment to RSS Subscriptions and marks it read.\n\n" +
            "**Known:** the attacker replied inside the real supplier thread from Jenna's own mailbox. The app still signs in daily from **198.51.100.140**.\n\n" +
            "**Unknown:** whether other mailboxes have the same rule.",
          artifacts: [RULE_LOG],
        },
        degrading: {
          narrativeMd:
            "Thursday 17:30. IT found a hidden inbox rule named \".\" on Jenna Moss's mailbox that moves mail about Graywick, remittance, bank or payment to RSS Subscriptions. An app called **Mail Sync Pro** has read, write and send rights to her mail.\n\n" +
            "**Known:** two more vendor bank changes were made in the last month, both by email. One is a logistics carrier due a $340,000 payment on Friday.\n\n" +
            "**Unknown:** whether those changes are real.",
          artifacts: [RULE_LOG],
        },
        critical: {
          narrativeMd:
            "Thursday 17:30. IT reset Jenna Moss's password at 16:30. At 17:05 the attacker sent another message from her mailbox, through an app called **Mail Sync Pro** that still has send rights. A hidden inbox rule named \".\" is still hiding replies.\n\n" +
            "**Known:** two more vendor bank changes were made by email in the last month. One carrier is due $340,000 on Friday.\n\n" +
            "**Unknown:** what else the attacker sent today.",
          consequenceText: "The password reset did not remove the attacker, who is still sending mail as Jenna.",
          artifacts: [RULE_LOG],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "IT director",
          stem: "The attacker persists through an inbox rule and an OAuth app. How do you contain the mailbox?",
          discussionPrompt: "Who in your tenant can consent to apps with mail send rights, and would you know if they did?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Disable the account, revoke sessions, remove the rule, revoke the app consent, then sweep the tenant for both.",
              quality: ["great", "great", "great"],
              followUp: "The account is disabled, sessions revoked, the rule and app consent removed, and a tenant sweep is running.",
              rationale: "Microsoft's guidance: disable, revoke, remove rules and forwarding, review consented apps. A reset alone misses the app.",
            },
            {
              id: "b",
              text: "Reset the password again and turn on MFA for Jenna, which will stop any further sign-ins to the mailbox.",
              quality: ["bad", "bad", "bad"],
              followUp: "The password was reset again and MFA is on. Mail Sync Pro still has consent.",
              rationale: "An app that already has consent does not sign in with the password. MFA and resets do not stop it.",
            },
            {
              id: "c",
              text: "Remove the inbox rule and the app consent on Jenna's mailbox, and keep her working to avoid disruption.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The rule and consent are gone. Jenna's sessions are still live.",
              rationale: "Removing persistence is right, but without revoking sessions the attacker may still be signed in.",
            },
            {
              id: "d",
              text: "Turn off user consent to all third-party apps in the tenant tonight and leave the mailbox as it is.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "User consent is off for everyone. The existing consent and the rule remain.",
              rationale: "Turning off consent prevents new grants, but the existing grant and the rule keep working.",
            },
          ],
        },
        {
          team: FIN,
          decisionOwner: "CFO",
          stem: "Two more vendor bank changes came by email this month, one due $340,000 on Friday. What do you do?",
          discussionPrompt: "How long would it take you to list every vendor bank change in the last 90 days?",
          capabilityKeys: ["RS.MI", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Hold payments to every vendor with a bank change in 90 days and verify each by call-back to a known number.",
              quality: ["great", "great", "great"],
              followUp: "Payments to recently changed vendors are on hold until each is verified by call-back.",
              rationale: "A hold scoped to recent changes stops the next fraud without stopping payments to every vendor.",
            },
            {
              id: "b",
              text: "Stop every outgoing payment to every vendor until the investigation is complete, likely two weeks.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Every vendor payment is stopped.",
              rationale: "A full stop is safe but harms vendors who did nothing wrong. Defensible only if the scope is unknown.",
            },
            {
              id: "c",
              text: "Pay the carrier on Friday as scheduled, since its change request came with a signed letter on letterhead.",
              quality: ["bad", "bad", "bad"],
              followUp: "The carrier payment is scheduled for Friday to the new account.",
              rationale: "Letterhead is easy to forge. The Graywick change came with letterhead too.",
            },
            {
              id: "d",
              text: "Call the carrier to verify its change before Friday, and review the other change next week.",
              quality: ["good", "neutral", "bad"],
              followUp: "The carrier will be verified before Friday. The other change is unreviewed.",
              rationale: "Verifying the next payment is right, but every recent change came through the same compromised channel.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The loss is $1.84 million. What does Legal do tonight?",
          discussionPrompt: "Does this loss fall under your crime policy, your cyber policy, or both, and what are the notice terms?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Notify the crime insurer, issue a legal hold on mailbox and ERP records, and check the lender notice terms.",
              quality: ["great", "great", "great"],
              followUp: "The crime insurer has notice, a legal hold is out, and the credit agreement terms are being checked.",
              rationale: "Crime policies often require prompt notice and proof of loss, and a loss of this size may trigger covenants.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
            {
              id: "b",
              text: "Wait to notify any insurer until the bank says how much can be recovered, so the claim is accurate.",
              quality: ["bad", "bad", "bad"],
              followUp: "No insurer has been notified.",
              rationale: "Notice is not the claim. Late notice can jeopardize cover, and the claim amount can be updated.",
            },
            {
              id: "c",
              text: "Start an HR investigation of Jenna Moss for failing to follow payment procedures, before anything else.",
              quality: ["bad", "bad", "bad"],
              followUp: "HR has opened an investigation of Jenna Moss.",
              rationale: "There was no call-back rule to follow. Blaming one person early discourages others from reporting.",
            },
            {
              id: "d",
              text: "Notify the crime insurer tonight and leave the legal hold and lender review to the morning.",
              quality: ["good", "good", "neutral"],
              followUp: "The crime insurer has notice. The hold and lender review wait until morning.",
              rationale: "Insurer notice is the right first call. A hold delayed overnight risks routine mailbox cleanup.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Half frozen, half gone",
      scenarioOffsetMin: 1040,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o4"],
      clockTriggers: [CLOCKS.lender.key],
      expectedActions: [
        {
          team: FIN,
          actions: [
            "Sends the indemnity letter to release the frozen $612,400",
            "Gives the FBI the international wire details so the case can reach FinCEN's Rapid Response Program",
          ],
        },
        { team: EXEC, actions: ["Decides on paying the supplier again with counsel and insurer input", "Records the decision and the basis"] },
        { team: LEGAL, actions: ["Gives the lender notice under the credit agreement", "Confirms the crime policy social engineering sublimit and proof of loss"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Friday 09:00. The bank's fraud team writes that **$612,400** is still in the receiving account and on hold. The other **$1,230,200** left on Wednesday by international wire to a bank in Singapore. The FBI agent assigned through IC3 says the case is being passed to FinCEN, which can ask the foreign financial intelligence unit to act.\n\n" +
            `**Known:** ${VENDOR} has offered to keep shipping for two weeks if a payment plan is agreed. The crime policy has a $500,000 sublimit for social engineering fraud.\n\n` +
            "**Unknown:** whether the Singapore funds can be stopped.",
          artifacts: [BANK_REPLY],
        },
        degrading: {
          narrativeMd:
            "Friday 09:00. The bank's fraud team writes that **$612,400** is on hold. The other **$1,230,200** left on Wednesday to a bank in Singapore. The IC3 complaint was filed this morning, so the international wire was reported outside the 72 hour window FinCEN mentions.\n\n" +
            `**Known:** ${VENDOR} says it will stop shipping on Monday unless paid. Castings from ${VENDOR} feed the main machining line. The crime policy has a $500,000 sublimit for social engineering fraud.\n\n` +
            "**Unknown:** whether the Singapore funds can be stopped.",
          artifacts: [BANK_REPLY],
        },
        critical: {
          narrativeMd:
            "Friday 09:00. The bank's fraud team writes that **$612,400** is on hold. The other **$1,230,200** left on Wednesday to a bank in Singapore. No IC3 complaint has been filed yet.\n\n" +
            `**Known:** ${VENDOR} stopped shipping this morning; the main machining line has two days of castings. The logistics carrier was paid $340,000 to a new account on Friday at 07:00 by an AP specialist working from the payment run.\n\n` +
            "**Unknown:** whether the carrier payment was also fraud.",
          consequenceText: "A second payment may be lost, and the supplier has stopped shipping.",
          artifacts: [BANK_REPLY],
        },
      },
      questions: [
        {
          team: FIN,
          decisionOwner: "Treasurer",
          stem: "Part of the money is frozen and part has gone abroad. What do you do today?",
          discussionPrompt: "Does your bank know how to request help on an international wire, and who is your law enforcement contact?",
          capabilityKeys: ["RS.CO", "RC.RP"],
          options: [
            {
              id: "a",
              text: "Send the indemnity letter for the frozen funds and give the FBI full wire details for the FinCEN request.",
              quality: ["great", "great", "great"],
              followUp: "The indemnity letter is with the bank and the FBI has the Singapore wire details.",
              rationale: "The frozen funds need the letter to come back, and FinCEN works through law enforcement, not victims.",
            },
            {
              id: "b",
              text: "Hire a recovery firm that offers to trace and return the Singapore funds for a 20 percent success fee.",
              quality: ["bad", "bad", "bad"],
              followUp: "A recovery firm has been engaged on a success fee.",
              rationale: "Recovery comes through banks and law enforcement. Paid recovery offers after a fraud are often a second scam.",
            },
            {
              id: "c",
              text: "Contact the Singapore bank directly by email and ask it to freeze the account until your lawyers arrive.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "An email went to the Singapore bank's general address.",
              rationale: "A foreign bank rarely acts on a stranger's email. The FinCEN channel exists for this.",
            },
            {
              id: "d",
              text: "Send the indemnity letter today and ask the bank to handle the international part with its correspondent.",
              quality: ["good", "good", "neutral"],
              followUp: "The indemnity letter is sent. The bank will try its correspondent route.",
              rationale: "Recovering the frozen funds is right. The bank route may help, but law enforcement and FinCEN add reach.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: `${VENDOR} is owed $1.84 million and needs to be paid to keep shipping. What do you decide?`,
          discussionPrompt: "Whose process failed, yours or the supplier's, and does that change who bears the loss?",
          capabilityKeys: ["GV.RR", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Agree a payment plan with the supplier to its verified account, with counsel and insurer input, on the record.",
              quality: ["great", "great", "great"],
              followUp: "A payment plan is agreed to the verified account. Counsel and the insurer were consulted and the decision is recorded.",
              rationale: "The supplier is owed and was not at fault here. A plan keeps supply without giving up the insurance claim.",
            },
            {
              id: "b",
              text: "Refuse to pay until the stolen funds are recovered, since the supplier should share the loss with you.",
              quality: ["bad", "bad", "bad"],
              followUp: `${VENDOR} has been told it will not be paid until funds are recovered.`,
              rationale: "The attacker was in your mailbox. Refusing to pay a supplier that did nothing wrong risks supply and the relationship.",
            },
            {
              id: "c",
              text: "Pay the full amount again today to the account in the most recent email from the supplier thread.",
              quality: ["bad", "bad", "bad"],
              followUp: "A second payment went to the account in the latest email.",
              rationale: "The latest email in that thread may be from the attacker. Payment details by email are what failed.",
            },
            {
              id: "d",
              text: "Pay the full amount again today to the verified account and settle the loss with the insurer afterward.",
              quality: ["good", "good", "great"],
              followUp: "The full amount went to the verified account.",
              rationale: "Paying the verified account in full is safe and protects supply, which matters most if shipping has stopped.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The credit agreement requires notice of a loss over $1 million. What do you do?",
          discussionPrompt: "Which of your contracts have notice terms that a fraud loss could trigger?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Notify the lender within the window with known facts and recovery status, and plan updates as funds return.",
              quality: ["great", "great", "great"],
              followUp: "The lender has notice with the facts and recovery status.",
              rationale: "Prompt, factual notice keeps the company in compliance and avoids a covenant default over a late notice.",
              clocks: [{ key: CLOCKS.lender.key, action: "met" }],
            },
            {
              id: "b",
              text: "Hold off on lender notice, because if the frozen funds come back the net loss may fall under $1 million.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "Lender notice is on hold pending recovery.",
              rationale: "Recovery is uncertain and the clause may count the gross loss. Waiting risks a late notice default.",
            },
            {
              id: "c",
              text: "Tell the lender informally by phone and skip the written notice, to keep the matter low key.",
              quality: ["bad", "bad", "bad"],
              followUp: "The relationship manager heard about it by phone.",
              rationale: "Credit agreements require written notice. A call does not satisfy the clause.",
            },
            {
              id: "d",
              text: "Notify the lender in writing with the gross loss now, and leave recovery details for the quarterly report.",
              quality: ["good", "good", "good"],
              followUp: "The lender has written notice of the gross loss.",
              rationale: "Written notice meets the clause. Recovery details help the lender but can follow.",
              clocks: [{ key: CLOCKS.lender.key, action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Payment failed, please resend",
      scenarioOffsetMin: 5420,
      plannedDelayMin: 10,
      objectiveKeys: ["o3", "o4"],
      expectedActions: [
        { team: FIN, actions: ["Refuses the request and verifies by phone", "Puts a call-back rule and two-person bank change approval in force"] },
        { team: SEC, actions: ["Blocks the lookalike domain and reports it", "Tells customers and suppliers to verify payment requests by phone"] },
        {
          team: LEGAL,
          actions: ["Determines whether the payroll file in the mailbox is a breach of employee data", "Plans notice to employees under state law"],
        },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 10:00. Another AP specialist, Dev Patel, received a request from **graywick-casting.example**, one letter off the real domain, to resend $1,912,300 because last week's payment \"failed\". He called Graywick on the number in the ERP and it was not them.\n\n" +
            "**Known:** forensics found Jenna's mailbox held a payroll spreadsheet sent in March, with names, addresses and Social Security numbers for 1,140 employees. The app could read all mail.\n\n" +
            "**Unknown:** whether the attacker downloaded it.",
          artifacts: [LOOKALIKE],
        },
        degrading: {
          narrativeMd:
            "Monday 10:00. Dev Patel received a request from **graywick-casting.example**, one letter off the real domain, to resend $1,912,300. He forwarded it to the treasurer asking whether to pay. It sat for two hours.\n\n" +
            "**Known:** Jenna's mailbox held a payroll spreadsheet with names, addresses and Social Security numbers for 1,140 employees. The app had read rights to all mail.\n\n" +
            "**Unknown:** whether the attacker downloaded it.",
          artifacts: [LOOKALIKE],
        },
        critical: {
          narrativeMd:
            "Monday 10:00. Dev Patel paid **$1,912,300** at 09:20 after a request from **graywick-casting.example**, one letter off the real domain, said last week's payment failed. Two customers have emailed asking why Pellworth sent them new bank details.\n\n" +
            "**Known:** Jenna's mailbox held a payroll spreadsheet with Social Security numbers for 1,140 employees.\n\n" +
            "**Unknown:** how many customers got fake invoices.",
          consequenceText: "A second large payment is lost and the attacker is now invoicing your customers.",
          artifacts: [LOOKALIKE],
        },
      },
      questions: [
        {
          team: FIN,
          decisionOwner: "CFO",
          stem: "A second request arrived from a lookalike domain. What changes in finance today?",
          discussionPrompt: "Would your current controls have stopped the first payment? Which one?",
          capabilityKeys: ["GV.RR", "ID.IM"],
          options: [
            {
              id: "a",
              text: "Call-back to a known number for any bank change, two-person approval in the ERP, and a hold on new accounts.",
              quality: ["great", "great", "great"],
              followUp: "Call-back, two-person approval and a hold on new accounts are in force from today.",
              rationale: "These three controls break the BEC pattern: a change by email alone cannot reach a payment.",
            },
            {
              id: "b",
              text: "Send all AP staff a reminder to be careful with email and keep the current payment process as it is.",
              quality: ["bad", "bad", "bad"],
              followUp: "AP staff got a reminder. The process is unchanged.",
              rationale: "A reminder does not change the process that failed. The same request would succeed again.",
            },
            {
              id: "c",
              text: "Require the CFO to approve every vendor payment personally until the end of the quarter.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The CFO now approves every vendor payment.",
              rationale: "More approval does not verify bank details. A busy CFO approving every payment adds delay, not checks.",
            },
            {
              id: "d",
              text: "Require call-back on bank changes from today, and design the ERP approval change next quarter.",
              quality: ["good", "good", "neutral"],
              followUp: "Call-back on bank changes is in force. ERP changes are planned.",
              rationale: "Call-back is the most important control. Leaving single-person ERP edits for a quarter keeps a gap.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "IT director",
          stem: "The attacker now uses a lookalike domain. What do you do outside your own mailboxes?",
          discussionPrompt: "Do you watch for lookalikes of your domain and your top suppliers' domains?",
          capabilityKeys: ["RS.MI", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Block and report the lookalike, warn suppliers and customers to verify payment requests by phone.",
              quality: ["great", "great", "great"],
              followUp: "The lookalike is blocked and reported, and suppliers and customers have a warning.",
              rationale: "The attacker has your threads and contacts. Others in those threads are the next targets.",
            },
            {
              id: "b",
              text: "Block the lookalike domain at the gateway and say nothing outside, to avoid alarming customers.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The lookalike is blocked for inbound mail. Customers and suppliers have not been told.",
              rationale: "Blocking protects you only. Customers who receive fake invoices from the lookalike are still exposed.",
            },
            {
              id: "c",
              text: "Reply to the lookalike sender to say the fraud has been reported to the FBI, so it stops trying.",
              quality: ["bad", "bad", "bad"],
              followUp: "The attacker received a reply from Pellworth.",
              rationale: "Engaging the attacker gains nothing and tells it which addresses are watched.",
            },
            {
              id: "d",
              text: "Block the lookalike and warn suppliers, and check whether customers were targeted next week.",
              quality: ["good", "good", "neutral"],
              followUp: "The lookalike is blocked and suppliers have a warning. Customers have not been checked.",
              rationale: "Supplier warnings help, but if Pellworth's own threads were read, customers may already have fake invoices.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The mailbox held Social Security numbers for 1,140 employees and the app could read all mail. How do you treat it?",
          discussionPrompt: "Which state breach laws apply to your employees, and when does each clock start?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Treat it as a likely breach, have outside counsel map state duties, and plan employee notice with an offer.",
              quality: ["great", "great", "great"],
              followUp: "Counsel is mapping state duties and employee notice with a monitoring offer is being prepared.",
              rationale: "An app with full mail read rights for three weeks makes access to the file likely. State law clocks may be running.",
            },
            {
              id: "b",
              text: "Do nothing unless the payroll file shows up online, since there is no proof it was downloaded.",
              quality: ["bad", "bad", "bad"],
              followUp: "No employee notice is planned.",
              rationale: "Many state laws turn on reasonable belief of acquisition, not proof. Waiting for a leak can miss deadlines.",
            },
            {
              id: "c",
              text: "Tell all employees today that their Social Security numbers were stolen and offer credit monitoring.",
              quality: ["neutral", "good", "good"],
              followUp: "Employees were told their numbers were stolen.",
              rationale: "Fast notice helps employees protect themselves, but stating theft as fact goes beyond what is known.",
            },
            {
              id: "d",
              text: "Ask forensics to confirm whether the file was opened before deciding on notice, with a one week deadline.",
              quality: ["good", "neutral", "neutral"],
              followUp: "Forensics has a week to confirm.",
              rationale: "A short forensic check is reasonable, but OAuth access often leaves no record of which messages were read.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "An offer to delete the payroll file",
      scenarioOffsetMin: 8540,
      plannedDelayMin: 10,
      objectiveKeys: ["o5", "o4"],
      expectedActions: [
        {
          team: EXEC,
          actions: [
            "Does not pay, after OFAC, FBI and insurer input, and records the decision",
            "Tells employees before or with any publication",
          ],
        },
        { team: LEGAL, actions: ["Preserves the email and reports it to the FBI", "Sends employee notices on the state law timeline"] },
        { team: FIN, actions: ["Reports the loss, recovery and control changes to the board", "Files proof of loss with the crime insurer"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 14:00. The bank returned the frozen **$612,400**. The FBI says FinCEN's request reached the foreign unit in time to hold part of the Singapore funds; the amount is not yet confirmed. This morning the CFO received an email: pay **$50,000** in Bitcoin by Friday or the payroll file goes on a forum.\n\n" +
            "**Known:** employee notices are drafted. The board meets Thursday.\n\n" +
            "**Unknown:** whether the sender really has the file.",
          artifacts: [EXTORTION],
        },
        degrading: {
          narrativeMd:
            "Wednesday 14:00. The bank returned the frozen **$612,400**. The Singapore funds have not been traced. This morning the CFO received an email: pay **$50,000** in Bitcoin by Friday or the payroll file goes on a forum.\n\n" +
            "**Known:** employee notices are not drafted yet. The board meets Thursday.\n\n" +
            "**Unknown:** whether the sender really has the file.",
          artifacts: [EXTORTION],
        },
        critical: {
          narrativeMd:
            "Wednesday 14:00. The frozen **$612,400** is back. The **$1,912,300** paid on Monday went abroad within hours. This morning the CFO received an email: pay **$50,000** in Bitcoin by Friday or the payroll file goes on a forum. Three employees have already received phishing texts using their home addresses.\n\n" +
            "**Known:** employee notices have not gone out. The board meets Thursday.\n\n" +
            "**Unknown:** how many employees have been targeted.",
          consequenceText: "Employee data is being used before employees have been told.",
          artifacts: [EXTORTION],
        },
      },
      questions: [
        {
          team: EXEC,
          decisionOwner: "CEO",
          type: "ransom",
          stem: "The sender wants $50,000 to delete the payroll file. What do you decide?",
          discussionPrompt: "Who approves an extortion payment in your company, and what would they need to see first?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Do not pay, after OFAC, FBI and insurer input, notify employees now, and record the decision and reasons.",
              quality: ["great", "great", "great"],
              followUp: "The company will not pay. Employees are being notified and the decision is recorded.",
              rationale: "Payment buys a promise from a criminal and does not end notice duties. Employees need to protect themselves.",
            },
            {
              id: "b",
              text: "Pay the $50,000 quietly, since it is small next to the fraud loss and keeps employees' data off the forum.",
              quality: ["bad", "bad", "bad"],
              followUp: "The company paid $50,000.",
              rationale: "Deletion cannot be verified, sanctions risk was not screened, and employees still need notice.",
            },
            {
              id: "c",
              text: "Ask the sender for proof that it has the file before deciding, through a reply from the CFO's mailbox.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The CFO replied asking for proof.",
              rationale: "Proof matters, but replying without counsel, the FBI and the insurer engages the attacker on its terms.",
            },
            {
              id: "d",
              text: "Do not pay or reply, report to the FBI, and send employee notices once counsel finishes the state map.",
              quality: ["good", "good", "neutral"],
              followUp: "The company will not pay. Employee notices wait for the state map.",
              rationale: "Not paying is right, but with phishing under way employees need notice now, not after the map.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Employee notices are due. What goes out, and when?",
          discussionPrompt: "What will employees ask first, and who answers?",
          capabilityKeys: ["RS.CO", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Notice to all 1,140 employees this week with what happened, credit monitoring, and a line for questions.",
              quality: ["great", "great", "great"],
              followUp: "Notices go to all 1,140 employees this week with monitoring and a help line.",
              rationale: "Plain, prompt notice with help meets state law and limits harm from the phishing already seen.",
            },
            {
              id: "b",
              text: "Notify only employees whose data appears online, if any, after the Friday deadline passes.",
              quality: ["bad", "bad", "bad"],
              followUp: "Notices wait until after Friday.",
              rationale: "The file was reasonably likely accessed. Waiting for publication is not a test any state law uses.",
            },
            {
              id: "c",
              text: "Post a notice on the intranet and let managers answer questions in team meetings this week.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "An intranet notice is posted and managers are briefing teams.",
              rationale: "Internal messages help, but state law usually needs individual notice with set contents.",
            },
            {
              id: "d",
              text: "Notify all employees by email this week with monitoring, and send letters to former employees next month.",
              quality: ["good", "good", "good"],
              followUp: "Current employees got notice by email. Former employees will get letters next month.",
              rationale: "Current staff are covered quickly. Former employees in the file are owed notice on the same timeline.",
            },
          ],
        },
        {
          team: FIN,
          decisionOwner: "CFO",
          stem: "The board meets Thursday. What do you report?",
          discussionPrompt: "What would your auditors say about the control that failed?",
          capabilityKeys: ["ID.IM", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Loss, recovery, insurance status, the failed controls and the fixes in force, with owners and dates.",
              quality: ["great", "great", "great"],
              followUp: "The board has the loss, recovery, insurance status and control fixes with owners.",
              rationale: "The board needs the whole picture, including which control failed and what changed, to oversee it.",
            },
            {
              id: "b",
              text: "The net loss after recovery, with the cause described as a single employee's error that has been addressed.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board heard it was one employee's error.",
              rationale: "The process had no call-back rule. Blaming a person hides the control gap from the board.",
            },
            {
              id: "c",
              text: "A short oral update, with a full written report after the insurance claim is settled in a few months.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The board got an oral update.",
              rationale: "Waiting for the claim delays oversight of controls that need fixing now.",
            },
            {
              id: "d",
              text: "The loss, recovery and control fixes, and ask the auditors to review AP controls before year end.",
              quality: ["good", "good", "good"],
              followUp: "The board has the report and the auditors will review AP controls.",
              rationale: "An independent review is sound. Insurance status and owners for each fix complete the picture.",
            },
          ],
        },
      ],
    }),
  ],
};

export const GENERAL_CRISISSIM_BEC_WIRE_FRAUD = BEC_WIRE_FRAUD;
