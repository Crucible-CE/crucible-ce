// Crisis Sim: help desk vishing leads to Okta Super Administrator, a rogue
// inbound identity provider, and impersonation across a sprawl of SSO apps
// at a mutual insurer. Grounded in CISA AA23-320A (rev. 2025-07-29), Okta's
// 2023 cross-tenant impersonation advisory, the MGM and Caesars 2023
// replays, Okta session revocation docs and 23 NYCRR 500.17, as summarized
// in the threat brief and its addendum. Matches
// playbooks/identity-provider-compromise.md (C-A, C-B, C-C, R-A and section
// 12). All names are fictional; IP addresses are RFC 5737.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const IDENTITY_TAKEOVER_TEMPLATE_ID = "lib-general-crisissim-identity-takeover";

const ORG = "Fenmore Mutual Insurance";
const DOMAIN = "fenmoremutual.example";
const EXEC = "Executive";
const SEC = "Security";
const IDENT = "IT and Identity";
const LEGAL = "Legal and Compliance";

const CLOCKS = {
  insurer: { key: "insurer_notice", label: "Cyber insurer notice (policy: 48 hours)", durationHours: 48 },
  nydfs: { key: "nydfs_72h", label: "NYDFS incident notice (23 NYCRR 500.17(a), 72 hours)", durationHours: 72 },
  nydfsRansom: { key: "nydfs_ransom_24h", label: "NYDFS extortion payment notice (500.17(c), 24 hours)", durationHours: 24 },
  states: { key: "state_ag", label: "State breach notices (counsel's state map, 30 day target)", durationHours: 30 * 24 },
} as const;

const PROFILE =
  `**${ORG}** is a policyholder-owned property, casualty and workers' compensation insurer in Syracuse, New York, with about 1,700 staff and 600 independent agencies in New York, New Jersey and Pennsylvania. It is licensed by the New York Department of Financial Services and is a covered entity under 23 NYCRR Part 500. ` +
  "Workforce identity is Okta, synced from on-premises Active Directory by the Okta AD agent, with single sign-on to about 180 applications: Microsoft 365, Box for claim files, Salesforce for agency management, Workday, ServiceNow, GitHub, an AWS organization and the policy and claims platforms. " +
  "The in-house service desk resets passwords and MFA around the clock. Four people hold Okta Super Administrator.";

const OKTA_LOG = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Okta System Log, Tuesday",
  from: "Security operations",
  sentAt: "Tuesday 18:15",
  content: [
    "```",
    "17:51:20  user.mfa.factor.reset_all       actor=sd-agent-07@" + DOMAIN + "  target=priya.natarajan@" + DOMAIN,
    "17:54:02  user.mfa.factor.activate         target=priya.natarajan@" + DOMAIN + "  factor=Okta Verify  client=198.51.100.37",
    "17:56:40  user.session.start               priya.natarajan@" + DOMAIN + "  client=198.51.100.37  result=SUCCESS",
    "18:02:11  system.idp.lifecycle.create      actor=priya.natarajan@" + DOMAIN + "  idp=\"Fenmore-SSO-2\" type=SAML2",
    "18:04:37  user.account.privilege.grant     actor=priya.natarajan@" + DOMAIN + "  target=svc-sso-sync@" + DOMAIN + "  role=SUPER_ADMIN",
    "18:09:55  user.authentication.auth_via_IDP  idp=\"Fenmore-SSO-2\"  user=dana.okoro@" + DOMAIN + "  (CFO)",
    "```",
  ].join("\n"),
};

const BOX_LOG = {
  id: "a1",
  kind: "log_excerpt" as const,
  title: "Box and AWS events since 18:00",
  from: "Security operations",
  sentAt: "Tuesday 20:50",
  content: [
    "```",
    "Box    18:31-20:40  user=claims.director@" + DOMAIN + "  event=DOWNLOAD  folders=Claims/WC/2024-2026  files=48,112  client=198.51.100.37",
    "Box    19:12        user=claims.director@" + DOMAIN + "  event=COLLABORATION_INVITE  external=filedrop@mail.example",
    "AWS    19:40:03     CloudTrail  CreateUser  userName=backup-audit  via=AWSReservedSSO_AdministratorAccess",
    "AWS    19:40:31     CloudTrail  CreateAccessKey  userName=backup-audit",
    "M365   20:05        Consent to application  app=\"DocuSync Connector\"  user=dana.okoro@" + DOMAIN + "  IsAdminConsent=True",
    "```",
  ].join("\n"),
};

const EXTORTION = {
  id: "a1",
  kind: "email" as const,
  title: "Email to the CEO and the board chair",
  from: "Unknown sender",
  sentAt: "Thursday 12:47",
  content:
    `**From:** fenmore-files@proton.example\n**To:** CEO <ceo@${DOMAIN}>; Board chair\n**Subject:** your claimants\n\n` +
    "We had your Okta for two days. We have 48,000 workers' comp claim files with medical records and Social Security numbers, your CFO's mail, and your AWS keys. Sample attached.\n\n" +
    "Pay $4,000,000 in Bitcoin within 72 hours. If not, we post everything and call your claimants and agents ourselves. Do not bring in the FBI.",
};

