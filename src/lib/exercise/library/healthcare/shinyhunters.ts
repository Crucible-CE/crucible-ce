// Crisis Sim: ShinyHunters (UNC6040) style Salesforce vishing, bulk export
// and delayed extortion against a healthcare analytics business associate.
// Grounded in GTIG's 2025 UNC6040 and UNC6395 reporting and the October 2025
// leak site pattern, as summarized in the October 2026 threat brief. Matches
// playbooks/salesforce-vishing-data-theft.md.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { CLOCKS, CUSTOMERS, DOMAIN, HEALTHCARE_COLLECTION_LABEL, ORG, ORG_PROFILE_MD, PEOPLE } from "./org";

export const SHINYHUNTERS_TEMPLATE_ID = "lib-health-crisissim-salesforce-vishing";

const EXEC = "Executive";
const LEGAL = "Legal and Privacy";
const SEC = "Security";
const CS = "Customer Success";

const EXTORTION = {
  id: "a1",
  kind: "email" as const,
  title: "Extortion email",
  from: "ShinyHunters",
  sentAt: "Monday 07:52",
  content:
    `**From:** shinyhunters@onionmail.example\n**To:** ${PEOPLE.ceo} <dana.whitlock@${DOMAIN}>; ${PEOPLE.gc} <priya.raman@${DOMAIN}>\n**Subject:** Quarrystone Salesforce\n\n` +
    "We are ShinyHunters. We downloaded your Salesforce: accounts, contacts, and every support case with attachments. Your hospital customers' staff wrote patient details in those cases. Sample attached: 25 cases.\n\n" +
    "Pay 18 BTC within 72 hours or we publish everything and contact each of your customers ourselves. Reply to this address only.",
};

const CONNECTED_APP_LOG = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Salesforce Setup Audit Trail and API events",
  from: "Security",
  sentAt: "Monday 12:10",
  content: [
    "```",
    "2026-08-18 14:07:33  Setup Audit Trail  User=jenna.park@" + DOMAIN + "  Action=\"Connected App OAuth usage: approved\"  App=\"Data Loader\"  ConsumerKey=3MVG9...k2Qx",
    "2026-08-18 14:09:02  LoginHistory  User=jenna.park@" + DOMAIN + "  LoginType=\"Remote Access 2.0\"  Application=\"Data Loader\"  SourceIp=203.0.113.88",
    "2026-08-18 14:11:40  ApiEvent  Operation=query  Object=Account  RowsProcessed=4,212  SourceIp=203.0.113.88",
    "2026-08-18 14:15:12  ApiEvent  Operation=queryAll  Object=Case  RowsProcessed=186,440  SourceIp=203.0.113.88",
    "2026-08-18 15:02:51  ApiEvent  Operation=query  Object=ContentVersion  RowsProcessed=61,907  SourceIp=203.0.113.88",
    "```",
  ].join("\n"),
};

