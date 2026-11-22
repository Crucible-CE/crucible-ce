// Crisis Sim: a departing staff engineer at a SaaS company copies source
// code and a warehouse extract with customer personal data before joining a
// competitor. Grounded in the Defend Trade Secrets Act (18 U.S.C. 1836 and
// 1833(b)) and GDPR Art. 33(2) processor duties, as summarized in the threat
// brief addendum. Matches playbooks/saas-data-theft-extortion.md, sections 7
// (C-B) and 14 (L1 to L5, L-A, L-B). All names are fictional; IP addresses
// are RFC 5737.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const INSIDER_DATA_THEFT_TEMPLATE_ID = "lib-general-crisissim-insider-data-theft";

const ORG = "Larkspan Software";
const DOMAIN = "larkspan.example";
const RIVAL = "Tarrow Analytics";
const EXEC = "Executive";
const LEGAL = "Legal";
const SEC = "Security";
const HR = "People";

const CLOCKS = {
  dpa: { key: "dpa_notice", label: "Customer notice under the data processing agreement (contractual, 48 hours)", durationHours: 48 },
  insurer: { key: "insurer_notice", label: "Cyber insurer notice (policy: 48 hours)", durationHours: 48 },
} as const;

const PROFILE =
  `**${ORG}, Inc.** is a venture-backed SaaS company in Denver with about 650 staff. Its product plans routes and schedules for delivery fleets, with about 400 customers in the US and the EU. ` +
  "Customers send vehicle telemetry and driver details, which Larkspan processes as a processor under data processing agreements. Most DPAs require notice of a personal data breach within 48 hours of awareness. " +
  "The routing engine, built over eight years, is Larkspan's main trade secret. Code lives in GitHub, analytics in Snowflake, documents in Google Workspace; laptops are managed with endpoint DLP. " +
  "Engineers sign a confidentiality and invention assignment agreement when hired.";

const DLP_ALERT = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Weekend activity for o.vickery",
  from: "Security operations",
  sentAt: "Monday 08:55",
  content: [
    "```",
    "Sat 14:02  GitHub   o.vickery  personal_access_token.create  scopes=repo  expires=never",
    "Sat 14:10  GitHub   o.vickery  git.clone  repos=41  src=192.0.2.15 (home)",
    "Sat 21:47  Snowflake  OVICKERY  query  SELECT * FROM TELEMETRY.FLEET_EVENTS WHERE customer_id IN (...)  rows=2,318,440  export=CSV",
    "Sun 10:31  DLP      LT-ENG-0388  upload  drive.google.com (personal account)  file=notes_backup.zip  size=6.1 GB",
    "Sun 10:58  DLP      LT-ENG-0388  usb.write  device=SanDisk 128 GB  files=1,204",
    "```",
  ].join("\n"),
};

const RESIGNATION = {
  id: "a2",
  kind: "email" as const,
  title: "Resignation email, Friday",
  from: "Owen Vickery",
  sentAt: "Friday 17:12",
  content:
    `**From:** Owen Vickery <o.vickery@${DOMAIN}>\n**To:** Engineering director <engdir@${DOMAIN}>\n**Subject:** Moving on\n\n` +
    `After eight great years I have accepted a role at ${RIVAL}. My last day will be two weeks from today. I will make sure the routing team has everything it needs for the handover.`,
};

const DPA_EXTRACT = {
  id: "a1",
  kind: "document" as const,
  title: "Forensic note on the Snowflake export",
  from: "Forensics firm, at the direction of counsel",
  sentAt: "Monday 12:40",
  content:
    "The CSV exported on Saturday holds 2,318,440 telemetry events for three customers: two EU parcel carriers and one US grocery distributor. Columns include driver full name, mobile number, employee ID, and GPS traces at 30 second intervals. About 4,900 distinct drivers are named.\n\n" +
    "The file was written to the laptop and appears in the 6.1 GB archive uploaded to a personal Google Drive account. We cannot yet confirm whether it is on the USB device.",
};

const OWEN_REPLY = {
  id: "a1",
  kind: "email" as const,
  title: "Owen Vickery after the meeting",
  from: "Owen Vickery",
  sentAt: "Monday 17:05",
  content:
    `**From:** Owen Vickery <owen.vickery@mail.example>\n**To:** People team <people@${DOMAIN}>\n**Subject:** Today\n\n` +
    "I was surprised by today's meeting. What I took is my own notes and code samples I wrote. I will not hand over my personal laptop or my Drive account. If you want to discuss further, please contact my lawyer.",
};

const CUSTOMER_EMAIL = {
  id: "a1",
  kind: "email" as const,
  title: "Customer DPO asks for details",
  from: "Data protection officer, EU parcel carrier",
  sentAt: "Wednesday 08:20",
  content:
    `**From:** DPO <dpo@nordlandparcel.example>\n**To:** Privacy <privacy@${DOMAIN}>\n**Subject:** Your breach notice\n\n` +
    "Thank you for your notice on Monday. As controller we must decide on notifying our supervisory authority within 72 hours of becoming aware. Please send by 14:00 today: number of our drivers affected, data fields, where the data is now, and what you have done to recover it.",
};