const LEAK = {
  id: "a1",
  kind: "social_post" as const,
  title: "Leak forum post",
  from: "Forum",
  sentAt: "Monday 23:10",
  content:
    "**Fenmore Mutual Insurance (New York)**\n\nWorkers' comp claims with medical reports. 2 GB sample free. Full 1.4 TB to the first buyer. They did not want to talk.",
};

const IDENTITY_TAKEOVER: LibraryCrisisSimTemplate = {
  id: IDENTITY_TAKEOVER_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Okta takeover at a mutual insurer",
  summary:
    "A caller gets the service desk to reset MFA for an Okta Super Administrator. Within twenty minutes there is a rogue identity provider and impersonated executives across 180 SSO apps. Four teams decide on org-wide session revocation, cloud cleanup, NYDFS notice and an extortion demand.",
  config: {
    schemaVersion: 1,
    teams: [EXEC, SEC, IDENT, LEGAL],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 2, time: "18:20" },
    orgName: ORG,
    threatActorKey: "scattered-spider",
    replayKey: "mgm-2023",
    capabilityKeys: ["PR.AA", "RS.MA", "RS.MI", "RS.AN", "RS.CO", "GV.RR", "GV.OC", "GV.SC", "RC.RP"],
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.nydfs, CLOCKS.nydfsRansom, CLOCKS.states],
    executiveBriefMd: [
      PROFILE,
      "",
      "At 17:48 on Tuesday a caller reached the service desk as Priya Natarajan, a senior identity engineer and Okta Super Administrator, saying her phone had been stolen at the airport. The agent checked her employee ID and manager's name, reset all her MFA factors and let her enroll a new phone.",
      "",
      "The Executive, Security, IT and Identity, and Legal and Compliance teams make decisions over one week of simulated time. Four clocks can start: cyber insurer notice, the NYDFS 72 hour incident notice, the NYDFS 24 hour extortion payment notice, and state breach notices.",
      "",
      "Use your own incident response plan. The library playbook for this scenario is Identity provider compromise response.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Remove the attacker from the Okta admin plane within one hour of detection, using break-glass access.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "o2", text: "Decide on org-wide session revocation and end app sessions that survive it, with the decision recorded.", capabilityKeys: ["RS.MI", "GV.RR"] },
    { key: "o3", text: "Freeze privileged resets and put a verification rule in place that does not rely on knowledge questions.", capabilityKeys: ["PR.AA", "GV.SC"] },
    { key: "o4", text: "File the NYDFS notice within 72 hours of determination and plan state notices with known facts.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "o5", text: "Make a documented extortion decision with OFAC, insurer, FBI and board input.", capabilityKeys: ["GV.RR", "GV.OC"] },
  ],
  injects: [
    inject({
      title: "A second Priya Natarajan",
      scenarioOffsetMin: 0,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o3"],
      clockTriggers: [CLOCKS.insurer.key],
      expectedActions: [
        {
          team: IDENT,
          actions: [
            "Signs in with break-glass and suspends both accounts",
            "Deletes the Fenmore-SSO-2 identity provider and removes the new Super Administrator grant",
            "Clears sessions and revokes tokens for both accounts",
          ],
        },
        { team: SEC, actions: ["Moves coordination to the out-of-band bridge", "Freezes admin and IT resets at the service desk"] },
        { team: EXEC, actions: ["Declares an incident and names an incident commander", "Has counsel engage the IR retainer and notify the insurer"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 18:20. The real **Priya Natarajan** calls the security on-call from her desk phone: Okta Verify on her phone stopped working and she did not ask for a reset. The on-call analyst sees an alert for a new identity provider created at 18:02 from **198.51.100.37**.\n\n" +
            "**Known:** an inbound SAML identity provider named Fenmore-SSO-2 exists, a service account svc-sso-sync now holds Super Administrator, and the CFO's account signed in through the new provider at 18:09.\n\n" +
            "**Unknown:** what else the attacker has done in 25 minutes.",
          artifacts: [OKTA_LOG],
        },
        degrading: {
          narrativeMd:
            "Tuesday 18:20. Priya Natarajan emails the service desk from her laptop to say she is locked out of Okta Verify. The ticket reaches security 30 minutes later. An alert for a new identity provider, created at 18:02 from **198.51.100.37**, is unread in the queue.\n\n" +
            "**Known:** an identity provider named Fenmore-SSO-2 exists and svc-sso-sync now holds Super Administrator.\n\n" +
            "**Unknown:** who has signed in through the new provider.",
          artifacts: [OKTA_LOG],
        },
        critical: {
          narrativeMd:
            "Tuesday 18:20. Priya Natarajan is on a flight. A second caller has just asked the service desk to reset MFA for **Marcus Bell**, another Super Administrator, using details from an internal org chart. The agent did it. An alert for a new identity provider created at 18:02 is unread.\n\n" +
            "**Known:** two Super Administrator accounts and svc-sso-sync are in the attacker's hands. The CFO's account signed in through Fenmore-SSO-2 at 18:09.\n\n" +
            "**Unknown:** how many users have been impersonated.",
          consequenceText: "The attacker has three admin accounts and a way to sign in as anyone.",
          artifacts: [OKTA_LOG],
        },
      },
      questions: [
        {
          team: IDENT,
          decisionOwner: "Identity lead",
          stem: "The attacker holds Super Administrator and a rogue identity provider. What do you do in the next 30 minutes?",
          discussionPrompt: "When did someone last sign in with your Okta break-glass accounts, and where are the credentials?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Use break-glass to suspend the accounts, delete Fenmore-SSO-2, remove the admin grant, and clear their sessions.",
              quality: ["great", "great", "great"],
              followUp: "Break-glass was used to suspend the accounts, delete the rogue provider, remove the grant and clear sessions.",
              rationale: "Okta's 2023 advisory describes this exact abuse. Removing the provider and the grant ends impersonation.",
            },
            {
              id: "b",
              text: "Reset Priya's password and MFA again with her on the phone, and ask her to check the admin console tomorrow.",
              quality: ["bad", "bad", "bad"],
              followUp: "Priya's credentials were reset again. The provider and the new admin are still there.",
              rationale: "The attacker no longer needs Priya's account. The rogue provider lets it sign in as anyone.",
            },
            {
              id: "c",
              text: "Shut down the Okta AD agent servers so no synced account can sign in until the tenant is rebuilt.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "The AD agents are off. Inbound federation and svc-sso-sync still work.",
              rationale: "MGM shut down Okta sync servers in 2023 and the outage worsened. Cloud admin and federation are untouched.",
            },
            {
              id: "d",
              text: "Suspend Priya's account and svc-sso-sync now, and review identity providers once the IR firm joins.",
              quality: ["good", "neutral", "bad"],
              followUp: "Both accounts are suspended. Fenmore-SSO-2 is still active.",
              rationale: "Suspending accounts helps, but the rogue provider still lets the attacker sign in as any user.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The attacker may be reading mail and chat. How do you run the response tonight?",
          discussionPrompt: "Does your out-of-band bridge depend on Okta to sign in?",
          capabilityKeys: ["RS.MA", "PR.AA"],
          options: [
            {
              id: "a",
              text: "Move to the out-of-band bridge, verify each person by call-back, and freeze admin and IT resets at the desk.",
              quality: ["great", "great", "great"],
              followUp: "The response is on the out-of-band bridge, each person was verified, and privileged resets are frozen.",
              rationale: "Attackers in this pattern join incident calls. A channel outside the IdP and a reset freeze cut both paths.",
            },
            {
              id: "b",
              text: "Run the response in the usual Teams channel so everyone can find it, and lock it to the security group.",
              quality: ["bad", "bad", "bad"],
              followUp: "The response runs in Teams, locked to the security group.",
              rationale: "The attacker can sign in as any user, including members of the security group.",
            },
            {
              id: "c",
              text: "Freeze all resets at the service desk and run the response in Teams until the provider is removed.",
              quality: ["good", "neutral", "bad"],
              followUp: "All resets are frozen. The response is in Teams.",
              rationale: "The freeze closes the attack path, but the response channel is still inside the compromised IdP.",
            },
            {
              id: "d",
              text: "Move to the out-of-band bridge and let the service desk keep resetting with extra knowledge questions.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The response is out of band. Resets continue with extra questions.",
              rationale: "A caller who researched the target answers knowledge questions. The desk is still the way in.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The CISO calls at 18:30. What do you set in motion?",
          discussionPrompt: "Who approves actions that will lock out every employee, and how fast can you reach them?",
          capabilityKeys: ["RS.MA", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Declare an incident, name the CISO incident commander, have counsel engage IR, and meet every three hours.",
              quality: ["great", "great", "great"],
              followUp: "An incident is declared, the CISO commands, counsel engaged IR, and executives meet every three hours.",
              rationale: "A commander, counsel directed IR and a cadence are what fast identity decisions tonight depend on.",
              clocks: [{ key: CLOCKS.insurer.key, action: "met" }],
            },
            {
              id: "b",
              text: "Ask for a written summary by morning so the executive team can decide whether this is a real incident.",
              quality: ["bad", "bad", "bad"],
              followUp: "A written summary is due in the morning.",
              rationale: "A rogue identity provider is a Sev 1 by any measure. The night decides how far the attacker gets.",
            },
            {
              id: "c",
              text: "Tell all staff by email tonight that Okta is compromised and they should not sign in until further notice.",
              quality: ["bad", "neutral", "neutral"],
              followUp: "An all-staff email says Okta is compromised.",
              rationale: "The attacker can read that email, and a vague stop order without a plan causes confusion.",
            },
            {
              id: "d",
              text: "Have the CISO lead tonight and engage the IR retainer, and brief the full executive team at 08:00.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The CISO leads tonight with the IR retainer. Executives meet at 08:00.",
              rationale: "Engaging IR is right, but org-wide decisions tonight need an executive who can approve them.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Fourteen users who never signed in",
      scenarioOffsetMin: 160,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o4"],
      clockTriggers: [CLOCKS.nydfs.key],
      expectedActions: [
        {
          team: IDENT,
          actions: [
            "Revokes sessions and tokens for every user and admin with Universal Logout where supported",
            "Warns staff before the revocation",
            "Leaves directory sync running and records why",
          ],
        },
        { team: SEC, actions: ["Removes the AWS IAM user and its access key and reviews CloudTrail", "Revokes the DocuSync Connector consent", "Removes the Box external collaborator"] },
        { team: LEGAL, actions: ["Records the NYDFS determination time and basis", "Starts drafting the 72 hour notice"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 21:00. The rogue provider is gone, but between 18:09 and 18:58 the attacker signed in as **14 users** through it, including the CFO and the claims director. As the claims director, it downloaded about **48,000 workers' compensation claim files** from Box and invited an outside address to a folder.\n\n" +
            "**Known:** an AWS IAM user named backup-audit was created through SSO with an access key. An app called DocuSync Connector got admin consent in Microsoft 365.\n\n" +
            "**Unknown:** which app sessions those 14 users still have.",
          artifacts: [BOX_LOG],
        },
        degrading: {
          narrativeMd:
            "Tuesday 21:00. The rogue provider was removed at 20:10. Before that the attacker signed in as **14 users**, including the CFO and the claims director, and downloaded about **48,000 workers' compensation claim files** from Box.\n\n" +
            "**Known:** an AWS IAM user named backup-audit exists with an access key. DocuSync Connector has admin consent in Microsoft 365. Box shows a download still running from **198.51.100.37**.\n\n" +
            "**Unknown:** what the AWS key has been used for.",
          artifacts: [BOX_LOG],
        },
        critical: {
          narrativeMd:
            "Tuesday 21:00. Fenmore-SSO-2 is still active. The attacker has signed in as **14 users** and counting, downloaded about **48,000 workers' compensation claim files**, and used AWS SSO to create an IAM user with an access key. At 20:44 the backup-audit key listed S3 buckets that hold policy data backups.\n\n" +
            "**Known:** DocuSync Connector has admin consent in Microsoft 365.\n\n" +
            "**Unknown:** whether backups have been touched.",
          consequenceText: "The attacker is moving into AWS, where policy backups sit.",
          artifacts: [BOX_LOG],
        },
      },
      questions: [
        {
          team: IDENT,
          decisionOwner: "Identity lead",
          stem: "The attacker could sign in as anyone for an hour. Do you revoke sessions for every user tonight?",
          discussionPrompt: "Which of your 180 apps keep their own sessions after Okta sign-out?",
          capabilityKeys: ["RS.MI", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Warn staff, revoke every user's and admin's sessions and tokens at 22:00, then end app sessions per app.",
              quality: ["great", "great", "great"],
              followUp: "Staff were warned, all sessions and tokens were revoked at 22:00, and app sessions are being ended one by one.",
              rationale: "When an attacker could forge sign-ins, every session is suspect. Okta's clear does not end sessions inside apps.",
            },
            {
              id: "b",
              text: "Revoke sessions only for the 14 users seen in the logs, so most staff are not disrupted overnight.",
              quality: ["good", "neutral", "bad"],
              followUp: "Sessions for the 14 users were revoked.",
              rationale: "The 14 are the known cases. With federation abused, unseen sign-ins are possible too.",
            },
            {
              id: "c",
              text: "Wait until Saturday to revoke sessions for everyone, when fewer people are working on claims.",
              quality: ["bad", "bad", "bad"],
              followUp: "Org-wide revocation is planned for Saturday.",
              rationale: "Four days of possibly forged sessions is a long time to leave an attacker in claim files.",
            },
            {
              id: "d",
              text: "Revoke every Okta session tonight and treat that as complete, since all apps sign in through Okta.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "Every Okta session was revoked. App sessions in Box and Salesforce are still live.",
              rationale: "Apps issue their own sessions. Without Universal Logout or per-app action, they survive.",
            },
          ],
        },
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "The attacker reached AWS and Microsoft 365 through SSO. What do you clean up tonight?",
          discussionPrompt: "Would your team know where to look for an IAM user created through SSO?",
          capabilityKeys: ["RS.MI", "RS.AN"],
          options: [
            {
              id: "a",
              text: "Delete the IAM user and key, review CloudTrail, revoke the DocuSync consent, remove the Box collaborator.",
              quality: ["great", "great", "great"],
              followUp: "The IAM user and key are gone, CloudTrail is under review, the consent is revoked and the collaborator removed.",
              rationale: "Each platform keeps what the attacker made after Okta is clean. Consent and IAM keys do not depend on SSO.",
            },
            {
              id: "b",
              text: "Rely on the Okta cleanup, since every app is behind SSO and loses access when Okta sessions end.",
              quality: ["bad", "bad", "bad"],
              followUp: "No per-app cleanup was done.",
              rationale: "An IAM access key and an admin consent grant work without any Okta session.",
            },
            {
              id: "c",
              text: "Delete the IAM user and key now, and leave the Microsoft 365 consent and Box review to the morning.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The IAM user and key are deleted. The consent and the Box collaborator remain.",
              rationale: "AWS is the biggest risk, but admin consent to DocuSync can read all mail tonight.",
            },
            {
              id: "d",
              text: "Close the AWS organization's SSO access for everyone until next week, and check the logs after that.",
              quality: ["neutral", "neutral", "good"],
              followUp: "AWS SSO access is closed for everyone. The IAM key still works.",
              rationale: "Closing SSO stops new sign-ins, which matters if backups are at risk, but the access key is unaffected.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "Chief compliance officer",
          stem: "Claim files were taken. When is a NYDFS reportable incident determined, and what do you do?",
          discussionPrompt: "Who in your company makes the NYDFS determination, and where is the time recorded?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Record the determination now with the basis, start the 72 hour notice, and supplement as scope grows.",
              quality: ["great", "great", "great"],
              followUp: "The determination is recorded with its basis and the notice is being drafted.",
              rationale: "500.17(a) runs from determining an incident occurred. The facts tonight support that determination.",
            },
            {
              id: "b",
              text: "Defer the determination until forensics confirms what data was in the downloaded files.",
              quality: ["bad", "bad", "bad"],
              followUp: "The determination is deferred.",
              rationale: "An admin takeover with bulk downloads is a cybersecurity incident now. Waiting does not stop the clock.",
            },
            {
              id: "c",
              text: "Call the NYDFS supervisor informally tonight and file the formal notice when the facts settle.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "A supervisor heard about it informally.",
              rationale: "Notice is made electronically through the portal. A call does not satisfy 500.17(a).",
            },
            {
              id: "d",
              text: "Record the determination tomorrow at 09:00 once the executive team has met, and file within 72 hours.",
              quality: ["good", "good", "neutral"],
              followUp: "The determination will be recorded at 09:00.",
              rationale: "Filing on time is likely, but recording a later time than the facts support invites questions.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Sessions that did not end",
      scenarioOffsetMin: 880,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o4"],
      clockTriggers: [CLOCKS.states.key],
      expectedActions: [
        { team: SEC, actions: ["Ends Box and Salesforce sessions in each app's admin console", "Rotates secrets found in the CFO's mail"] },
        { team: LEGAL, actions: ["Builds the state notice map for affected claimants", "Files or finalizes the NYDFS notice"] },
        { team: EXEC, actions: ["Approves one message for staff and agents", "Names a spokesperson"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Wednesday 09:00. Overnight revocation worked in Okta, but Box and Salesforce kept sessions issued before 22:00. A Box session for the claims director downloaded 900 more files at 23:40 before Security ended it in the Box console.\n\n" +
            "**Known:** the claim files hold medical reports and Social Security numbers for about **31,000 claimants**, most in New York and New Jersey. The CFO's mail contained AWS and banking portal credentials sent by email.\n\n" +
            "**Unknown:** what else the attacker read in the CFO's mail.",
        },
        degrading: {
          narrativeMd:
            "Wednesday 09:00. Okta sessions were revoked at 01:30. Box and Salesforce sessions survived and were active until 06:00. Agencies are calling because they cannot sign in to the agency portal.\n\n" +
            "**Known:** the claim files hold medical reports and Social Security numbers for about **31,000 claimants**, most in New York and New Jersey. The CFO's mail contained AWS and banking portal credentials.\n\n" +
            "**Unknown:** what else the attacker read in the CFO's mail.",
        },
        critical: {
          narrativeMd:
            "Wednesday 09:00. Only the 14 known users had sessions revoked. Overnight the attacker used a Salesforce session for a VP of agency operations to export the full agency contact list. A local reporter asks about a breach at Fenmore after an agency owner posted about it.\n\n" +
            "**Known:** claim files hold medical reports and Social Security numbers for about **31,000 claimants**.\n\n" +
            "**Unknown:** how many other sessions the attacker still holds.",
          consequenceText: "The attacker is still inside through app sessions and the story is public.",
        },
      },
      questions: [
        {
          team: SEC,
          decisionOwner: "CISO",
          stem: "App sessions survived Okta revocation. What do you do?",
          discussionPrompt: "Which apps support Universal Logout today, and which need manual action?",
          capabilityKeys: ["RS.MI", "PR.AA"],
          options: [
            {
              id: "a",
              text: "End sessions in every high-risk app's own console, rotate the credentials found in mail, and list the gaps.",
              quality: ["great", "great", "great"],
              followUp: "Sessions are ended in each high-risk app, exposed credentials rotated, and the app gaps listed.",
              rationale: "Okta's session clear does not end sessions created inside apps. Each app needs its own action.",
            },
            {
              id: "b",
              text: "Revoke Okta sessions again for everyone, which should catch any app sessions that were missed.",
              quality: ["bad", "bad", "bad"],
              followUp: "Okta sessions were revoked again. App sessions are unaffected.",
              rationale: "Repeating the same action does not reach sessions the apps issued themselves.",
            },
            {
              id: "c",
              text: "End Box and Salesforce sessions now, and leave the other 178 apps to their owners to check this week.",
              quality: ["good", "good", "neutral"],
              followUp: "Box and Salesforce sessions are ended. Other apps are left to their owners.",
              rationale: "The two biggest data stores are right to start with. Admin and finance apps also need checking.",
            },
            {
              id: "d",
              text: "Disable Box and Salesforce for all users for a week while the team audits every session.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Box and Salesforce are off for a week.",
              rationale: "A shutdown stops ongoing theft, which matters if sessions are still active, but halts claims and agency work.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "About 31,000 claimants' medical and Social Security data was taken. What notice work starts today?",
          discussionPrompt: "Which states' laws apply to your claimants, and which cover medical information?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "File the NYDFS notice today, have counsel map state duties for claimants, and prepare notices with an offer.",
              quality: ["great", "great", "great"],
              followUp: "The NYDFS notice is filed and counsel is mapping state duties with claimant notices in preparation.",
              rationale: "The regulator notice is due and claimant notices take time to build. Both start now.",
              clocks: [{ key: CLOCKS.nydfs.key, action: "met" }],
            },
            {
              id: "b",
              text: "Wait to plan claimant notices until the attacker's intentions are clear, since it may not publish.",
              quality: ["bad", "bad", "bad"],
              followUp: "Claimant notice planning waits.",
              rationale: "Notice duty turns on acquisition, not on whether the attacker publishes.",
            },
            {
              id: "c",
              text: "File the NYDFS notice today and leave state law work until the full claimant list is confirmed.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The NYDFS notice is filed. State work waits for the final list.",
              rationale: "The regulator notice is on time, but state clocks run from determination, not from a final list.",
              clocks: [{ key: CLOCKS.nydfs.key, action: "met" }],
            },
            {
              id: "d",
              text: "Send every policyholder a notice today saying their data may be affected, to get ahead of the story.",
              quality: ["neutral", "neutral", "good"],
              followUp: "Every policyholder got a notice saying their data may be affected.",
              rationale: "A broad notice can calm a public story, but it alarms people who were not affected.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "Agencies cannot sign in and some are asking questions. What do staff and agencies hear?",
          discussionPrompt: "Who talks to your 600 agencies, and do they hear before the press?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "One plain message to staff and agencies: what happened, sign-in steps, how to report odd calls, next update.",
              quality: ["great", "great", "great"],
              followUp: "Staff and agencies got one message with what happened, sign-in steps and how to report odd calls.",
              rationale: "Agencies are a target for follow-on calls. One plain message helps them and limits rumor.",
            },
            {
              id: "b",
              text: "Tell agencies the outage is planned maintenance on the identity system, to avoid alarming them.",
              quality: ["bad", "bad", "bad"],
              followUp: "Agencies were told it is planned maintenance.",
              rationale: "A false explanation will come out, and agencies cannot protect themselves from follow-on calls.",
            },
            {
              id: "c",
              text: "Say nothing to agencies until claimant notices are ready, so every message is consistent.",
              quality: ["bad", "neutral", "bad"],
              followUp: "Agencies have not been told anything.",
              rationale: "Consistency matters, but agencies are already locked out and asking.",
            },
            {
              id: "d",
              text: "Message staff today and let each regional manager brief their agencies by phone tomorrow.",
              quality: ["good", "good", "neutral"],
              followUp: "Staff got a message. Regional managers will call agencies tomorrow.",
              rationale: "Phone calls are personal, but a day's delay and many voices risk inconsistent messages.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "Four million dollars",
      scenarioOffsetMin: 2620,
      plannedDelayMin: 10,
      objectiveKeys: ["o5", "o3"],
      expectedActions: [
        {
          team: EXEC,
          actions: [
            "Puts OFAC screening, insurer consent, FBI input and recovery status in front of the board",
            "Records the extortion decision and its basis",
          ],
        },
        { team: LEGAL, actions: ["Runs the OFAC screen through counsel", "Reports to the FBI", "Notes the NYDFS 24 hour report if any payment is made"] },
        { team: IDENT, actions: ["Puts the video and ID verification rule in the service desk script", "Restores admin roles one person at a time with phishing-resistant MFA"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Thursday 14:00. The CEO and the board chair received an extortion email at 12:47 demanding **$4 million** within 72 hours, with a sample of ten claim files. The board meets at 17:00.\n\n" +
            "**Known:** the attacker has been out since Tuesday night. Admins are working from break-glass accounts. The service desk freeze is in place.\n\n" +
            "**Unknown:** whether the attacker would delete the files if paid.",
          artifacts: [EXTORTION],
        },
        degrading: {
          narrativeMd:
            "Thursday 14:00. The CEO and the board chair received an extortion email at 12:47 demanding **$4 million** within 72 hours, with ten claim files as proof. The board meets at 17:00.\n\n" +
            "**Known:** the service desk resumed resets on Wednesday with extra knowledge questions. Two more reset requests for IT staff came in today.\n\n" +
            "**Unknown:** whether those requests were real.",
          artifacts: [EXTORTION],
        },
        critical: {
          narrativeMd:
            "Thursday 14:00. The extortion email demands **$4 million** within 72 hours. Three claimants say a caller claiming to be from Fenmore read their medical details back to them. The board meets at 17:00 and one director wants to pay today.\n\n" +
            "**Known:** the service desk resumed resets on Wednesday with extra knowledge questions.\n\n" +
            "**Unknown:** whether the attacker still has any access.",
          consequenceText: "Claimants are being harassed and the board is under pressure to pay.",
          artifacts: [EXTORTION],
        },
      },
      questions: [
        {
          team: EXEC,
          decisionOwner: "Board chair",
          type: "ransom",
          stem: "What do you recommend to the board at 17:00 on the $4 million demand?",
          discussionPrompt: "What would a payment buy that recovery and notices do not already cover?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Do not pay, after OFAC, insurer and FBI input, notify claimants on schedule, and record the vote and reasons.",
              quality: ["great", "great", "great"],
              followUp: "The board decided not to pay, with OFAC, insurer and FBI input, and recorded its reasons.",
              rationale: "No systems are encrypted, so payment buys only a promise. Notice duties remain either way.",
            },
            {
              id: "b",
              text: "Pay today to stop publication and calls to claimants, and handle OFAC and the insurer afterward.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board approved payment today.",
              rationale: "Sanctions liability is strict and the insurer may deny cover. A NYDFS 24 hour payment report also follows.",
              clocks: [{ key: CLOCKS.nydfsRansom.key, action: "trigger" }],
            },
            {
              id: "c",
              text: "Let the insurer's panel negotiator engage to learn what was taken, with no payment approved.",
              quality: ["good", "good", "good"],
              followUp: "The panel negotiator will engage to learn more. No payment is approved.",
              rationale: "Engaging can size the theft and buy time, but it can also prolong pressure.",
            },
            {
              id: "d",
              text: "Pay a reduced amount after the OFAC screen and insurer consent, to delay publication past the notices.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The board approved a negotiated payment after screening and consent.",
              rationale: "Screening and consent make payment possible, but delay buys little when notices are going out anyway.",
              clocks: [{ key: CLOCKS.nydfsRansom.key, action: "trigger" }],
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "What does the board need from Legal before it decides?",
          discussionPrompt: "Who runs your OFAC screen, and how long does it take?",
          capabilityKeys: ["GV.OC"],
          options: [
            {
              id: "a",
              text: "OFAC screen, insurer consent terms, FBI report, the NYDFS 24 hour payment rule, and notice duties unchanged.",
              quality: ["great", "great", "great"],
              followUp: "The board has the screen, consent terms, FBI report, the payment rule and the notice duties.",
              rationale: "These are the conditions any decision rests on, and a payment brings its own NYDFS report.",
            },
            {
              id: "b",
              text: "Advise that NYDFS rules forbid any extortion payment, so the board has no choice to make.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board was told payment is forbidden.",
              rationale: "500.17(c) requires reporting a payment within 24 hours and explaining it within 30 days. It does not ban it.",
            },
            {
              id: "c",
              text: "Give the board the insurer's terms and leave the OFAC screen until a payment amount is agreed.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The board has the insurer's terms. No OFAC screen has been run.",
              rationale: "A screen after the deal is too late to shape it, and the insurer will require it.",
            },
            {
              id: "d",
              text: "Report to the FBI and run the OFAC screen, and brief the board orally to limit what is written.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The FBI has a report and the screen is done. The board was briefed orally.",
              rationale: "The steps are right, but a NYDFS explanation would need a written basis.",
            },
          ],
        },
        {
          team: IDENT,
          decisionOwner: "Identity lead",
          stem: "The service desk wants to resume normal resets. What must be true first?",
          discussionPrompt: "What would stop a caller who knows the employee ID, manager and home address?",
          capabilityKeys: ["PR.AA", "GV.SC"],
          options: [
            {
              id: "a",
              text: "Video with photo ID and the manager on the call for any MFA reset, tested once, with no executive exceptions.",
              quality: ["great", "great", "great"],
              followUp: "The rule is in the desk script, tested once, with no exceptions for executives.",
              rationale: "Knowledge questions failed. A video check with ID and a manager is a rule this caller could not pass.",
            },
            {
              id: "b",
              text: "Add two more knowledge questions, such as hire date and office location, to the current script.",
              quality: ["bad", "bad", "bad"],
              followUp: "The script has two more knowledge questions.",
              rationale: "Org charts and social profiles give a researcher these answers too.",
            },
            {
              id: "c",
              text: "Require a manager's email approval for each reset, sent to the service desk mailbox.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "Resets need a manager's email.",
              rationale: "Email can be spoofed or sent from a compromised account. A live video check is stronger.",
            },
            {
              id: "d",
              text: "Keep the freeze for admins and IT, and allow normal resets for everyone else with a call-back.",
              quality: ["good", "good", "neutral"],
              followUp: "Admins and IT stay frozen. Others get resets with a call-back.",
              rationale: "A call-back helps, but a stolen phone number defeats it. The rule should cover everyone.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "A sample on the forum",
      scenarioOffsetMin: 9580,
      plannedDelayMin: 10,
      objectiveKeys: ["o4", "o3"],
      expectedActions: [
        { team: LEGAL, actions: ["Sends claimant notices with credit monitoring", "Updates NYDFS on material changes"] },
        { team: IDENT, actions: ["Moves admins to phishing-resistant MFA", "Adds alerts on identity provider creation and admin grants"] },
        { team: EXEC, actions: ["Commissions a post-incident review led outside the response", "Reports fixes with owners to the board"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Tuesday 10:00. Day 8. A 2 GB sample of claim files appeared on a forum last night with an offer of the full set. Claimant notices went out Friday and the call center is busy but coping.\n\n" +
            "**Known:** no attacker activity since Tuesday night. The service desk rule is in force.\n\n" +
            "**Unknown:** whether a buyer will appear.",
          artifacts: [LEAK],
        },
        degrading: {
          narrativeMd:
            "Tuesday 10:00. Day 8. A 2 GB sample of claim files appeared on a forum last night. Claimant notices are still being drafted. Several claimants have called after seeing news coverage.\n\n" +
            "**Known:** no attacker activity since Wednesday. Admins still use Okta Verify push for MFA.\n\n" +
            "**Unknown:** whether a buyer will appear.",
          artifacts: [LEAK],
        },
        critical: {
          narrativeMd:
            "Tuesday 10:00. Day 8. A 2 GB sample of claim files is on a forum. NYDFS has asked for an update after news coverage. Claimants have not been notified. A second reset attempt on an IT engineer was stopped yesterday only because the agent knew him.\n\n" +
            "**Known:** admins still use Okta Verify push for MFA.\n\n" +
            "**Unknown:** whether the attacker is trying again.",
          consequenceText: "The regulator is asking questions and the attack path is still being tried.",
          artifacts: [LEAK],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "Claim files are being offered for sale. What changes in your notices and regulator contact?",
          discussionPrompt: "What does NYDFS expect when material new information comes in?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Send or complete claimant notices with monitoring, and update NYDFS on the sale offer as a material change.",
              quality: ["great", "great", "great"],
              followUp: "Claimant notices are out with monitoring and NYDFS has an update.",
              rationale: "500.17(a) expects updates on material changes. The sale offer raises risk for claimants.",
              clocks: [{ key: CLOCKS.states.key, action: "met" }],
            },
            {
              id: "b",
              text: "Hold claimant notices until it is clear whether a buyer appears, to avoid a second round of letters.",
              quality: ["bad", "bad", "bad"],
              followUp: "Claimant notices are on hold.",
              rationale: "The data was acquired a week ago. A possible sale makes notice more urgent, not less.",
            },
            {
              id: "c",
              text: "Update NYDFS on the sale offer and leave claimant notices on the original schedule.",
              quality: ["good", "neutral", "neutral"],
              followUp: "NYDFS has an update. Claimant notices stay on schedule.",
              rationale: "The regulator update is right. Claimants seeing news need their notice soon.",
            },
            {
              id: "d",
              text: "Post a public notice on the website and treat that as notice to claimants under state law.",
              quality: ["neutral", "bad", "bad"],
              followUp: "A website notice is up.",
              rationale: "Substitute notice is allowed only in limited cases. Claimants with known addresses get direct notice.",
            },
          ],
        },
        {
          team: IDENT,
          decisionOwner: "Identity lead",
          stem: "What do you change in Okta so the same attack fails next time?",
          discussionPrompt: "Could your help desk reset a security key by phone?",
          capabilityKeys: ["PR.AA", "ID.IM"],
          options: [
            {
              id: "a",
              text: "FIDO2 keys or FastPass for admins, re-auth for the admin console, alerts on new providers and admin grants.",
              quality: ["great", "great", "great"],
              followUp: "Phishing-resistant MFA for admins, console re-auth and alerts on providers and grants are scheduled with owners.",
              rationale: "Okta's own guidance after these attacks: phishing-resistant factors and alerts on identity provider creation.",
            },
            {
              id: "b",
              text: "Reduce Super Administrators from four to two, and keep the current MFA and alerting as they are.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Two Super Administrators remain, with the same MFA.",
              rationale: "Fewer admins helps, but either remaining admin can still be reset by phone.",
            },
            {
              id: "c",
              text: "Turn off inbound federation in the tenant and leave MFA as it is, since the provider was the main harm.",
              quality: ["good", "neutral", "neutral"],
              followUp: "Inbound federation is off.",
              rationale: "That closes one technique. The reset that started it still works.",
            },
            {
              id: "d",
              text: "Move all staff from Okta to a different identity provider over the next quarter.",
              quality: ["bad", "bad", "bad"],
              followUp: "A migration to another identity provider is planned.",
              rationale: "The weakness was the reset process and admin MFA, which follow you to any provider.",
            },
          ],
        },
        {
          team: EXEC,
          decisionOwner: "CEO",
          stem: "The board wants a post-incident review. What do you commission?",
          discussionPrompt: "Who outside the response could lead it?",
          capabilityKeys: ["ID.IM", "GV.OV"],
          options: [
            {
              id: "a",
              text: "A review led outside the response, covering each decision, the desk rule, notices, with owners and dates.",
              quality: ["great", "great", "great"],
              followUp: "An independent review is commissioned, reporting to the board with owners and dates.",
              rationale: "A review led by someone outside the response sees what the responders cannot, and the board can track it.",
            },
            {
              id: "b",
              text: "Ask the CISO to write a summary for the board and close the incident once notices are out.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The CISO will write a summary.",
              rationale: "The CISO's view matters, but a self-review misses its own decisions.",
            },
            {
              id: "c",
              text: "Discipline the service desk agent who reset the MFA and treat that as the corrective action.",
              quality: ["bad", "bad", "bad"],
              followUp: "The agent has been disciplined.",
              rationale: "The agent followed the script. Blaming one person leaves the script and admin MFA unchanged.",
            },
            {
              id: "d",
              text: "Hire the IR firm to review the response and report to the audit committee in 60 days.",
              quality: ["good", "good", "good"],
              followUp: "The IR firm will review the response.",
              rationale: "The IR firm knows the facts, but it was part of the response.",
            },
          ],
        },
      ],
    }),
  ],
};

export const GENERAL_CRISISSIM_IDENTITY_TAKEOVER = IDENTITY_TAKEOVER;