const SHINYHUNTERS: LibraryCrisisSimTemplate = {
  id: SHINYHUNTERS_TEMPLATE_ID,
  collection: HEALTHCARE_COLLECTION_LABEL,
  title: "Salesforce vishing and data theft at a health analytics company",
  summary:
    "An extortion email reveals that a support manager approved a fake Data Loader app over a phone call nine weeks ago. Four teams decide whether CRM case data is PHI, which customers to notify as a business associate, and how to answer the extortion and the leak site.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, LEGAL, SEC, CS],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 1, time: "08:30" },
    orgName: ORG,
    capabilityKeys: ["PR.AA", "GV.SC", "RS.MA", "RS.AN", "RS.CO", "GV.OC", "GV.RR", "RC.CO"],
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.baa, CLOCKS.hipaa, CLOCKS.stateAg, CLOCKS.sec],
    executiveBriefMd: [
      ORG_PROFILE_MD,
      "",
      "Salesforce holds every customer account, contact and support case. Hospital and health plan staff open cases when a dashboard or feed looks wrong, and they often paste patient examples or attach extracts so support can reproduce the problem.",
      "",
      "The Executive, Legal and Privacy, Security and Customer Success teams make decisions over ten days of simulated time, starting the morning an extortion email arrives. Five clocks can start: cyber insurer notice, the contractual BAA notice to customers, HIPAA business associate notice, Texas attorney general notice and the SEC Form 8-K.",
      "",
      "Use your own incident response plan. The library playbook for this scenario is Salesforce vishing and data theft response.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Revoke the attacker's Salesforce access and rotate every secret found in exported records within one day.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "o2", text: "Decide and record whether the exported case data is PHI under the BAAs, with the basis.", capabilityKeys: ["GV.OC", "RS.AN"] },
    { key: "o3", text: "Send BAA notices to every affected customer inside the contract window with confirmed facts.", capabilityKeys: ["RS.CO", "GV.OC"] },
    { key: "o4", text: "Make a recorded extortion decision with OFAC, insurer and FBI input, and a recorded materiality determination.", capabilityKeys: ["GV.RR", "GV.OC"] },
    { key: "o5", text: "Keep customer relationships through one owner per account and one consistent message.", capabilityKeys: ["RS.CO", "RC.CO"] },
  ],
  injects: [
    inject({
      title: "An email from ShinyHunters",
      scenarioOffsetMin: 0,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o2"],
      clockTriggers: [CLOCKS.insurer.key],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Blocks the unknown connected app and revokes its OAuth tokens",
            "Exports Setup Audit Trail, login history and API event logs before anything is changed",
            "Opens a case with Salesforce security",
          ],
        },
        { team: EXEC, actions: ["Declares an incident and names an incident commander", "Instructs that nobody replies to the sender"] },
        { team: LEGAL, actions: ["Engages breach counsel and notifies the insurer", "Starts a review of whether case data is PHI under the BAAs"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 08:30. The CEO and general counsel each received an email at 07:52 from a sender calling itself **ShinyHunters**. It attaches 25 support cases. Three of them include patient names and medical record numbers that hospital staff pasted in to report a dashboard problem.\n\n" +
            "**Known:** the cases are real. Salesforce Event Monitoring is licensed and keeps API events.\n\n" +
            "**Unknown:** how the data left, and when.\n\n" +
            "**Assumed:** the sender is who it says, though GTIG treats the link between the theft and extortion clusters as an inference.",
          artifacts: [EXTORTION],
        },
        degrading: {
          narrativeMd:
            "Monday 08:30. The CEO and general counsel each received an email at 07:52 from **ShinyHunters** with 25 support cases attached, some with patient names and medical record numbers. The general counsel forwarded it to the whole executive team and two board members.\n\n" +
            "**Known:** the cases are real.\n\n" +
            "**Unknown:** how the data left. Event Monitoring was never bought, so detailed API event logs may not reach back far enough.",
          artifacts: [EXTORTION],
        },
        critical: {
          narrativeMd:
            "Monday 08:30. The email from **ShinyHunters** reached the CEO and general counsel at 07:52 with 25 support cases attached, some with patient details. At 08:10 the CFO replied from his phone asking what they want.\n\n" +
            "**Known:** the cases are real and the attacker now knows someone is reading.\n\n" +
            "**Unknown:** how the data left. Detailed API event logs were never kept.",
          consequenceText: "The attacker has a reply and the clock in the email is running.",
          artifacts: [EXTORTION],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The data came from Salesforce, and nobody knows how yet. What is your first move in the org?",
          discussionPrompt: "Who in your company can list every connected app approved in Salesforce today, and how long are its logs kept?",
          capabilityKeys: ["RS.MI", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Export the audit trail and API logs, then block unknown connected apps, revoke their tokens and call Salesforce.",
              quality: ["great", "great", "great"],
              followUp: "Logs are exported, unknown connected apps are blocked with their tokens revoked, and Salesforce security has a case.",
              rationale: "GTIG's guidance is to review connected apps and Data Loader use. Preserving logs first keeps the evidence of what was taken.",
            },
            {
              id: "b",
              text: "Force a password reset for every Salesforce user and require MFA at the next login across the org.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "Every Salesforce password was reset. Connected app tokens were not touched.",
              rationale: "OAuth tokens granted to a connected app keep working after a password reset. This misses the likely access path.",
            },
            {
              id: "c",
              text: "Reply to the sender from a new mailbox and ask how they got in, so the team knows where to look.",
              quality: ["bad", "bad", "bad"],
              followUp: "Security replied to the sender from a new mailbox.",
              rationale: "Contact outside a planned negotiation, without counsel or the insurer, gives the attacker leverage and helps nobody.",
            },
            {
              id: "d",
              text: "Turn off API access for all profiles today, even though customer integrations and reports will break.",
              quality: ["good", "good", "good"],
              followUp: "API access is off for every profile. Customer case integrations are failing.",
              rationale: "It closes the door quickly, but blunt cuts break customer integrations and do not preserve the evidence first.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The email gives 72 hours. What do you set in motion this morning?",
          discussionPrompt: "Who is allowed to reply to an extortion email in your company, and does everyone who might receive one know that?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Declare an incident, name the CISO incident commander, and tell recipients not to reply or forward.",
              quality: ["great", "great", "great"],
              followUp: "An incident is declared, the CISO commands it, and recipients have been told not to reply or forward.",
              rationale: "A commander and a no reply rule stop the response from fragmenting while the facts are gathered.",
            },
            {
              id: "b",
              text: "Treat it as a likely bluff until Security proves data left, and keep it to the executive team for now.",
              quality: ["bad", "bad", "bad"],
              followUp: "The email is being treated as a likely bluff and kept within the executive team.",
              rationale: "The samples are real. Holding back declaration delays counsel, insurer notice and the BAA review.",
            },
            {
              id: "c",
              text: "Call the board chair now and ask the board to decide on payment before the 72 hours run out.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The board chair has been asked to put payment to the board.",
              rationale: "The board should know early, but a payment decision now comes before scope, sanctions checks or counsel.",
            },
            {
              id: "d",
              text: "Bring in breach counsel and the IR retainer now, and hold a full leadership call at noon with facts.",
              quality: ["good", "good", "good"],
              followUp: "Counsel and the IR retainer are engaged and leadership meets at noon.",
              rationale: "Engaging counsel and the retainer is right, but nobody owns the response until noon.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "Some sample cases contain patient names and MRNs. How do you treat Salesforce case data under the BAAs?",
          discussionPrompt: "Do your BAAs say where PHI may be stored, and does anyone check that support cases stay out of it?",
          capabilityKeys: ["GV.OC", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Treat case data as PHI where it identifies patients, notify the insurer, and start a record by record review.",
              quality: ["great", "great", "great"],
              followUp: "Case data that identifies patients is being treated as PHI. The insurer has notice and a record review started.",
              rationale: "PHI received from a covered entity is PHI wherever it is stored. The samples show it reached Salesforce.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
            {
              id: "b",
              text: "Treat Salesforce as outside the BAAs, since it holds business contacts, not the analytics warehouse.",
              quality: ["bad", "bad", "bad"],
              followUp: "Legal treated Salesforce as outside the BAAs.",
              rationale: "Where PHI is stored does not change what it is. The samples already show patient identifiers in cases.",
            },
            {
              id: "c",
              text: "Hold the PHI question until the full export is reviewed, and notify the insurer only once it is decided.",
              quality: ["bad", "bad", "bad"],
              followUp: "The PHI question and insurer notice wait for the full review.",
              rationale: "Insurer notice is usually a condition of cover and does not need a final answer on PHI.",
            },
            {
              id: "d",
              text: "Notify the insurer now and ask breach counsel for a written opinion on case data and PHI by tomorrow.",
              quality: ["good", "good", "neutral"],
              followUp: "The insurer has notice. Counsel's written opinion is due tomorrow.",
              rationale: "Sound, but the sample already answers the question for those records and the BAA window may be running.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
          ],
        },
      ],
    }),
    inject({
      title: "Nine weeks ago, a call from IT",
      scenarioOffsetMin: 240,
      plannedDelayMin: 8,
      objectiveKeys: ["o1", "o2", "o3"],
      clockTriggers: [CLOCKS.baa.key, CLOCKS.hipaa.key],
      expectedActions: [
        {
          team: SEC,
          actions: ["Rotates every credential and token found in exported cases", "Restricts API access by IP range and profile", "Checks whether the found secrets were used"],
        },
        { team: LEGAL, actions: ["Records the discovery time and its basis", "Lists affected customers and their BAA notice windows"] },
        { team: CS, actions: ["Names one owner for each affected customer", "Prepares to call affected customers before written notice"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 12:30. Salesforce logs show that on **18 August** a support manager, **Jenna Park**, approved a connected app named Data Loader while on a call with someone posing as IT. Within an hour it exported every account, contact and support case and **61,907 attachments** from **203.0.113.88**.\n\n" +
            "**Known:** cases from 9 customers name about **2,100 patients**. Two cases hold a customer's SFTP password.\n\n" +
            "**Unknown:** whether the SFTP password was used.",
          artifacts: [CONNECTED_APP_LOG],
        },
        degrading: {
          narrativeMd:
            "Monday 12:30. Jenna Park, a support manager, remembers a call from someone posing as IT in **August**, who walked her through approving an app. API event logs from then are gone. The connected app is still authorized and its last use was yesterday.\n\n" +
            "**Known:** cases and attachments from 22 customers name about **48,000 patients**. Several cases hold SFTP passwords and a storage SAS URL for a customer upload container.\n\n" +
            "**Unknown:** what was exported. Only the attacker's sample shows it.",
        },
        critical: {
          narrativeMd:
            "Monday 12:30. Jenna Park recalls a call from IT in August and approving an app. API logs from then are gone, and the app is still authorized. A storage **SAS URL** pasted in a case was used from **203.0.113.41** six weeks ago to list and download a customer upload container with claims files.\n\n" +
            "**Known:** cases from 22 customers name about **48,000 patients**, and the upload container held files on about **310,000 members** of one health plan.\n\n" +
            "**Unknown:** what else the found secrets opened.",
          consequenceText: "Secrets in CRM records turned a CRM theft into a cloud data theft.",
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Exported cases hold customer passwords and a storage SAS URL. What do you do with secrets found in the data?",
          discussionPrompt: "How would you find every secret pasted into your CRM, and who owns rotating customer side credentials?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Rotate each secret found, rotate storage keys to kill the SAS, and check logs for any use of them.",
              quality: ["great", "great", "great"],
              followUp: "Every found secret is rotated, both storage keys were rotated to invalidate the SAS, and use is being checked.",
              rationale: "UNC6395 hunted CRM data for credentials. Rotating both account keys invalidates SAS signed with them.",
            },
            {
              id: "b",
              text: "Delete the cases that contain secrets so the exposed values are no longer stored anywhere.",
              quality: ["bad", "bad", "bad"],
              followUp: "Cases with secrets were deleted. The secrets still work.",
              rationale: "The attacker already has the secrets. Deleting the cases destroys evidence and leaves the credentials live.",
            },
            {
              id: "c",
              text: "Ask each affected customer to rotate its own SFTP passwords, and leave the storage SAS until next week.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customers were asked to rotate their passwords. The SAS is still valid.",
              rationale: "Customers need to rotate their credentials, but the SAS is Quarrystone's to revoke, and it is still open.",
            },
            {
              id: "d",
              text: "Revoke the connected app and restrict API access by IP and profile, then sweep cases for secrets.",
              quality: ["good", "good", "neutral"],
              followUp: "The app is revoked and API access is restricted. The secret sweep is next.",
              rationale: "Closing the door is right, but secrets already stolen stay live until rotated.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "The export happened in August and was in the logs. When did the company discover the breach for HIPAA?",
          discussionPrompt: "Would a regulator say that a monitored log of a 186,000 row export meant the company should have known?",
          capabilityKeys: ["GV.OC"],
          options: [
            {
              id: "a",
              text: "Record discovery as this morning's email, and document why the August export was not seen.",
              quality: ["good", "good", "good"],
              followUp: "Discovery is recorded as Monday 07:52, with a note on why the export was not detected.",
              rationale: "Defensible if nobody monitored the logs, but the should have known test means the note must hold up.",
            },
            {
              id: "b",
              text: "Record discovery as 18 August, since the logs showed the export, and treat the notices as late.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Discovery is recorded as 18 August. Notices are treated as already late.",
              rationale: "Conservative, but discovery turns on what was known or should have been known with reasonable diligence.",
            },
            {
              id: "c",
              text: "Record discovery as when forensics finishes counting affected patients, so the notices are accurate.",
              quality: ["bad", "bad", "bad"],
              followUp: "Discovery waits for the forensic count.",
              rationale: "The clock runs from discovery, not from the end of the count. Notices are sent with what is known.",
            },
            {
              id: "d",
              text: "Record this morning as discovery, have counsel assess the August log question, and notify on that basis.",
              quality: ["great", "great", "great"],
              followUp: "Discovery is this morning, counsel is assessing the August question in writing, and notices proceed.",
              rationale: "It sets a working date, keeps the notices moving, and puts the should have known question to counsel.",
            },
          ],
        },
        {
          team: CS,
          decisionOwner: "Chief customer officer",
          stem: "Patient data from customers' own cases is in the export. How do you approach affected customers today?",
          discussionPrompt: "For each top customer, who is the right contact for a security incident: the privacy officer, the CISO or the account owner?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Wait for Legal to send written BAA notices, so that every customer hears the same thing at once.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customer Success is waiting for the written notices.",
              rationale: "Consistency matters, but customers who hear first from the attacker or the press will judge the silence.",
            },
            {
              id: "b",
              text: "Have account managers call every customer today and explain the attack in as much detail as they can.",
              quality: ["bad", "bad", "bad"],
              followUp: "Account managers called every customer with their own account of the attack.",
              rationale: "Unscripted calls to all 46 customers spread unconfirmed detail and contradict the notices that follow.",
            },
            {
              id: "c",
              text: "Name one owner per affected customer and call their privacy officer with an agreed script before notice.",
              quality: ["great", "great", "great"],
              followUp: "Each affected customer has one owner, who called its privacy officer with the agreed script.",
              rationale: "One owner, the right contact and a script cleared by counsel keep the relationship and the record consistent.",
            },
            {
              id: "d",
              text: "Email every customer a short notice today that an incident is under investigation, affected or not.",
              quality: ["good", "neutral", "neutral"],
              followUp: "All customers got a short email about an incident under investigation.",
              rationale: "Open, but unaffected customers now have questions and affected ones get no more than the rest.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Customers want answers",
      scenarioOffsetMin: 1440,
      plannedDelayMin: 8,
      objectiveKeys: ["o3", "o4", "o5"],
      clockTriggers: [CLOCKS.stateAg.key],
      expectedActions: [
        { team: EXEC, actions: ["Has counsel run an OFAC sanctions check", "Gets insurer consent terms and FBI input before any decision", "Records the decision and who made it"] },
        { team: LEGAL, actions: ["Sends BAA notices with known facts, open questions and a supplement date", "Answers each customer request through one owner"] },
        { team: CS, actions: ["Gives each customer a named contact and a next update time", "Logs every customer request and commitment"] },
        { team: SEC, actions: ["Restricts connected app approval to admins", "Adds a rule that IT never asks users to approve apps by phone"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 08:30. The attacker's 72 hours end Thursday 07:52. The FBI field office has the indicators. Counsel's sanctions screen of the wallet in the email found no match.\n\n" +
            `**Known:** about 2,100 patients across 9 customers, about 600 of them in Texas. **${CUSTOMERS.hospital}**'s privacy officer asks for a written notice and the list of affected patients.`,
        },
        degrading: {
          narrativeMd:
            "Tuesday 08:30. The attacker's 72 hours end Thursday 07:52. Counsel's sanctions screen of the wallet found no match, which does not prove who controls it.\n\n" +
            `**Known:** about 48,000 patients across 22 customers, about 7,000 in Texas. **${CUSTOMERS.plan}** wants a call with your CEO today. Its CISO asks whether its member files were in Salesforce.`,
        },
        critical: {
          narrativeMd:
            "Tuesday 08:30. The attacker's 72 hours end Thursday 07:52. The attacker emailed again overnight with a sample of Bayline member claims from the upload container.\n\n" +
            `**Known:** about 48,000 patients in cases across 22 customers, and about 310,000 **${CUSTOMERS.plan}** members, about 40,000 in Texas. Bayline's CISO has suspended your SFTP access and its general counsel wants a call with yours today.`,
          consequenceText: "A customer has stopped trusting the connection and the attacker is raising the pressure.",
        },
      },
      questions: [
        {
          team: EXEC,
          type: "ransom",
          decisionOwner: "CEO, with the board",
          stem: "The deadline is Thursday 07:52. The attacker promises to delete the data if paid. How do you decide?",
          discussionPrompt: "What would deletion be worth to your customers if you cannot verify it, and who could approve a payment?",
          capabilityKeys: ["GV.RR", "RS.MA"],
          options: [
            {
              id: "a",
              text: "Pay before Thursday to keep the data off the leak site, then tell customers it was handled.",
              quality: ["bad", "bad", "bad"],
              followUp: "A payment was arranged without the insurer's consent or a full sanctions review.",
              rationale: "Deletion cannot be verified and OFAC's 2021 advisory warns of strict liability for paying a sanctioned party.",
            },
            {
              id: "b",
              text: "Decline to pay, with OFAC, insurer and FBI input recorded, and prepare customers for a possible leak.",
              quality: ["great", "great", "great"],
              followUp: "The company decided not to pay after recorded sanctions, insurer and FBI input, and is preparing customers.",
              rationale: "Theft only extortion buys a promise. Salesforce refused to pay in 2025, and notices are owed either way.",
            },
            {
              id: "c",
              text: "Have the insurer's negotiator open talks to learn what they hold, with no commitment to pay.",
              quality: ["good", "good", "good"],
              followUp: "The insurer's negotiator has opened contact with no commitment.",
              rationale: "A professional negotiator can size the claim. It must not delay notices or imply that payment ends the matter.",
            },
            {
              id: "d",
              text: "Ignore the deadline and the email entirely, and decide nothing until the investigation is finished.",
              quality: ["neutral", "bad", "bad"],
              followUp: "No decision was made. The deadline will pass without one.",
              rationale: "Not paying can be right, but making no recorded decision leaves the board and insurer without a basis.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Saint Aldric wants a written notice and a patient list. What goes into the BAA notices this week?",
          discussionPrompt: "What does each of your BAAs require a notice to contain, and who has that list?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Known facts, affected patients identified so far, open questions and a date for the next supplement.",
              quality: ["great", "great", "great"],
              followUp: "BAA notices went out with known facts, the patients identified so far, open questions and a supplement date.",
              rationale: "164.410 asks the business associate to identify each affected individual to the extent possible. Send what is known, then supplement.",
              clocks: [{ key: CLOCKS.baa.key, action: "met" }],
            },
            {
              id: "b",
              text: "A short notice that an incident occurred, with no patient detail until the forensic report is final.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customers got a short notice with no patient detail.",
              rationale: "It meets the letter of a notice but leaves customers unable to start their own HIPAA work.",
              clocks: [{ key: CLOCKS.baa.key, action: "met" }],
            },
            {
              id: "c",
              text: "The full export for each customer, with every record of theirs, so they can judge it themselves.",
              quality: ["bad", "bad", "bad"],
              followUp: "Each customer was sent the full export of its records.",
              rationale: "Sending bulk PHI around by email creates a second disclosure and goes beyond what customers asked for.",
            },
            {
              id: "d",
              text: "Notices only to customers whose patients are confirmed, and none to those still under review.",
              quality: ["good", "good", "neutral"],
              followUp: "Confirmed customers were notified. Others under review were not.",
              rationale: "Accurate, but customers still under review may be inside their own window and hear nothing.",
              clocks: [{ key: CLOCKS.baa.key, action: "met" }],
            },
          ],
        },
        {
          team: CS,
          decisionOwner: "Chief customer officer",
          stem: "Bayline wants your CEO today and is questioning the connection. How do you handle the account?",
          discussionPrompt: "Which of your customers could end the contract over this, and what would keep them?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Set the CEO call today with the CISO, bring the facts and a remediation plan, and commit to written updates.",
              quality: ["great", "great", "great"],
              followUp: "The CEO and CISO met Bayline today with the facts, a plan and a written update schedule.",
              rationale: "A public health plan facing its own disclosure choices needs facts from the top and a schedule it can rely on.",
            },
            {
              id: "b",
              text: "Offer Bayline a fee credit for the year in exchange for keeping the incident confidential.",
              quality: ["bad", "bad", "bad"],
              followUp: "Bayline was offered a credit in exchange for confidentiality.",
              rationale: "Trading money for silence on a PHI incident invites regulator scrutiny and breaks trust when it surfaces.",
            },
            {
              id: "c",
              text: "Keep Bayline with its account manager and send the standard notice, so it is treated like everyone else.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Bayline got its account manager and the standard notice.",
              rationale: "Treating every customer the same ignores that Bayline's members are in the export and it may file an 8-K.",
            },
            {
              id: "d",
              text: "Send the CISO to Bayline's CISO today, and schedule the CEO call once the scope is final.",
              quality: ["good", "good", "neutral"],
              followUp: "The two CISOs met today. The CEO call waits for the final scope.",
              rationale: "The technical call helps, but Bayline asked for the CEO, and waiting reads as avoidance.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The disclosure committee",
      scenarioOffsetMin: 2880,
      plannedDelayMin: 8,
      objectiveKeys: ["o4", "o1"],
      expectedActions: [
        { team: LEGAL, actions: ["Records the materiality determination, its basis and time", "Coordinates timing with customers who may file their own 8-K"] },
        { team: SEC, actions: ["Reviews every connected app and OAuth grant across Salesforce and Microsoft 365", "Treats integration tokens as compromised and rotates them"] },
        { team: EXEC, actions: ["Briefs the board in writing on scope, decisions and the control gap", "Approves a vishing control for support staff"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 08:30. Scope is stable at about 2,100 patients and no secrets were used. The disclosure committee meets at 10:00. Finance estimates direct costs at $2 million to $3 million and expects one customer to ask for a contract review.\n\n" +
            "The attacker's email now also claims to hold your Microsoft 365 mail. Nothing in the logs supports it.",
        },
        degrading: {
          narrativeMd:
            "Wednesday 08:30. Scope is about 48,000 patients across 22 customers. The disclosure committee meets at 10:00. Finance estimates $9 million to $14 million, and two customers have asked for contract reviews.\n\n" +
            "The attacker now claims to hold your Microsoft 365 mail as well. A third party chat integration in Salesforce also had a token with mail access.",
        },
        critical: {
          narrativeMd:
            "Wednesday 08:30. Scope is about 48,000 patients in cases and 310,000 Bayline members. Bayline has said it will file a voluntary 8-K on Friday that names its vendor. The disclosure committee meets at 10:00. Finance estimates $30 million to $55 million including the likely loss of Bayline.\n\n" +
            "The attacker claims to hold your Microsoft 365 mail. A third party chat integration in Salesforce had a token with mail access.",
          consequenceText: "A customer's filing will make this public on its schedule, not yours.",
        },
      },
      questions: [
        {
          team: LEGAL,
          type: "materiality",
          decisionOwner: "General counsel, with the disclosure committee",
          stem: "The disclosure committee meets at 10:00. What does it determine about materiality under Item 1.05?",
          discussionPrompt: "If a customer's 8-K is about to name you, does that change your materiality analysis or only your timing?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Determine the incident is material today, record the basis and time, and file Item 1.05 within four business days.",
              quality: ["good", "great", "great"],
              followUp: "The committee determined the incident is material and recorded the basis. The 8-K clock is running.",
              rationale: "Customer losses, PHI scale and regulator exposure point to material. Item 1.05 runs four business days from that call.",
              clocks: [{ key: CLOCKS.sec.key, action: "trigger" }],
            },
            {
              id: "b",
              text: "Not material because no systems were encrypted and operations never stopped, so no filing is needed.",
              quality: ["bad", "bad", "bad"],
              followUp: "The committee found the incident not material because operations continued.",
              rationale: "Data theft can be material without an outage. Customer, legal and regulatory effects count as much as downtime.",
            },
            {
              id: "c",
              text: "Not yet material, with a voluntary Item 8.01 filing now and a review of the determination next week.",
              quality: ["great", "good", "neutral"],
              followUp: "The committee treated it as not yet material and is filing a voluntary Item 8.01 report.",
              rationale: "The SEC's May 2024 staff statement supports Item 8.01 before a determination. It weakens once losses are concrete.",
            },
            {
              id: "d",
              text: "Wait to decide until Bayline files on Friday, then match its description of the incident.",
              quality: ["bad", "bad", "bad"],
              followUp: "The committee will wait for Bayline's filing.",
              rationale: "The determination is the company's own and must be made without unreasonable delay, not set by a customer.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The attacker now claims your mail too, and a chat integration had a mail token. What do you do?",
          discussionPrompt: "How many third party apps hold tokens into your Salesforce and Microsoft 365 today, and who approved them?",
          capabilityKeys: ["RS.AN", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Treat every integration token as compromised, revoke and reissue them, and review mail audit logs.",
              quality: ["great", "great", "great"],
              followUp: "All integration tokens were revoked and reissued and mail audit logs are under review.",
              rationale: "Google advised treating all Drift connected tokens as compromised in 2025. The same logic applies here.",
            },
            {
              id: "b",
              text: "Dismiss the mail claim as a bluff, since nothing in the Salesforce logs points to Microsoft 365.",
              quality: ["bad", "bad", "bad"],
              followUp: "The mail claim was dismissed.",
              rationale: "Salesforce logs cannot show mail access through a different token. The claim needs checking, not dismissing.",
            },
            {
              id: "c",
              text: "Revoke the chat integration's token only and ask the vendor whether it was breached.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The chat integration's token is revoked and the vendor has been asked.",
              rationale: "Right first step, but other integrations with similar tokens remain unreviewed.",
            },
            {
              id: "d",
              text: "Remove every third party app from Salesforce and Microsoft 365 tonight, whatever breaks.",
              quality: ["neutral", "good", "good"],
              followUp: "Every third party app was removed. Several business processes stopped.",
              rationale: "Blunt but effective when tokens may be in attacker hands. Expect broken processes and no audit of what was used.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "A support manager approved an app on a phone call. What do you change and report to the board?",
          discussionPrompt: "Would your support staff know that IT never asks them to approve an app over the phone?",
          capabilityKeys: ["GV.OV", "PR.AT"],
          options: [
            {
              id: "a",
              text: "Restrict app approval to admins, add a callback rule for IT requests, and report it to the board in writing.",
              quality: ["great", "great", "great"],
              followUp: "Only admins can approve apps, IT requests need a callback, and the board has a written report.",
              rationale: "GTIG's UNC6040 case needed only a user who could approve an app. Removing that ability closes the path.",
            },
            {
              id: "b",
              text: "Discipline the support manager and send a reminder to all staff about phishing calls.",
              quality: ["bad", "bad", "bad"],
              followUp: "The support manager was disciplined and staff got a reminder.",
              rationale: "A user being able to approve the app was the control gap. Blame discourages the reporting you need next time.",
            },
            {
              id: "c",
              text: "Run vishing training for all support staff this month and test them with simulated calls.",
              quality: ["good", "good", "good"],
              followUp: "Vishing training and simulated calls are scheduled for support staff.",
              rationale: "Training helps, but people can still approve apps. Technical restriction should come first.",
            },
            {
              id: "d",
              text: "Move all customer support cases out of Salesforce into a new system before next quarter.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "A project to move support cases out of Salesforce has started.",
              rationale: "A platform move does not fix how apps are approved, and costs months during an active incident.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Listed on the leak site",
      scenarioOffsetMin: 10080,
      plannedDelayMin: 8,
      objectiveKeys: ["o3", "o4", "o5"],
      expectedActions: [
        { team: LEGAL, actions: ["Asks the FBI for its delay request in writing and records it", "Keeps notices that the request does not cover on schedule"] },
        { team: CS, actions: ["Calls each named customer before the listing reaches the press", "Gives customers a written update with the same facts"] },
        { team: EXEC, actions: ["Confirms the payment decision with the board and the insurer", "Gives customers a truthful answer on whether the company paid"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 08:30. One week after the email. A ShinyHunters leak site lists Quarrystone with a 5 day countdown and names **Saint Aldric Health** as a source of the data. Nothing has been published.\n\n" +
            "An FBI agent calls the general counsel. The Bureau is working an active case on the group and asks whether patient notices could wait two weeks.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Leak site listing",
              from: "Leak site",
              sentAt: "Sunday 23:10",
              content: "**QUARRYSTONE HEALTH ANALYTICS**\n\nSalesforce. Accounts, contacts, cases, attachments. Customers include Saint Aldric Health.\n\nCountdown: 5 days.",
            },
          ],
        },
        degrading: {
          narrativeMd:
            "Monday 08:30. One week after the email. A ShinyHunters leak site lists Quarrystone with a 5 day countdown and names **six customers**, including Bayline Health Plan. A reporter has emailed two of them.\n\n" +
            "An FBI agent calls the general counsel. The Bureau is working an active case on the group and asks whether patient notices could wait two weeks.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Leak site listing",
              from: "Leak site",
              sentAt: "Sunday 23:10",
              content: "**QUARRYSTONE HEALTH ANALYTICS**\n\nSalesforce. Accounts, contacts, cases, attachments. Customers include Bayline Health Plan, Saint Aldric Health and others.\n\nCountdown: 5 days.",
            },
          ],
        },
        critical: {
          narrativeMd:
            "Monday 08:30. One week after the email. A ShinyHunters leak site has published a **first part** of the data, including Bayline member claims files, and names **six customers**. Bayline's 8-K is public and names Quarrystone.\n\n" +
            "An FBI agent calls the general counsel and asks whether patient notices could wait two weeks.",
          consequenceText: "The data is public and the customers are named. Patients will hear about it this week.",
          artifacts: [
            {
              id: "a1",
              kind: "social_post",
              title: "Leak site post",
              from: "Leak site",
              sentAt: "Sunday 23:10",
              content: "**QUARRYSTONE HEALTH ANALYTICS**\n\nPart 1 published: Bayline Health Plan member claims. Customers include Saint Aldric Health and others.\n\nPart 2: 5 days.",
            },
          ],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The FBI asks whether patient notices could wait two weeks. How do you respond?",
          discussionPrompt: "Who in your company can accept a law enforcement delay request, and how is it recorded?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Ask for a statement that notice would impede the investigation, record it, and tell customers it applies.",
              quality: ["great", "great", "good"],
              followUp: "The FBI's statement is recorded and customers know a law enforcement delay applies.",
              rationale: "164.412 allows a delay on a law enforcement statement that notice would impede an investigation. Record it.",
            },
            {
              id: "b",
              text: "Agree on the call and pause every notice, including the BAA notices to customers, for two weeks.",
              quality: ["bad", "bad", "bad"],
              followUp: "All notices are paused on the strength of a phone call.",
              rationale: "An unrecorded oral request is a weak basis, and the BAA notices are contract duties to customers.",
            },
            {
              id: "c",
              text: "Decline. Notices are already scheduled and customers expect them, whatever the investigation needs.",
              quality: ["neutral", "neutral", "good"],
              followUp: "The company declined the delay request.",
              rationale: "Once data is public the case for delay is weaker, but refusing outright ignores a lawful option.",
            },
            {
              id: "d",
              text: "Ask counsel to agree the scope of a delay with the FBI in writing, and keep customer BAA notices on time.",
              quality: ["good", "good", "great"],
              followUp: "Counsel is agreeing a written scope with the FBI. Customer BAA notices stay on schedule.",
              rationale: "Keeps the contract notices on time while honoring a documented delay for the parts it covers.",
            },
          ],
        },
        {
          team: CS,
          decisionOwner: "Chief customer officer",
          stem: "Customers are named on the leak site. What does Customer Success do today?",
          discussionPrompt: "Which named customers have their own communications teams that will be called by reporters today?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Call each named customer before 10:00 with the facts and a press line, and follow up in writing.",
              quality: ["great", "great", "great"],
              followUp: "Every named customer heard before 10:00 and has the facts and a press line in writing.",
              rationale: "Named customers will be asked by press and patients. Hearing first and having the same facts protects both sides.",
            },
            {
              id: "b",
              text: "Ask the leak site host to take the listing down, and tell customers once it has been removed.",
              quality: ["bad", "bad", "bad"],
              followUp: "A takedown request was sent. Customers have not been told.",
              rationale: "Takedowns rarely work fast, and customers learn about their own name from someone else.",
            },
            {
              id: "c",
              text: "Send all 46 customers the same written update today, whether they are named or not.",
              quality: ["good", "good", "neutral"],
              followUp: "All customers got the same written update.",
              rationale: "Consistent, but named customers needed a call, not the same email as everyone else.",
            },
            {
              id: "d",
              text: "Leave customer contact to Legal and Communications until the countdown ends on Saturday.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customer Success is waiting for Legal and Communications.",
              rationale: "Named customers need their account owner now. Waiting for the countdown hands the story to the attacker.",
            },
          ],
        },
        {
          team: EXEC,
          type: "ransom",
          decisionOwner: "CEO, with the board",
          stem: "The countdown is running and customers are named. Does the leak site change your payment decision?",
          discussionPrompt: "What would you tell a customer who asks whether you paid?",
          capabilityKeys: ["GV.RR"],
          options: [
            {
              id: "a",
              text: "Hold the recorded decision not to pay, tell the board and insurer, and answer customers truthfully.",
              quality: ["great", "great", "great"],
              followUp: "The decision not to pay stands, the board and insurer know, and customers are told the truth.",
              rationale: "The listing is the pressure the attacker planned. Payment would not undo the theft or the notices.",
            },
            {
              id: "b",
              text: "Pay now to get the customers' names off the leak site before the press picks it up.",
              quality: ["bad", "bad", "bad"],
              followUp: "A payment was made to remove the listing.",
              rationale: "Paying under a countdown without sanctions and insurer steps risks OFAC exposure and buys nothing verifiable.",
            },
            {
              id: "c",
              text: "Reopen talks through the insurer's negotiator to extend the countdown while notices go out.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The negotiator is seeking more time.",
              rationale: "Extra time can help notices land, but talks can drift into payment without a fresh board decision.",
            },
            {
              id: "d",
              text: "Say publicly today that the company will not pay, to show customers it will not be extorted.",
              quality: ["neutral", "good", "good"],
              followUp: "The company said publicly that it will not pay.",
              rationale: "Once customers are named, a public line can steady them. It ends any room to negotiate.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Notices and the long tail",
      scenarioOffsetMin: 14400,
      plannedDelayMin: 8,
      objectiveKeys: ["o3", "o5"],
      expectedActions: [
        { team: LEGAL, actions: ["Offers delegated individual notice to customers in writing", "Confirms Texas attorney general notice where 250 or more residents are affected"] },
        { team: CS, actions: ["Tracks each customer's notice status and open requests", "Agrees a remediation review with at-risk customers"] },
        { team: SEC, actions: ["Shows connected app restrictions and IP rules in place", "Sets alerting on bulk API exports"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 08:30. Ten days in. Nothing more was published. Nine customers have BAA notices and seven ask whether Quarrystone will send patient letters for them. The Texas count is about 600 residents.",
        },
        degrading: {
          narrativeMd:
            "Thursday 08:30. Ten days in. Part of the case data was published on Saturday. Twenty-two customers have BAA notices and fifteen ask whether Quarrystone will send patient letters. Two customers have started contract reviews. The Texas count is about 7,000 residents.",
        },
        critical: {
          narrativeMd:
            "Thursday 08:30. Ten days in. Both parts of the data are public. Bayline has given notice to end its contract and a class action names Quarrystone. Twenty-two customers ask whether Quarrystone will send patient letters. The Texas count is about 47,000 residents.",
          consequenceText: "Recovery now is about trust and the record, not systems.",
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Chief privacy officer",
          stem: "Customers ask whether you will send patient letters for them. What do you offer and file?",
          discussionPrompt: "If you send letters for 20 customers, who signs them and whose name is at the top?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Offer delegated notice in writing per customer, and file Texas AG notice where 250 or more residents are hit.",
              quality: ["great", "great", "great"],
              followUp: "Delegated notice is offered in writing and the Texas attorney general filing is made.",
              rationale: "OCR's Change Healthcare FAQ allows delegation to the business associate. Texas requires AG notice within 30 days for 250 or more.",
              clocks: [
                { key: CLOCKS.hipaa.key, action: "met" },
                { key: CLOCKS.stateAg.key, action: "met" },
              ],
            },
            {
              id: "b",
              text: "Tell customers that patient letters are their duty, and leave state filings to each of them.",
              quality: ["neutral", "bad", "bad"],
              followUp: "Customers were told patient letters and state filings are theirs.",
              rationale: "Arguable on the law, but it leaves 22 different letters about one incident and unclear state filings.",
            },
            {
              id: "c",
              text: "Send letters to every patient named in any case, now, under Quarrystone's name alone.",
              quality: ["bad", "bad", "bad"],
              followUp: "Letters are going out under Quarrystone's name to every patient in any case.",
              rationale: "Without each covered entity's agreement this oversteps the BAA and may confuse patients about who holds their data.",
            },
            {
              id: "d",
              text: "Offer letters to customers that ask, with call center support, and review state filings next month.",
              quality: ["good", "good", "neutral"],
              followUp: "Letters and a call center are offered. State filings will be reviewed next month.",
              rationale: "Practical help, but the Texas 30 day window may close before next month.",
              clocks: [{ key: CLOCKS.hipaa.key, action: "met" }],
            },
          ],
        },
        {
          team: CS,
          decisionOwner: "Chief customer officer",
          stem: "Several customers are reviewing their contracts. What do you offer to keep their trust?",
          discussionPrompt: "What evidence would your largest customer need to stay, and who can produce it?",
          capabilityKeys: ["RC.CO", "GV.SC"],
          options: [
            {
              id: "a",
              text: "An independent assessment of the Salesforce and app controls, shared with customers under NDA.",
              quality: ["great", "great", "good"],
              followUp: "An independent assessment is commissioned and will be shared under NDA.",
              rationale: "Customers need evidence that the specific gap is closed, from someone other than the vendor.",
            },
            {
              id: "b",
              text: "A promise that this cannot happen again, signed by the CEO and sent to every customer.",
              quality: ["bad", "bad", "bad"],
              followUp: "Every customer got a signed promise that it cannot happen again.",
              rationale: "An absolute promise is not credible and becomes evidence in the next dispute.",
            },
            {
              id: "c",
              text: "Fee credits for affected customers this year, without any change to the support process.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Affected customers get fee credits.",
              rationale: "Credits soften the cost but do not answer the question customers are asking about controls.",
            },
            {
              id: "d",
              text: "A remediation plan with dates and owners, and quarterly reviews with each at-risk customer.",
              quality: ["good", "good", "great"],
              followUp: "At-risk customers have a dated plan and quarterly reviews.",
              rationale: "Concrete and accountable. Where the data is public, regular reviews matter as much as the report.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "What do you show customers and the board as the lasting fix for Salesforce?",
          discussionPrompt: "Would you detect a 186,000 row export today, and who would get the alert?",
          capabilityKeys: ["PR.AA", "DE.CM"],
          options: [
            {
              id: "a",
              text: "Admin only app approval, API access limited by IP and profile, and alerts on bulk exports.",
              quality: ["great", "great", "great"],
              followUp: "App approval is admin only, API access is restricted, and bulk exports alert the SOC.",
              rationale: "These are GTIG's UNC6040 recommendations, plus detection for the export that went unseen in August.",
            },
            {
              id: "b",
              text: "A yearly phishing test for support staff and a new policy that bans pasting PHI into cases.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Support staff get a yearly test and a policy against PHI in cases.",
              rationale: "Policy helps, but customers will keep pasting PHI into cases. Technical controls carry the load.",
            },
            {
              id: "c",
              text: "Switch Salesforce authentication to a new identity provider and keep everything else the same.",
              quality: ["bad", "bad", "bad"],
              followUp: "Salesforce now uses a new identity provider. App approval is unchanged.",
              rationale: "The attacker never needed a password. A user approving an app was the gap, and this leaves it open.",
            },
            {
              id: "d",
              text: "Automatic redaction of patient identifiers in new cases, plus a cleanup of old ones.",
              quality: ["good", "good", "good"],
              followUp: "New cases are redacted automatically and old ones are being cleaned up.",
              rationale: "Reduces what a future theft would expose, but does not stop the access path.",
            },
          ],
        },
      ],
    }),
  ],
};

export const HEALTHCARE_CRISISSIM_SALESFORCE = SHINYHUNTERS;