const RIVAL_LETTER = {
  id: "a2",
  kind: "email" as const,
  title: "Letter from the competitor's counsel",
  from: `Counsel for ${RIVAL}`,
  sentAt: "Wednesday 09:40",
  content:
    `${RIVAL} has received your letter. Mr. Vickery has not started work and has no ${RIVAL} systems or devices. ${RIVAL} has instructed him not to bring any ${ORG} material and will cooperate with a reasonable protocol for confirming that. We ask that you not contact ${RIVAL} employees directly.`,
};

const INSIDER_DATA_THEFT: LibraryCrisisSimTemplate = {
  id: INSIDER_DATA_THEFT_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Insider data theft by a departing engineer",
  summary:
    "A staff engineer who resigned on Friday cloned 41 repositories and exported customer driver data over the weekend before joining a competitor. Four teams decide when to cut access, how to preserve evidence, what to tell customers as a processor, and whether to go to court or to the FBI.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, LEGAL, SEC, HR],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 1, time: "09:30" },
    orgName: ORG,
    threatActorKey: "insider-threat",
    industryKey: "saas",
    capabilityKeys: ["RS.MA", "RS.MI", "RS.AN", "RS.CO", "GV.RR", "GV.OC", "PR.AA", "ID.IM"],
    regulatoryClocks: [CLOCKS.dpa, CLOCKS.insurer],
    executiveBriefMd: [
      PROFILE,
      "",
      `On Friday at 17:12 Owen Vickery, a staff engineer on the routing team for eight years, resigned to join ${RIVAL}, a direct competitor, in two weeks. At 08:55 on Monday the security team saw his weekend activity: a new GitHub token, 41 repositories cloned, a Snowflake export of 2.3 million rows, and a 6.1 GB upload to a personal Google Drive. He is due at the 10:00 routing standup.`,
      "",
      "The Executive, Legal, Security and People teams make decisions over one week of simulated time. Two clocks can start: customer notice under the data processing agreements and cyber insurer notice.",
      "",
      "Use your own procedures. The library playbook for this scenario is SaaS data theft and extortion response, sections 7 and 14 on insider theft. Data breach notification and disclosure covers the customer notices in more depth.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Preserve evidence before any confrontation, and record who decided when to cut access and why.", capabilityKeys: ["RS.AN", "GV.RR"] },
    { key: "o2", text: "Revoke every access path, including tokens and personal storage sync, within one hour of the decision.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "o3", text: "Send processor notices to affected customers inside the DPA window with what is known.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "o4", text: "Choose letters, court action or a law enforcement referral on counsel's advice, with the decision recorded.", capabilityKeys: ["GV.RR", "GV.OC"] },
    { key: "o5", text: "Change offboarding so access for high-risk departures is reviewed at notice, not on the last day.", capabilityKeys: ["ID.IM", "PR.AA"] },
  ],
  injects: [
    inject({
      title: "Forty-one repositories",
      scenarioOffsetMin: 0,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o2"],
      expectedActions: [
        {
          team: SEC,
          actions: [
            "Exports GitHub, Snowflake, Google and DLP logs for the last 90 days under counsel",
            "Prepares to revoke the token, sessions and Drive sync at a set time",
            "Arranges forensic imaging of the laptop",
          ],
        },
        { team: LEGAL, actions: ["Engages outside counsel and a forensic firm through counsel", "Issues a legal hold", "Decides the timing of access removal with HR"] },
        { team: HR, actions: ["Keeps the person out of a confrontation until evidence is preserved", "Pulls his signed agreements"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 09:30. Security caught the weekend activity at 08:55 and called the general counsel before anyone else. Owen Vickery is due at the 10:00 standup. His laptop is on the office network.\n\n" +
            "**Known:** a GitHub token with no expiry, 41 repositories cloned to his home machine at **192.0.2.15**, a Snowflake export of 2.3 million rows, a 6.1 GB upload to a personal Google Drive, and 1,204 files written to a USB device.\n\n" +
            "**Unknown:** what is in the Snowflake export and whether he has shared any of it.",
          artifacts: [DLP_ALERT, RESIGNATION],
        },
        degrading: {
          narrativeMd:
            "Monday 09:30. The DLP alert from Sunday sat in a queue until a manager noticed it at 08:55. Owen Vickery is due at the 10:00 standup and his manager wants to ask him about it there.\n\n" +
            "**Known:** a GitHub token with no expiry, 41 repositories cloned to **192.0.2.15**, a Snowflake export of 2.3 million rows, a 6.1 GB upload to a personal Google Drive, and a USB copy.\n\n" +
            "**Unknown:** what is in the Snowflake export.",
          artifacts: [DLP_ALERT, RESIGNATION],
        },
        critical: {
          narrativeMd:
            "Monday 09:30. Owen Vickery's manager saw the DLP alert at 08:55 and messaged him in chat: \"Can you explain the weekend uploads?\" Owen replied \"Just backing up my notes\" and left the office with his laptop at 09:10.\n\n" +
            "**Known:** a GitHub token with no expiry, 41 repositories cloned, a Snowflake export of 2.3 million rows, a 6.1 GB upload to a personal Google Drive, and a USB copy.\n\n" +
            "**Unknown:** where the laptop is now.",
          consequenceText: "He knows he has been seen, and the laptop with the evidence has left the building.",
          artifacts: [DLP_ALERT, RESIGNATION],
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "His access is still live and he is due at the 10:00 standup. What does Security do now?",
          discussionPrompt: "Which of your logs would show this, and how long do they keep it without export?",
          capabilityKeys: ["RS.AN", "RS.MI"],
          options: [
            {
              id: "a",
              text: "Export the logs now, line up revocation of token, sessions and Drive sync, and image the laptop under counsel.",
              quality: ["great", "great", "great"],
              followUp: "Logs are exported, revocation is staged for a time counsel sets, and imaging is arranged.",
              rationale: "Preserving logs and the device first keeps the evidence any court or customer notice will rest on.",
            },
            {
              id: "b",
              text: "Disable every account he has right now and lock his laptop remotely, before he can copy anything more.",
              quality: ["good", "good", "great"],
              followUp: "Every account is disabled and the laptop is locked remotely.",
              rationale: "Cutting at once stops further copying. It is right when copying may continue, but evidence must still be captured.",
            },
            {
              id: "c",
              text: "Wipe the laptop remotely so the copied code on it cannot leave the company, then reissue it next week.",
              quality: ["bad", "bad", "bad"],
              followUp: "The laptop was wiped remotely.",
              rationale: "Wiping destroys the evidence of what was copied. The cloned repositories are on his home machine anyway.",
            },
            {
              id: "d",
              text: "Watch his activity silently for a week to see what else he takes, so the case against him is stronger.",
              quality: ["bad", "bad", "bad"],
              followUp: "His access stays live and Security is watching.",
              rationale: "Letting theft continue to build a case adds harm, including to customer data you must protect.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Who decides when to cut his access, and what do you put in place first?",
          discussionPrompt: "Who on your team can engage outside counsel and a forensic firm on a Monday morning?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Engage outside counsel and forensics, issue a legal hold, and set the cut-off time with HR and Security.",
              quality: ["great", "great", "great"],
              followUp: "Counsel and forensics are engaged, a legal hold is out, and the cut-off time is set.",
              rationale: "Counsel directed work keeps privilege, and a decided cut-off avoids a confrontation before evidence is safe.",
            },
            {
              id: "b",
              text: "Leave it to his manager to talk to him at the standup and report back, as a normal performance matter.",
              quality: ["bad", "bad", "bad"],
              followUp: "His manager will raise it at the standup.",
              rationale: "A public question tips him off before evidence is preserved and makes this a manager's improvisation.",
            },
            {
              id: "c",
              text: "Call the police now and ask them to recover the data from his home before he starts the new job.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Local police took a report and said it is a civil matter for now.",
              rationale: "A referral may come later, but local police rarely act at once and you lose control of timing.",
            },
            {
              id: "d",
              text: "Issue a legal hold and set the cut-off time with HR, and engage outside counsel after the meeting.",
              quality: ["good", "good", "neutral"],
              followUp: "A hold is out and the cut-off time is set. Outside counsel will be engaged after the meeting.",
              rationale: "The hold and timing are right, but forensics without counsel may not be privileged.",
            },
          ],
        },
        {
          team: HR,
          decisionOwner: "Chief people officer",
          stem: "He walks into the 10:00 standup in 30 minutes. What does the People team do?",
          discussionPrompt: "Where are his signed agreements, and what do they say about returning company information?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Let the standup go ahead normally, pull his signed agreements, and book a meeting with counsel at 15:30.",
              quality: ["great", "great", "neutral"],
              followUp: "The standup went normally. His agreements are pulled and a meeting is set for 15:30 with counsel.",
              rationale: "A calm morning buys time to preserve evidence and prepare the meeting, unless he already knows he was seen.",
            },
            {
              id: "b",
              text: "Walk him out of the building at 09:50 in front of the team and tell staff he is under investigation.",
              quality: ["bad", "bad", "bad"],
              followUp: "He was escorted out in front of the team, and staff were told he is under investigation.",
              rationale: "A public walk-out tips him off, risks defamation claims and tells the team conclusions nobody has reached.",
            },
            {
              id: "c",
              text: "Call him now to say his last day is today and he should hand in his laptop at reception by noon.",
              quality: ["good", "neutral", "great"],
              followUp: "He was told today is his last day and to return his laptop by noon.",
              rationale: "Ending employment fast is defensible, especially once he knows he was seen, but it may prompt more copying.",
            },
            {
              id: "d",
              text: "Ask his manager to keep him busy with handover tasks all week while the investigation runs quietly.",
              quality: ["bad", "bad", "bad"],
              followUp: "He is on handover tasks with full access.",
              rationale: "Keeping full access for a week leaves the most sensitive code and data open to someone already copying it.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Driver names in the export",
      scenarioOffsetMin: 210,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o3"],
      clockTriggers: [CLOCKS.dpa.key, CLOCKS.insurer.key],
      expectedActions: [
        {
          team: SEC,
          actions: ["Revokes the GitHub token, Snowflake user, Google sessions and Drive sync", "Collects and images the laptop", "Rotates any secrets in the cloned repositories"],
        },
        { team: LEGAL, actions: ["Treats the export as a personal data breach for the three customers", "Notifies the insurer"] },
        { team: EXEC, actions: ["Approves the plan for the 15:30 meeting", "Names one owner for customer contact"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 13:00. The forensic firm working through counsel has read the Snowflake export. It holds telemetry for three customers, two EU parcel carriers and a US grocery distributor, with driver names, mobile numbers and GPS traces for about **4,900 drivers**. The file is inside the archive on his personal Drive.\n\n" +
            "**Known:** the laptop was imaged at 12:10. Accounts are still live, with revocation set for 15:25.\n\n" +
            "**Unknown:** whether the USB device holds the same file.",
          artifacts: [DPA_EXTRACT],
        },
        degrading: {
          narrativeMd:
            "Monday 13:00. Forensics has read the Snowflake export: telemetry for three customers with driver names, mobile numbers and GPS traces for about **4,900 drivers**. The file is inside the archive on his personal Drive.\n\n" +
            "**Known:** the laptop has not been imaged; he has it at his desk. His GitHub token is still valid.\n\n" +
            "**Unknown:** whether he has copied more since the morning.",
          artifacts: [DPA_EXTRACT],
        },
        critical: {
          narrativeMd:
            "Monday 13:00. Forensics has read the Snowflake export: telemetry for three customers with driver names, mobile numbers and GPS traces for about **4,900 drivers**. GitHub shows the token was used at 11:40 from **198.51.100.62** to clone two more repositories.\n\n" +
            "**Known:** his laptop has not been returned and he is not answering calls.\n\n" +
            "**Unknown:** where the laptop and USB device are.",
          consequenceText: "Copying continued after he was tipped off, and customer personal data is now off company systems.",
          artifacts: [DPA_EXTRACT],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Privacy counsel",
          stem: "Customer driver data is on a personal Drive. What do you owe the three customers?",
          discussionPrompt: "Do you know which of your DPAs set 48 hours, and from what start event?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Treat it as a breach, notify the three customers today with known facts, and set an update date.",
              quality: ["great", "great", "great"],
              followUp: "The three customers have notice today with known facts and an update date.",
              rationale: "As processor you notify controllers without undue delay, and the DPAs set 48 hours. They have their own 72 hour clock.",
              clocks: [{ key: CLOCKS.dpa.key, action: "met" }],
            },
            {
              id: "b",
              text: "Treat it as an HR matter, not a breach, since an employee with authorized access made the copy.",
              quality: ["bad", "bad", "bad"],
              followUp: "No customer notice is planned.",
              rationale: "Authorized access does not authorize copying to personal storage. Unauthorized disclosure is a breach.",
            },
            {
              id: "c",
              text: "Wait until the court orders him to return the data, then tell customers it was recovered.",
              quality: ["bad", "bad", "bad"],
              followUp: "Customer notice waits for a court order.",
              rationale: "The DPA and the customers' GDPR clocks run now. Recovery later does not change that notice was due.",
            },
            {
              id: "d",
              text: "Notify the two EU customers today and the US customer after checking whether its state laws apply.",
              quality: ["good", "good", "neutral"],
              followUp: "The EU customers have notice. The US customer will hear after a state law check.",
              rationale: "EU notice is right. The US customer's DPA may set the same 48 hours whatever state law says.",
              clocks: [{ key: CLOCKS.dpa.key, action: "met" }],
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Counsel approves cutting access. Which paths do you close?",
          discussionPrompt: "Which tokens and sessions survive disabling a user in your identity provider?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Disable the IdP account, revoke the GitHub token, Snowflake user and Google sessions, collect and image the laptop.",
              quality: ["great", "great", "great"],
              followUp: "The IdP account, GitHub token, Snowflake user and Google sessions are revoked, and the laptop is imaged.",
              rationale: "Personal access tokens and app sessions survive an IdP disable. Each has to be revoked in its own platform.",
            },
            {
              id: "b",
              text: "Disable his single sign-on account, which ends access to every application behind it at once.",
              quality: ["neutral", "bad", "bad"],
              followUp: "His SSO account is disabled. The GitHub token is still valid.",
              rationale: "A GitHub personal access token does not use SSO sessions. It keeps working until revoked.",
            },
            {
              id: "c",
              text: "Rotate the Snowflake service credentials and leave his personal accounts alone until HR has met him.",
              quality: ["bad", "bad", "bad"],
              followUp: "Snowflake service credentials are rotated. His own access is unchanged.",
              rationale: "The export used his own user, not a service account. Rotating the wrong credentials leaves him in.",
            },
            {
              id: "d",
              text: "Revoke the IdP account and GitHub token now, and review Snowflake and Google access tomorrow.",
              quality: ["good", "neutral", "neutral"],
              followUp: "IdP and GitHub access are gone. Snowflake and Google wait for tomorrow.",
              rationale: "The two biggest paths are closed. Snowflake held the personal data and is still open.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Counsel briefs you on the plan for the 15:30 meeting. What do you approve?",
          discussionPrompt: "Who should be in the room with him, and who should not?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "HR and counsel meet him with a written return request, his agreements, and no threats of prosecution.",
              quality: ["great", "great", "great"],
              followUp: "HR and counsel will meet him with a written request and his agreements.",
              rationale: "A calm meeting with a clear written request is the best chance of getting copies back and a record of his answers.",
            },
            {
              id: "b",
              text: "Join the meeting yourself to tell him he is betraying the company and will be prosecuted if he does not comply.",
              quality: ["bad", "bad", "bad"],
              followUp: "The CEO will join the meeting.",
              rationale: "Threatening prosecution to get property back creates legal risk and hardens his position.",
            },
            {
              id: "c",
              text: "Skip the meeting and send him a termination letter by email this afternoon with a demand to return everything.",
              quality: ["neutral", "neutral", "good"],
              followUp: "A termination and demand letter will go by email.",
              rationale: "A letter is a record, but no meeting means no chance to hear what he took and where it is.",
            },
            {
              id: "d",
              text: "HR and counsel meet him, with his manager present to explain the technical details of what was taken.",
              quality: ["good", "neutral", "neutral"],
              followUp: "HR, counsel and his manager will meet him.",
              rationale: "The plan is sound, but his manager becomes a witness and the meeting gets personal.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "My own notes",
      scenarioOffsetMin: 390,
      plannedDelayMin: 10,
      objectiveKeys: ["o4", "o1"],
      expectedActions: [
        {
          team: LEGAL,
          actions: [
            "Sends a demand letter to him and a preservation letter to the new employer",
            "Prepares a TRO under the DTSA and state law",
            "Checks whether his agreement has the DTSA immunity notice",
          ],
        },
        { team: HR, actions: ["Places him on leave or ends employment with written reasons", "Tells his team only what they need to know"] },
        { team: EXEC, actions: ["Decides on a law enforcement referral on counsel's advice", "Records the decision and the reasons"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Monday 16:00. In the meeting Owen said he took only his own notes and code he wrote. He returned the company laptop but refused to hand over his home computer, the USB device or his Drive account. He starts at ${RIVAL} next Monday.\n\n` +
            "**Known:** his 2019 agreement assigns all work product to Larkspan and requires return of confidential information. It does not include the whistleblower immunity notice.\n\n" +
            "**Unknown:** whether he will delete or share the copies.",
          artifacts: [OWEN_REPLY],
        },
        degrading: {
          narrativeMd:
            "Monday 16:00. In the meeting Owen said he took only his own notes and code he wrote, and refused to hand over his home computer, the USB device or his Drive account. He kept the company laptop, saying his personal photos are on it.\n\n" +
            "**Known:** his 2019 agreement assigns all work product and requires return of confidential information. It lacks the whistleblower immunity notice.\n\n" +
            "**Unknown:** whether he will delete or share the copies.",
          artifacts: [OWEN_REPLY],
        },
        critical: {
          narrativeMd:
            "Monday 16:00. Owen did not come to the meeting. His lawyer wrote that he will not hand over anything. The company laptop is still with him. A routing engineer says Owen told him last week that he was \"taking the engine with him\".\n\n" +
            "**Known:** his 2019 agreement assigns all work product and requires return of confidential information. It lacks the whistleblower immunity notice.\n\n" +
            "**Unknown:** where the copies are now.",
          consequenceText: "He has counsel and the evidence, and a coworker's statement suggests intent.",
          artifacts: [OWEN_REPLY],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "He refuses to return the copies and starts at the competitor next Monday. What do you do?",
          discussionPrompt: "What would you need to show a court for an order before he starts on Monday?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Demand letter to him, preservation letter to the competitor, and a TRO ready to file under the DTSA this week.",
              quality: ["great", "great", "great"],
              followUp: "Letters are out to him and the competitor, and a TRO is ready to file this week.",
              rationale: "Letters create a record and invite cooperation. A TRO ready to file covers the case where they do not work.",
            },
            {
              id: "b",
              text: "Apply for an ex parte seizure of his home computer and USB device under the DTSA tomorrow.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Counsel is preparing an ex parte seizure application.",
              rationale: "Seizure is for extraordinary cases, such as evidence he would evade an order. It fits better if intent is clear.",
            },
            {
              id: "c",
              text: "Seek an injunction barring him from working at the competitor for two years under his agreement.",
              quality: ["bad", "bad", "bad"],
              followUp: "Counsel was asked to stop him working at the competitor.",
              rationale: "The DTSA does not allow an injunction that stops someone taking a job. Relief must rest on threatened misuse.",
            },
            {
              id: "d",
              text: "Send a demand letter to him only, and wait a week for his lawyer's reply before taking any further step.",
              quality: ["good", "neutral", "bad"],
              followUp: "A demand letter went to him. Nothing went to the competitor.",
              rationale: "A letter is a sound first step, but a week's wait runs past his start date.",
            },
          ],
        },
        {
          team: HR,
          decisionOwner: "Chief people officer",
          stem: "What happens to his employment and to what his team hears?",
          discussionPrompt: "What can you tell his team without naming conclusions you cannot prove yet?",
          capabilityKeys: ["RS.CO", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Paid leave until his last day with access off, and tell his team he is on leave and who covers his work.",
              quality: ["great", "great", "great"],
              followUp: "He is on paid leave with no access. His team knows he is on leave and who covers his work.",
              rationale: "Leave removes access without escalating, and a neutral team message avoids defamation and rumor.",
            },
            {
              id: "b",
              text: "Tell the engineering team he stole the routing engine so they understand why the company is acting.",
              quality: ["bad", "bad", "bad"],
              followUp: "Engineering was told he stole the routing engine.",
              rationale: "Stating theft as fact before it is proven risks defamation and puts the litigation at risk.",
            },
            {
              id: "c",
              text: "End his employment today for breach of policy, with a written reason, and say nothing to the team.",
              quality: ["good", "good", "good"],
              followUp: "His employment ended today with a written reason. The team has not been told.",
              rationale: "Ending employment is defensible. The team will talk anyway, so a short neutral message helps.",
            },
            {
              id: "d",
              text: "Let him work out his notice with his access restored, to show good faith while lawyers talk.",
              quality: ["bad", "bad", "bad"],
              followUp: "His access is restored for his notice period.",
              rationale: "Restoring access to someone who refused to return copies reopens the paths you just closed.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Counsel asks whether to refer this to the FBI. What do you decide?",
          discussionPrompt: "What do you gain and lose by referring now rather than after the civil case starts?",
          capabilityKeys: ["GV.RR"],
          options: [
            {
              id: "a",
              text: "Follow counsel's advice on timing, decide after the TRO hearing, and record the reasons either way.",
              quality: ["great", "great", "good"],
              followUp: "The referral decision is set for after the TRO hearing, with reasons to be recorded.",
              rationale: "A referral costs control over timing and publicity. Deciding after the civil step keeps both options open.",
            },
            {
              id: "b",
              text: "Refer to the FBI today and pause the civil steps so nothing interferes with a criminal case.",
              quality: ["neutral", "neutral", "great"],
              followUp: "The FBI has a referral and the civil steps are paused.",
              rationale: "When intent is clear and copies may be spread, an early referral can help, but pausing civil relief is a cost.",
            },
            {
              id: "c",
              text: "Tell his lawyer the company will go to the FBI unless he hands everything back by Wednesday.",
              quality: ["bad", "bad", "bad"],
              followUp: "His lawyer was told about a possible FBI referral unless he complies.",
              rationale: "Threatening criminal referral to gain advantage in a civil matter can be improper and weakens the case.",
            },
            {
              id: "d",
              text: "Decide against any referral now so the matter stays private, and revisit only if he shares the code.",
              quality: ["good", "neutral", "bad"],
              followUp: "No referral for now.",
              rationale: "Keeping it private is reasonable early, but ruling it out removes a tool if the civil steps fail.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The controller asks for details",
      scenarioOffsetMin: 2910,
      plannedDelayMin: 10,
      objectiveKeys: ["o3", "o4"],
      expectedActions: [
        { team: LEGAL, actions: ["Answers the customer DPO by 14:00 with what is known and unknown", "Agrees a forensic protocol with the competitor's counsel"] },
        { team: SEC, actions: ["States what logs can and cannot prove about the USB copy", "Proposes an examiner certification of deletion"] },
        { team: EXEC, actions: ["Calls the three customers' executives", "Approves a short internal message"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Wednesday 10:00. A carrier's data protection officer needs facts by 14:00 to decide on notifying its supervisory authority. ${RIVAL}'s counsel says Owen has no ${RIVAL} devices yet and offers to cooperate with a protocol to confirm that.\n\n` +
            "**Known:** Owen's lawyer has agreed to let a neutral examiner image his home computer and USB device on Friday.\n\n" +
            "**Unknown:** whether the Drive archive was shared with anyone.",
          artifacts: [CUSTOMER_EMAIL, RIVAL_LETTER],
        },
        degrading: {
          narrativeMd:
            `Wednesday 10:00. A carrier's data protection officer needs facts by 14:00 to decide on notifying its supervisory authority. ${RIVAL}'s counsel offers to cooperate with a protocol and asks Larkspan not to contact its staff.\n\n` +
            "**Known:** Owen's lawyer has not agreed to any examination. The TRO hearing is set for Friday.\n\n" +
            "**Unknown:** whether the Drive archive was shared.",
          artifacts: [CUSTOMER_EMAIL, RIVAL_LETTER],
        },
        critical: {
          narrativeMd:
            `Wednesday 10:00. A carrier's data protection officer needs facts by 14:00. The US customer heard about the incident from a Larkspan engineer at a conference and has escalated to its CEO. ${RIVAL}'s counsel offers a protocol and asks Larkspan not to contact its staff.\n\n` +
            "**Known:** Owen's lawyer refuses any examination. The TRO hearing is Friday.\n\n" +
            "**Unknown:** whether the Drive archive was shared.",
          consequenceText: "A customer learned of the incident informally, and trust is now part of the problem.",
          artifacts: [CUSTOMER_EMAIL, RIVAL_LETTER],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Privacy counsel",
          stem: "The carrier's DPO wants facts by 14:00 for its own regulator decision. What do you send?",
          discussionPrompt: "What can you say with confidence about where the data is now?",
          capabilityKeys: ["RS.CO", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Driver count, fields, known locations of copies, steps to recover them, and what is still unknown, by 14:00.",
              quality: ["great", "great", "great"],
              followUp: "The DPO has the driver count, fields, known copies, recovery steps and open questions by 14:00.",
              rationale: "The controller decides on its own notice. It needs facts and unknowns stated plainly, on time.",
            },
            {
              id: "b",
              text: "Say the matter is in litigation and that you cannot share details until the court rules on Friday.",
              quality: ["bad", "bad", "bad"],
              followUp: "The DPO was told details wait for the court.",
              rationale: "Litigation does not suspend a processor's duty to help the controller meet its notice obligations.",
            },
            {
              id: "c",
              text: "Tell the DPO the data has been contained and recovered, since the employee agreed to an examination.",
              quality: ["bad", "bad", "bad"],
              followUp: "The DPO was told the data is contained and recovered.",
              rationale: "An agreed examination is not recovery. Overstating containment can mislead the controller's regulator notice.",
            },
            {
              id: "d",
              text: "Send the driver count and fields by 14:00, and follow with copy locations after the examination.",
              quality: ["good", "good", "neutral"],
              followUp: "The DPO has the count and fields. Copy locations will follow.",
              rationale: "The core facts are on time. Where copies are matters to the controller's risk assessment too.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "Counsel asks what you can prove about the copies. What do you tell them?",
          discussionPrompt: "What would a neutral examiner need from you to confirm deletion?",
          capabilityKeys: ["RS.AN"],
          options: [
            {
              id: "a",
              text: "What logs show, what they cannot show about the USB copy, and a search list for a neutral examiner.",
              quality: ["great", "great", "great"],
              followUp: "Counsel has what the logs show and do not show, and a search list for the examiner.",
              rationale: "Stating the limits of the evidence keeps counsel's filings and customer notices accurate.",
            },
            {
              id: "b",
              text: "Say the logs prove he copied everything to the USB device, which makes the court case stronger.",
              quality: ["bad", "bad", "bad"],
              followUp: "Counsel was told the logs prove a full USB copy.",
              rationale: "The DLP log shows 1,204 files written, not which ones. Overstating evidence can collapse in court.",
            },
            {
              id: "c",
              text: "Say nothing can be proven without his home computer, so counsel should not rely on the logs yet.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Counsel was told nothing can be proven yet.",
              rationale: "The logs prove a lot: the clone, the export and the upload. Underselling them weakens the TRO.",
            },
            {
              id: "d",
              text: "Give counsel the GitHub and Snowflake evidence now, and add the DLP and Drive evidence next week.",
              quality: ["good", "good", "neutral"],
              followUp: "Counsel has the GitHub and Snowflake evidence.",
              rationale: "That evidence is strong, but the TRO hearing on Friday needs the upload and USB facts too.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Customers and staff are hearing versions of the story. What do you do today?",
          discussionPrompt: "Who calls each affected customer's leadership, and with what script?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "Call the three customers' leaders with a script counsel approved, and send staff a short, neutral note.",
              quality: ["great", "great", "great"],
              followUp: "The three customers' leaders had a call, and staff got a short note.",
              rationale: "Direct calls rebuild trust, and a neutral staff note stops rumors without naming conclusions.",
            },
            {
              id: "b",
              text: "Say nothing to anyone outside the legal team until the court case is over, to protect privilege.",
              quality: ["bad", "bad", "bad"],
              followUp: "Nothing is said outside the legal team.",
              rationale: "Customers already have notice and questions. Silence now reads as hiding.",
            },
            {
              id: "c",
              text: "Post a company-wide message naming the engineer and the competitor so staff know the risks of leaving with data.",
              quality: ["bad", "bad", "bad"],
              followUp: "A company-wide message named the engineer and the competitor.",
              rationale: "Naming him and the competitor before any finding invites defamation and interference claims.",
            },
            {
              id: "d",
              text: "Call the US customer, which escalated, and email the two EU customers an update from privacy counsel.",
              quality: ["good", "good", "good"],
              followUp: "The US customer had a call and the EU customers have an email update.",
              rationale: "Responding where it is loudest helps, but all three customers' data is in the same file.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The day he starts",
      scenarioOffsetMin: 10080,
      plannedDelayMin: 10,
      objectiveKeys: ["o5", "o4"],
      expectedActions: [
        { team: SEC, actions: ["Moves access review for high-risk departures to the day notice is given", "Limits personal access tokens and Snowflake exports"] },
        { team: HR, actions: ["Adds the DTSA immunity notice to agreements", "Changes the exit process for high-risk roles"] },
        { team: LEGAL, actions: ["Reports outcomes and remaining risks to the board", "Updates customers on recovery"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Monday 09:30. Owen starts at ${RIVAL} today. On Friday the court entered an agreed order: he must not use Larkspan information, and the neutral examiner certified deletion from his home computer, USB device and Drive. No sign of sharing was found.\n\n` +
            "**Known:** customers have an update. The board meets Thursday.\n\n" +
            "**Unknown:** whether he kept a copy the examiner did not find.",
        },
        degrading: {
          narrativeMd:
            `Monday 09:30. Owen starts at ${RIVAL} today. On Friday the court granted a TRO barring use of Larkspan information and ordering an examination this week.\n\n` +
            "**Known:** the Drive archive was shared once, with an address at a personal email domain. Customers have an update. The board meets Thursday.\n\n" +
            "**Unknown:** who owns that address.",
        },
        critical: {
          narrativeMd:
            `Monday 09:30. Owen starts at ${RIVAL} today. On Friday the court granted a TRO and an examination. The examiner reports the USB device was not produced; Owen says he lost it.\n\n` +
            "**Known:** the Drive archive was shared once, with an unknown address. The US customer has asked to review its contract. The board meets Thursday.\n\n" +
            "**Unknown:** where the USB device is.",
          consequenceText: "A copy is unaccounted for and a customer relationship is at risk.",
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "What changes so this cannot happen the same way again?",
          discussionPrompt: "Which roles in your company would you treat as high-risk departures?",
          capabilityKeys: ["ID.IM", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Review access at notice for high-risk roles, expire tokens, alert on bulk exports and personal storage.",
              quality: ["great", "great", "great"],
              followUp: "Access review at notice, token expiry and export alerts are on the plan with owners and dates.",
              rationale: "The copying happened between notice and last day, through a token without expiry and an unwatched export.",
            },
            {
              id: "b",
              text: "Block all USB devices company-wide, which closes the main way data left the building.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "USB devices are blocked company-wide.",
              rationale: "USB was one path. The clone and the Drive upload did not need it.",
            },
            {
              id: "c",
              text: "Keep controls as they are, since the DLP alert worked and the case was handled well.",
              quality: ["bad", "bad", "bad"],
              followUp: "Controls are unchanged.",
              rationale: "The alert sat overnight and the token never expired. The same path is still open.",
            },
            {
              id: "d",
              text: "Expire personal access tokens after 30 days and alert on bulk Snowflake exports from human users.",
              quality: ["good", "good", "good"],
              followUp: "Token expiry and Snowflake export alerts are on the plan.",
              rationale: "These close two paths. Access review at notice addresses the timing that made this possible.",
            },
          ],
        },
        {
          team: HR,
          decisionOwner: "Chief people officer",
          stem: "His agreement lacked the DTSA immunity notice. What changes in People processes?",
          discussionPrompt: "When were your employment agreements last reviewed by counsel?",
          capabilityKeys: ["GV.RR", "ID.IM"],
          options: [
            {
              id: "a",
              text: "Add the immunity notice to all agreements, and set an exit process for high-risk roles at notice.",
              quality: ["great", "great", "great"],
              followUp: "The notice is going into all agreements and a high-risk exit process is being written.",
              rationale: "Without the notice, exemplary damages and fees are not available. Exit at notice closes the timing gap.",
            },
            {
              id: "b",
              text: "Require every departing employee to sign a statement that they have taken nothing, on their last day.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Departing staff will sign a statement on their last day.",
              rationale: "A signed statement helps a later case but comes after the copying.",
            },
            {
              id: "c",
              text: "Make engineers who resign leave the same day without notice pay, to remove the risk window.",
              quality: ["bad", "bad", "bad"],
              followUp: "Resigning engineers will leave the same day without notice pay.",
              rationale: "Withholding notice pay may breach contracts or wage laws, and pushes people to copy before resigning.",
            },
            {
              id: "d",
              text: "Add the immunity notice to agreements for new hires, and update existing ones at the next review.",
              quality: ["good", "good", "neutral"],
              followUp: "New hire agreements will have the notice. Existing ones wait for review.",
              rationale: "New hires are covered, but the remedy applies to agreements as updated, so existing staff matter too.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The board meets Thursday. What do you report?",
          discussionPrompt: "What is the remaining risk, and who owns watching for it?",
          capabilityKeys: ["GV.OC", "ID.IM"],
          options: [
            {
              id: "a",
              text: "Timeline, customer notices, court outcome, remaining risk from any unrecovered copy, and fixes with owners.",
              quality: ["great", "great", "great"],
              followUp: "The board has the timeline, notices, court outcome, remaining risk and fixes.",
              rationale: "The board needs remaining risk stated plainly, not only the wins, to oversee it.",
            },
            {
              id: "b",
              text: "Report that the matter is resolved because a court order is in place, and close the file.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board heard the matter is resolved.",
              rationale: "An order does not prove every copy is gone. Closing the file hides residual risk.",
            },
            {
              id: "c",
              text: "Report the court outcome and costs, and leave customer and control topics to the CISO's next update.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The board has the court outcome and costs.",
              rationale: "Legal outcomes are only part of it. Customer exposure and controls are board topics too.",
            },
            {
              id: "d",
              text: "Report the full picture and propose an outside review of offboarding and data controls within 60 days.",
              quality: ["good", "good", "great"],
              followUp: "The board has the full picture and an outside review is proposed.",
              rationale: "An outside review is sound, and essential when a copy is still unaccounted for.",
            },
          ],
        },
      ],
    }),
  ],
};

export const GENERAL_CRISISSIM_INSIDER_DATA_THEFT = INSIDER_DATA_THEFT;
