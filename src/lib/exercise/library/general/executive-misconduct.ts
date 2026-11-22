// Crisis Sim: leaked internal messages show a listed company's CEO
// demeaning a subordinate and discussing an undisclosed customer loss. A
// non-cyber people and legal crisis with Regulation FD and Form 8-K Item
// 5.02 decisions. Grounded in Form 8-K General Instruction B.1, Item 5.02,
// 17 CFR 243.101 and 18 U.S.C. 1833(b), as summarized in the threat brief
// addendum. Pairs in part with playbooks/data-breach-notification.md,
// sections 8 and 14 (disclosure and communications); it has no technical
// response. All names are fictional.

import { inject } from "@/lib/exercise/templates/crisissim-seed-data";
import type { LibraryCrisisSimTemplate } from "../types";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const EXECUTIVE_MISCONDUCT_TEMPLATE_ID = "lib-general-crisissim-executive-misconduct";

const ORG = "Quenby Consumer Brands";
const DOMAIN = "quenby.example";
const CEO = "Martin Ashcombe";
const RETAILER = "Hollowell Markets";
const BOARD = "Board";
const LEGAL = "Legal";
const COMMS = "Communications";
const HR = "People";

const CLOCKS = {
  regFd: { key: "reg_fd", label: "Regulation FD public disclosure (17 CFR 243.101(d), 24 hours or next NYSE open)", durationHours: 24 },
  item502: { key: "sec_8k_502", label: "Form 8-K Item 5.02 officer departure (4 business days)", businessDays: 4 },
} as const;

const PROFILE =
  `**${ORG}, Inc.** makes household cleaning and personal care products sold through grocery, drug and mass retailers. It is listed on the NYSE, based in Cincinnati, with about 5,800 staff and $3.1 billion in annual revenue. ` +
  `${CEO} has been CEO for six years. The board has nine directors, eight independent, with a lead independent director. ` +
  `${RETAILER}, its largest customer at about 14 percent of revenue, told the company on October 9 that it will drop two of Quenby's three brands from next spring. That has not been disclosed; the company planned to discuss it on the Q3 earnings call in three weeks. ` +
  "Internal chat is Slack. The company has an ethics hotline and a written anti-retaliation policy.";

const REPORTER = {
  id: "a1",
  kind: "email" as const,
  title: "Reporter asks for comment",
  from: "Reporter, Midwest Business Journal",
  sentAt: "Sunday 19:52",
  content:
    `**From:** Nadia Fenwick <nfenwick@mwbusinessjournal.example>\n**To:** Media relations <media@${DOMAIN}>\n**Subject:** Comment request: messages from ${CEO}\n\n` +
    `We have screenshots of Slack messages from ${CEO} to two executives over the past year. In them he calls a vice president "decorative" and "a diversity hire" and says he will "manage her out after bonus season". Another thread says ${RETAILER} is "gone for spring" and to "keep it quiet until the call". We plan to publish at 06:00 Monday. Does the company dispute that the messages are authentic? Comment by 23:00.`,
};

const SOCIAL = {
  id: "a2",
  kind: "social_post" as const,
  title: "Post with screenshots",
  from: "Anonymous account",
  sentAt: "Sunday 20:05",
  content:
    `Quenby's CEO in his own words. Four screenshots. If this is how he talks about a VP, imagine the rest. #Quenby\n\n[images: Slack messages from ${CEO}]`,
};

const STORY = {
  id: "a1",
  kind: "news" as const,
  title: "Morning story",
  from: "Midwest Business Journal",
  sentAt: "Monday 06:00",
  content:
    `**Quenby CEO's messages disparage executive, hint at lost ${RETAILER} business**\n\nSlack messages reviewed by the Journal show ${CEO} describing a female vice president as "decorative" and planning to "manage her out". A separate thread suggests ${RETAILER}, Quenby's largest customer, will drop brands next year. Quenby said Sunday it was "aware of the messages" and declined further comment.`,
};

const IR_NOTE = {
  id: "a1",
  kind: "document" as const,
  title: "Investor relations call note",
  from: "Head of investor relations",
  sentAt: "Monday 14:20",
  content:
    "Call with portfolio manager, top-10 holder, 13:30 to 13:50. PM asked whether the Hollowell part of the story was true. I said yes, Hollowell is dropping two brands from spring, and that we will cover the impact on the Q3 call. PM thanked me and said they would think about their position.",
};

const CEO_LETTER = {
  id: "a1",
  kind: "email" as const,
  title: "CEO's letter to the lead director",
  from: CEO,
  sentAt: "Wednesday 16:40",
  content:
    `**From:** ${CEO}\n**To:** Lead independent director\n**Subject:** My position\n\n` +
    "I regret the language in those messages. I am prepared to step down as CEO and from the board, effective Friday, on the terms in my employment agreement for a resignation without cause. I would like a joint statement that I am leaving to spend time with family.",
};

const HOTLINE = {
  id: "a1",
  kind: "document" as const,
  title: "Leak review summary",
  from: "Outside counsel to the special committee",
  sentAt: "Monday 08:30",
  content:
    "The screenshots were taken by a senior manager in finance who was in one of the threads. She told us she also reported the messages and the Hollowell disclosure timing to the SEC through its whistleblower program in October, before the leak. She did not deny sending the screenshots to the reporter.",
};

const EXECUTIVE_MISCONDUCT: LibraryCrisisSimTemplate = {
  id: EXECUTIVE_MISCONDUCT_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Leaked CEO messages at a listed consumer company",
  summary:
    "Screenshots of the CEO's Slack messages reach a reporter on a Sunday night: demeaning comments about a vice president and a hint that the largest customer is leaving. Four teams decide who leads, what to disclose under Regulation FD and Form 8-K, how to treat the employees involved, and how the CEO leaves.",
  config: {
    schemaVersion: 1,
    teams: [BOARD, LEGAL, COMMS, HR],
    targetDurationMin: 60,
    scenarioAnchor: { weekday: 0, time: "20:15" },
    orgName: ORG,
    capabilityKeys: ["GV.RR", "GV.OC", "GV.OV", "RS.CO", "RC.CO", "ID.IM"],
    regulatoryClocks: [CLOCKS.regFd, CLOCKS.item502],
    executiveBriefMd: [
      PROFILE,
      "",
      `At 19:52 on Sunday a business reporter emailed media relations with screenshots of Slack messages from ${CEO} and asked for comment by 23:00, ahead of a 06:00 story. At 20:05 an anonymous account posted four of the screenshots. The messages call a vice president "decorative" and say ${RETAILER} is "gone for spring".`,
      "",
      "The Board, Legal, Communications and People teams make decisions over eight days. Two clocks can start: Regulation FD public disclosure after a selective disclosure, and Form 8-K Item 5.02 for an officer departure.",
      "",
      "This is a people and disclosure crisis, not a cyber incident. Use your own crisis plan. The library playbook Data breach notification and disclosure, sections 8 and 14, covers the disclosure decisions; there is no technical response to pair with.",
    ].join("\n"),
  },
  objectives: [
    { key: "o1", text: "Put the response under independent directors within hours, with the CEO recused and outside counsel engaged.", capabilityKeys: ["GV.RR", "GV.OV"] },
    { key: "o2", text: "Make and record a materiality decision on the customer loss, and fix any selective disclosure inside the Reg FD window.", capabilityKeys: ["GV.OC"] },
    { key: "o3", text: "Protect the employees named and the person who reported, with no retaliation and support offered.", capabilityKeys: ["GV.RR", "RC.CO"] },
    { key: "o4", text: "Keep every public statement, filing and staff message consistent with confirmed facts.", capabilityKeys: ["RS.CO", "RC.CO"] },
    { key: "o5", text: "File Item 5.02 on time if the CEO leaves, and describe the departure accurately.", capabilityKeys: ["GV.OC", "RS.CO"] },
  ],
  injects: [
    inject({
      title: "Screenshots on a Sunday night",
      scenarioOffsetMin: 0,
      plannedDelayMin: 10,
      objectiveKeys: ["o1", "o4"],
      expectedActions: [
        { team: BOARD, actions: ["Lead independent director convenes the independent directors tonight", "Recuses the CEO from the response", "Engages counsel that reports to the board"] },
        { team: LEGAL, actions: ["Issues a legal hold on Slack and email", "Checks authenticity of the screenshots without hunting the source"] },
        { team: COMMS, actions: ["Sends a short, factual comment by 23:00", "Tells staff a message is coming in the morning"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Sunday 20:15. The general counsel saw the reporter's email at 19:58 and called the lead independent director. The anonymous post has 2,100 shares. ${CEO} has texted the head of communications: "Tell them it's fake."\n\n` +
            "**Known:** the Slack workspace retains messages for seven years. The threads in the screenshots match real channels.\n\n" +
            "**Unknown:** who took the screenshots, and whether more exist.",
          artifacts: [REPORTER, SOCIAL],
        },
        degrading: {
          narrativeMd:
            `Sunday 20:15. Media relations forwarded the reporter's email to ${CEO} first. He called the general counsel and asked her to find out who leaked it. The lead independent director has not been told. The post has 2,100 shares.\n\n` +
            "**Known:** the threads in the screenshots match real channels.\n\n" +
            "**Unknown:** whether more screenshots exist.",
          artifacts: [REPORTER, SOCIAL],
        },
        critical: {
          narrativeMd:
            `Sunday 20:15. ${CEO} has already replied to the reporter himself: "These are fabricated and we will sue." IT, at his request, has started deleting the two Slack channels. The post has 2,100 shares.\n\n` +
            "**Known:** the threads in the screenshots match real channels.\n\n" +
            "**Unknown:** what the deleted channels held beyond the screenshots.",
          consequenceText: "The CEO is running the response, has made a false public denial, and records are being destroyed.",
          artifacts: [REPORTER, SOCIAL],
        },
      },
      questions: [
        {
          team: BOARD,
          decisionOwner: "Lead independent director",
          stem: "The allegations are about the CEO. Who leads the company's response from tonight?",
          discussionPrompt: "Does your board have a written process for allegations against the CEO, and who holds it?",
          capabilityKeys: ["GV.RR", "GV.OV"],
          options: [
            {
              id: "a",
              text: "The independent directors take charge tonight, recuse the CEO, and hire counsel that reports to the board.",
              quality: ["great", "great", "great"],
              followUp: "The independent directors are in charge, the CEO is recused, and board counsel is engaged.",
              rationale: "When the CEO is the subject, the response must not report to him. Independent counsel protects the board.",
            },
            {
              id: "b",
              text: `Let ${CEO} lead the response since he knows the facts, with the general counsel keeping the board informed.`,
              quality: ["bad", "bad", "bad"],
              followUp: `${CEO} is leading the response.`,
              rationale: "The subject of the allegations cannot run the response to them. Every later decision would be tainted.",
            },
            {
              id: "c",
              text: "Wait for the regular board meeting on Thursday, and ask management for a written briefing beforehand.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board will discuss it on Thursday.",
              rationale: "The story runs at 06:00 Monday. Four days without board direction leaves the CEO in charge.",
            },
            {
              id: "d",
              text: "The lead director takes charge and has the company's regular outside counsel advise the board this week.",
              quality: ["good", "good", "neutral"],
              followUp: "The lead director leads, with the company's regular counsel advising.",
              rationale: "Board leadership is right. Company counsel who work for management may not be seen as independent.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "What does Legal do about the records and the leak tonight?",
          discussionPrompt: "What protections apply to an employee who reports misconduct to a regulator?",
          capabilityKeys: ["GV.OC", "GV.RR"],
          options: [
            {
              id: "a",
              text: "Issue a legal hold on Slack and email, stop any deletion, and verify the messages without hunting the source.",
              quality: ["great", "great", "great"],
              followUp: "A legal hold is in place, deletion is stopped, and authenticity is being checked.",
              rationale: "Records must be preserved for any investigation or suit. A source hunt risks retaliation against a whistleblower.",
            },
            {
              id: "b",
              text: "Have IT find who took the screenshots tonight so the person can be suspended before the story runs.",
              quality: ["bad", "bad", "bad"],
              followUp: "IT is searching for the source.",
              rationale: "Suspending a possible whistleblower before any facts can be unlawful retaliation and becomes its own story.",
            },
            {
              id: "c",
              text: "Send the reporter a letter tonight saying the screenshots are confidential and must not be published.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "A letter went to the reporter.",
              rationale: "A takedown demand to the press rarely works and can read as an admission or an attempt to suppress.",
            },
            {
              id: "d",
              text: "Issue a legal hold on Slack and email, and leave the authenticity review to board counsel this week.",
              quality: ["good", "good", "neutral"],
              followUp: "A legal hold is in place. Authenticity review waits for board counsel.",
              rationale: "The hold is the key step. Knowing tonight whether the messages are real shapes the comment.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "Head of communications",
          stem: "The reporter wants comment by 23:00. What do you send?",
          discussionPrompt: "Who approves a statement about the CEO when the CEO cannot?",
          capabilityKeys: ["RS.CO"],
          options: [
            {
              id: "a",
              text: "Say the board is aware, takes the matter seriously and is reviewing it with outside counsel, and nothing more.",
              quality: ["great", "great", "great"],
              followUp: "The comment says the board is aware and reviewing the matter with outside counsel.",
              rationale: "A short, true comment from the board does not deny what may be real or prejudge the review.",
            },
            {
              id: "b",
              text: "Say the screenshots are fabricated and the company will take legal action against anyone who publishes them.",
              quality: ["bad", "bad", "bad"],
              followUp: "The comment says the screenshots are fabricated.",
              rationale: "The threads match real channels. A false denial becomes the second story.",
            },
            {
              id: "c",
              text: "Send no comment and let the story run, so nothing said tonight can be quoted against the company later.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "No comment was sent.",
              rationale: "Silence is defensible, but the story then reads as if the company has nothing to say.",
            },
            {
              id: "d",
              text: "Say the company is aware, reviewing the messages, and that the CEO regrets any offense caused.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The comment says the CEO regrets any offense.",
              rationale: "Awareness and review are right, but speaking for the CEO before the board has decided ties it to him.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The story runs",
      scenarioOffsetMin: 675,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o3"],
      expectedActions: [
        { team: LEGAL, actions: ["Convenes the disclosure committee on the customer loss", "Records the materiality decision and its basis"] },
        { team: COMMS, actions: ["Issues the board's statement, not one from the CEO", "Tells staff before or with the public statement"] },
        { team: HR, actions: ["Contacts the vice president named to offer support and a point of contact", "Reminds staff of the hotline and anti-retaliation policy"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Monday 07:30. The story ran at 06:00. Pre-market trading shows the stock down 7 percent. The vice president named in the messages, **Elena Varga**, has not come to work. ${CEO} wants to post a personal apology on LinkedIn at 08:00.\n\n` +
            `**Known:** board counsel confirmed the messages are authentic. ${RETAILER} accounts for about 14 percent of revenue; finance estimates the brand loss at 6 to 8 percent of next year's revenue.\n\n` +
            "**Unknown:** whether other employees were treated the same way.",
          artifacts: [STORY],
        },
        degrading: {
          narrativeMd:
            `Monday 07:30. The story ran at 06:00 with the company's "no comment". The stock is down 9 percent pre-market. Employees are posting on an anonymous workplace app. ${CEO} wants to post a personal apology at 08:00.\n\n` +
            `**Known:** the messages are authentic. ${RETAILER} accounts for about 14 percent of revenue; finance estimates the loss at 6 to 8 percent of next year's revenue.\n\n` +
            "**Unknown:** whether others were treated the same way.",
          artifacts: [STORY],
        },
        critical: {
          narrativeMd:
            `Monday 07:30. The story ran at 06:00 with ${CEO}'s denial and threat to sue. The reporter has since published a second screenshot showing he wrote the messages. The stock is down 12 percent pre-market. Two analysts have downgraded, citing the ${RETAILER} line.\n\n` +
            "**Known:** the messages are authentic. Finance estimates the customer loss at 6 to 8 percent of next year's revenue.\n\n" +
            "**Unknown:** what other channels the deleted messages held.",
          consequenceText: "The denial has failed publicly, and the market is reacting to undisclosed customer news.",
          artifacts: [STORY],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "Disclosure committee chair (CFO)",
          type: "materiality",
          stem: `The story hints at the ${RETAILER} loss before the company has disclosed it. Is it material, and what do you do?`,
          discussionPrompt: "What would a reasonable investor think of a 6 to 8 percent revenue loss, revealed by a leak?",
          capabilityKeys: ["GV.OC"],
          options: [
            {
              id: "a",
              text: "Meet this morning, find it material, and disclose the customer change by press release and 8-K before the open.",
              quality: ["great", "great", "great"],
              followUp: "The committee found the change material and disclosed it before the open by press release and 8-K.",
              rationale: "A 6 to 8 percent revenue loss is likely material. Once partly public through a leak, full disclosure ends the selective picture.",
            },
            {
              id: "b",
              text: "Keep the plan to discuss it on the Q3 call in three weeks, since the story only hints at it.",
              quality: ["bad", "bad", "bad"],
              followUp: "Disclosure waits for the earnings call.",
              rationale: "The market is already trading on a partial leak. Three weeks of silence invites selective disclosure and claims.",
            },
            {
              id: "c",
              text: "Meet this morning, record the analysis, and decide by the end of the day after finance confirms the estimate.",
              quality: ["good", "good", "neutral"],
              followUp: "The committee met, recorded its analysis, and will decide by end of day.",
              rationale: "A recorded process is right. A day's wait is defensible, but the leak is moving the stock now.",
            },
            {
              id: "d",
              text: `Have the CEO confirm the ${RETAILER} news in his LinkedIn apology so it is public before the open.`,
              quality: ["bad", "bad", "bad"],
              followUp: `The CEO's post will mention ${RETAILER}.`,
              rationale: "A personal social post by the subject of the scandal is not a considered disclosure, and it mixes two stories.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "Head of communications",
          stem: `${CEO} wants to post a personal apology at 08:00. What do you advise?`,
          discussionPrompt: "Whose voice speaks for the company while the board reviews the CEO's conduct?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "No personal post. A board statement on the review and its steps, with staff told first or at the same time.",
              quality: ["great", "great", "great"],
              followUp: "The CEO did not post. The board's statement went to staff and the public together.",
              rationale: "While the board reviews the CEO, the company speaks through the board. A personal post can undercut the review.",
            },
            {
              id: "b",
              text: "Let him post the apology, since a sincere personal statement is what people want to hear from him.",
              quality: ["bad", "bad", "bad"],
              followUp: "The CEO posted an apology.",
              rationale: "A personal post by the subject before the board acts can prejudge the review and create new legal risk.",
            },
            {
              id: "c",
              text: "Let him post an apology the board and counsel have reviewed, and publish the board statement after it.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The CEO posted a reviewed apology, followed by the board's statement.",
              rationale: "Review reduces risk, but leading with the CEO's voice makes the story about him, not the board's process.",
            },
            {
              id: "d",
              text: "Issue the board statement now and tell staff at 09:00 in a town hall led by the lead director.",
              quality: ["good", "good", "good"],
              followUp: "The board statement is out. Staff hear at a 09:00 town hall.",
              rationale: "The board's voice is right. Staff learning from the news an hour before the town hall is a small cost.",
            },
          ],
        },
        {
          team: HR,
          decisionOwner: "Chief people officer",
          stem: "Elena Varga, the vice president named, has not come to work. What does the People team do?",
          discussionPrompt: "Who should contact her, and who should not?",
          capabilityKeys: ["RC.CO", "GV.RR"],
          options: [
            {
              id: "a",
              text: "A senior HR leader contacts her to offer support, leave if she wants it, and one point of contact.",
              quality: ["great", "great", "great"],
              followUp: "A senior HR leader reached Elena, offered support and leave, and is her single point of contact.",
              rationale: "She is the person most harmed. Support from someone outside her reporting line, with no pressure, is right.",
            },
            {
              id: "b",
              text: `Ask ${CEO} to call her personally to apologize and ask her to say publicly that she accepts it.`,
              quality: ["bad", "bad", "bad"],
              followUp: `${CEO} called Elena.`,
              rationale: "Contact from the subject, with a request for a public statement, is pressure and may be retaliation.",
            },
            {
              id: "c",
              text: "Leave her alone for a few days so she has space, and reach out after the board decides on the CEO.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "HR is giving Elena space.",
              rationale: "Space is kind, but silence from the company can feel like abandonment.",
            },
            {
              id: "d",
              text: "Her manager contacts her to offer support and leave, and HR reminds all staff of the hotline today.",
              quality: ["good", "good", "good"],
              followUp: "Her manager reached out and staff got a hotline reminder.",
              rationale: "Support and a hotline reminder help. Her manager reports to the CEO's team, which may make it harder.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "A call with a top-ten holder",
      scenarioOffsetMin: 1125,
      plannedDelayMin: 10,
      objectiveKeys: ["o2", "o1"],
      clockTriggers: [CLOCKS.regFd.key],
      expectedActions: [
        { team: LEGAL, actions: ["Treats the IR call as a non-intentional selective disclosure", "Makes public disclosure before the next NYSE open", "Stops further investor calls on the topic"] },
        { team: BOARD, actions: ["Decides on the CEO's status with counsel's advice", "Names an interim leader if the CEO steps aside"] },
        { team: COMMS, actions: ["Coordinates the public disclosure with IR and Legal", "Prepares a leadership message for staff"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Monday 15:00. The disclosure committee decided at 09:40 to disclose the ${RETAILER} change; the release is being drafted for 16:30. At 14:20 the head of investor relations sent counsel a note: on a call at 13:30 a portfolio manager at a top-ten holder asked about it and he confirmed it.\n\n` +
            "**Known:** the release has not gone out. Board counsel says the CEO's conduct review will take two weeks.\n\n" +
            "**Unknown:** whether other investors have called IR.",
          artifacts: [IR_NOTE],
        },
        degrading: {
          narrativeMd:
            `Monday 15:00. The disclosure committee has not decided on the ${RETAILER} change. At 14:20 the head of investor relations told counsel that on a 13:30 call he confirmed the customer change to a portfolio manager at a top-ten holder.\n\n` +
            "**Known:** board counsel says the conduct review will take two weeks. Two large holders have asked for the CEO to step aside.\n\n" +
            "**Unknown:** whether other investors heard the same.",
          artifacts: [IR_NOTE],
        },
        critical: {
          narrativeMd:
            `Monday 15:00. Nothing on ${RETAILER} has been disclosed. The head of investor relations has confirmed the change on calls with three holders today. One of them sold a large block at 14:05. ${CEO} is still running the executive team.\n\n` +
            "**Known:** board counsel says the conduct review will take two weeks. Two large holders want the CEO to step aside.\n\n" +
            "**Unknown:** whether trading in the stock has drawn regulator attention.",
          consequenceText: "Selective disclosure is spreading and trading followed it.",
          artifacts: [IR_NOTE],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "IR confirmed material nonpublic information to one investor. What does Regulation FD require now?",
          discussionPrompt: "Who in your company is allowed to talk to investors during a crisis, and what are they told to say?",
          capabilityKeys: ["GV.OC"],
          options: [
            {
              id: "a",
              text: "Public disclosure by press release and 8-K before the next NYSE open, and stop all investor calls on the topic.",
              quality: ["great", "great", "great"],
              followUp: "The disclosure goes out by release and 8-K before the open, and investor calls on the topic are stopped.",
              rationale: "A non-intentional selective disclosure must be made public promptly: the later of 24 hours or the next NYSE open.",
              clocks: [{ key: CLOCKS.regFd.key, action: "met" }],
            },
            {
              id: "b",
              text: "Ask the portfolio manager to keep the information confidential, which removes the need to disclose it.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The portfolio manager was asked to keep it confidential.",
              rationale: "An express confidentiality agreement can be an exception, but asking after the fact is weak and others may know.",
            },
            {
              id: "c",
              text: "Wait until the Q3 call to disclose, since the investor already knew from the press story.",
              quality: ["bad", "bad", "bad"],
              followUp: "Disclosure waits for the Q3 call.",
              rationale: "A hint in a story is not public disclosure. The confirmation gave the investor more than the market had.",
            },
            {
              id: "d",
              text: "Post the information on the investor relations website today and file the 8-K by Wednesday.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The information is on the IR site and the 8-K will follow.",
              rationale: "A website post may count if it is a recognized channel. Waiting until Wednesday runs past the deadline.",
              clocks: [{ key: CLOCKS.regFd.key, action: "met" }],
            },
          ],
        },
        {
          team: BOARD,
          decisionOwner: "Lead independent director",
          stem: "The conduct review takes two weeks and holders want the CEO to step aside. What do you decide today?",
          discussionPrompt: "Who would run the company tomorrow if your CEO stepped aside tonight?",
          capabilityKeys: ["GV.RR", "GV.OV"],
          options: [
            {
              id: "a",
              text: "Place the CEO on leave during the review, name an interim CEO, and record the reasons and terms.",
              quality: ["great", "great", "great"],
              followUp: "The CEO is on leave, an interim CEO is named, and the reasons are recorded.",
              rationale: "Leave protects the review and the company without a finding. A named interim leader keeps the business steady.",
            },
            {
              id: "b",
              text: "Keep the CEO in his role until the review ends, to avoid any suggestion that the board has prejudged it.",
              quality: ["bad", "bad", "bad"],
              followUp: "The CEO stays in his role during the review.",
              rationale: "Avoiding prejudgment matters, but the subject running the company and its staff during the review undermines it.",
            },
            {
              id: "c",
              text: "Terminate the CEO for cause today, based on the messages, without waiting for the review.",
              quality: ["bad", "bad", "neutral"],
              followUp: "The CEO was terminated for cause.",
              rationale: "A for-cause finding before the review risks a contract dispute. Defensible only if he destroyed evidence.",
            },
            {
              id: "d",
              text: "Remove the CEO from investor and media contact, and keep him running operations during the review.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The CEO no longer speaks to investors or media but runs operations.",
              rationale: "Limiting his role helps, but staff still report to him while he is being reviewed.",
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "Head of communications",
          stem: "The customer disclosure and possibly a leadership change go out tonight. How do you sequence them?",
          discussionPrompt: "What do employees hear, and in what order with investors and press?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "One release with both items after counsel signs off, a staff note at the same time, and IR scripts to match.",
              quality: ["great", "great", "good"],
              followUp: "One release, a simultaneous staff note and matching IR scripts are ready.",
              rationale: "One coordinated release reaches everyone at once and leaves no gap for selective disclosure.",
            },
            {
              id: "b",
              text: "Tell the largest holders first by phone tonight, then issue the release in the morning.",
              quality: ["bad", "bad", "bad"],
              followUp: "IR will call the largest holders tonight.",
              rationale: "Calling holders first repeats the selective disclosure the release is meant to fix.",
            },
            {
              id: "c",
              text: "Issue the customer disclosure tonight, and the leadership news separately on Tuesday at noon.",
              quality: ["good", "good", "great"],
              followUp: "The customer disclosure goes tonight. Leadership news follows Tuesday.",
              rationale: "Separating the items keeps the financial disclosure clean, which helps most when trading is already reacting.",
            },
            {
              id: "d",
              text: "Post both items on social media first so the company controls the story before any outlet does.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Both items will be posted on social media.",
              rationale: "Social channels can count for Reg FD only if investors know to look there. A release is safer.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "An offer to resign",
      scenarioOffsetMin: 4185,
      plannedDelayMin: 10,
      objectiveKeys: ["o5", "o4"],
      clockTriggers: [CLOCKS.item502.key],
      expectedActions: [
        { team: BOARD, actions: ["Accepts or rejects the resignation on counsel's advice", "Refuses a false reason for the departure", "Considers clawback and severance terms"] },
        { team: LEGAL, actions: ["Files Item 5.02(b) within four business days", "Describes the departure without characterizing beyond the facts"] },
        { team: COMMS, actions: ["Announces the departure and the interim CEO together", "Tells staff at the same time"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            `Wednesday 18:00. ${CEO} has offered to resign effective Friday, as a resignation without cause under his agreement, and asked for a statement that he is leaving "to spend time with family". The review has found two more employees he treated the same way.\n\n` +
            "**Known:** the interim CEO is the COO, named Monday. His agreement has a clawback clause for misconduct.\n\n" +
            "**Unknown:** whether he will contest a for-cause finding.",
          artifacts: [CEO_LETTER],
        },
        degrading: {
          narrativeMd:
            `Wednesday 18:00. ${CEO}, still in his role, has offered to resign effective Friday without cause and asked for a statement that he is leaving "to spend time with family". The review has found two more employees he treated the same way.\n\n` +
            "**Known:** no interim CEO has been named. His agreement has a clawback clause for misconduct.\n\n" +
            "**Unknown:** whether he will contest a for-cause finding.",
          artifacts: [CEO_LETTER],
        },
        critical: {
          narrativeMd:
            `Wednesday 18:00. ${CEO} has offered to resign effective Friday without cause, asked for a "family reasons" statement, and said he will sue if the board refuses. A second outlet has two more employees' accounts. The stock is down 19 percent since Friday.\n\n` +
            "**Known:** no interim CEO has been named. His agreement has a clawback clause for misconduct.\n\n" +
            "**Unknown:** what the second outlet will publish next.",
          consequenceText: "Leadership is unsettled and the story is growing.",
          artifacts: [CEO_LETTER],
        },
      },
      questions: [
        {
          team: BOARD,
          decisionOwner: "Lead independent director",
          stem: "The CEO offers to resign without cause and wants a family reasons statement. What does the board do?",
          discussionPrompt: "What does your CEO's agreement say about cause, severance and clawback?",
          capabilityKeys: ["GV.RR", "GV.OV"],
          options: [
            {
              id: "a",
              text: "Accept his departure, reserve the cause and clawback question for the review, and refuse a false reason.",
              quality: ["great", "great", "great"],
              followUp: "The board accepted his departure, reserved cause and clawback, and refused a family reasons statement.",
              rationale: "Ending his tenure fast helps the company. Reserving cause keeps remedies, and a false reason misleads investors.",
            },
            {
              id: "b",
              text: "Accept his terms and the family reasons statement, so he leaves quietly and the story ends sooner.",
              quality: ["bad", "bad", "bad"],
              followUp: "The board accepted his terms and the statement.",
              rationale: "A false public reason for a departure misleads investors and staff, and the truth is already reported.",
            },
            {
              id: "c",
              text: "Reject the resignation and finish the review first, then decide on termination for cause in two weeks.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "The board rejected the resignation pending the review.",
              rationale: "Finishing the review is careful, but two more weeks with him in place deepens the crisis.",
            },
            {
              id: "d",
              text: "Accept his departure without cause and his severance, and say only that he has stepped down.",
              quality: ["good", "neutral", "neutral"],
              followUp: "The board accepted his departure without cause and his severance.",
              rationale: "A plain statement is honest. Conceding no cause gives up clawback the agreement allows.",
            },
          ],
        },
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "His departure takes effect Friday. What do you file, and what does it say?",
          discussionPrompt: "What would make an 8-K about an executive departure misleading?",
          capabilityKeys: ["GV.OC", "RS.CO"],
          options: [
            {
              id: "a",
              text: "Item 5.02(b) within four business days with the fact and date, plus the interim CEO under 5.02(c).",
              quality: ["great", "great", "great"],
              followUp: "The 8-K reports his departure and date under 5.02(b) and the interim CEO under 5.02(c).",
              rationale: "Item 5.02(b) needs the fact and date of departure; 5.02(c) covers the new officer. Accuracy over spin.",
              clocks: [{ key: CLOCKS.item502.key, action: "met" }],
            },
            {
              id: "b",
              text: "No 8-K, since he resigned voluntarily and a resignation is not one of the events Form 8-K covers.",
              quality: ["bad", "bad", "bad"],
              followUp: "No 8-K is planned.",
              rationale: "Item 5.02(b) covers a principal executive officer who resigns, retires or is terminated.",
            },
            {
              id: "c",
              text: "File the 8-K with his family reasons statement, since it is his stated reason for resigning.",
              quality: ["bad", "bad", "bad"],
              followUp: "The 8-K uses the family reasons statement.",
              rationale: "A filing that repeats a reason the board knows is not the real one can mislead investors.",
            },
            {
              id: "d",
              text: "File Item 5.02(b) on time with the fact and date, and announce the interim CEO in a separate release.",
              quality: ["good", "good", "good"],
              followUp: "The 8-K reports the departure. The interim CEO is in a release.",
              rationale: "The departure filing is right. The new officer appointment also belongs in the 8-K.",
              clocks: [{ key: CLOCKS.item502.key, action: "met" }],
            },
          ],
        },
        {
          team: COMMS,
          decisionOwner: "Head of communications",
          stem: "How do you announce the CEO's departure?",
          discussionPrompt: "What should staff hear about the review and what happens next?",
          capabilityKeys: ["RS.CO", "RC.CO"],
          options: [
            {
              id: "a",
              text: "One release and staff note: he has left, the interim CEO, the review continues, and support for staff.",
              quality: ["great", "great", "great"],
              followUp: "The release and staff note go out together with the departure, the interim CEO and the review.",
              rationale: "Plain, simultaneous news with what happens next is what staff, investors and the press need.",
            },
            {
              id: "b",
              text: "A release thanking him for six years of leadership and wishing him well, with no mention of the review.",
              quality: ["bad", "bad", "bad"],
              followUp: "The release thanks him for his leadership.",
              rationale: "Praise without context reads as indifference to the employees he harmed.",
            },
            {
              id: "c",
              text: "A detailed statement listing the findings so far, to show the board acted on evidence.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "The statement lists the findings so far.",
              rationale: "Showing action matters, but publishing findings before the review ends invites legal risk.",
            },
            {
              id: "d",
              text: "A short release on the departure and interim CEO, and a town hall for staff on Thursday.",
              quality: ["good", "good", "good"],
              followUp: "A short release went out and a town hall is set.",
              rationale: "A short release and a town hall are sound. Staff should not hear about the departure from the news first.",
            },
          ],
        },
      ],
    }),
    inject({
      title: "The person who took the screenshots",
      scenarioOffsetMin: 10845,
      plannedDelayMin: 10,
      objectiveKeys: ["o3", "o1"],
      expectedActions: [
        { team: LEGAL, actions: ["Takes no adverse action against the reporter", "Checks agreements for the whistleblower immunity notice"] },
        { team: HR, actions: ["Commissions a culture review led outside the executive team", "Gives the reporter a contact outside her chain"] },
        { team: BOARD, actions: ["Commissions a governance review with owners and dates", "Reviews how the board learned of the messages"] },
      ],
      variants: {
        optimal: {
          narrativeMd:
            "Monday 09:00. Board counsel reports that a senior manager in finance took the screenshots. She says she had already reported the messages and the disclosure timing to the SEC's whistleblower program in October. The interim CEO has asked what to do about her.\n\n" +
            "**Known:** the conduct review is finishing. Staff are asking whether anything will change.\n\n" +
            "**Unknown:** whether the SEC will open an inquiry.",
          artifacts: [HOTLINE],
        },
        degrading: {
          narrativeMd:
            "Monday 09:00. Board counsel reports that a senior manager in finance took the screenshots, and that she says she reported the messages and disclosure timing to the SEC in October. Her manager has moved her off a major project.\n\n" +
            "**Known:** the conduct review is finishing.\n\n" +
            "**Unknown:** whether the SEC will open an inquiry.",
          artifacts: [HOTLINE],
        },
        critical: {
          narrativeMd:
            "Monday 09:00. On Friday IT identified a senior manager in finance as the source and her manager suspended her. She has told counsel she reported the messages to the SEC in October. Her lawyer has written to the board.\n\n" +
            "**Known:** the conduct review is finishing.\n\n" +
            "**Unknown:** whether she will file a retaliation complaint.",
          consequenceText: "A likely whistleblower has been suspended, which is now a legal problem of its own.",
          artifacts: [HOTLINE],
        },
      },
      questions: [
        {
          team: LEGAL,
          decisionOwner: "General counsel",
          stem: "The source says she reported to the SEC before the leak. What does the company do about her?",
          discussionPrompt: "What does your anti-retaliation policy say, and who enforces it on a manager?",
          capabilityKeys: ["GV.RR", "GV.OC"],
          options: [
            {
              id: "a",
              text: "Take no adverse action, reverse any already taken, and tell managers that retaliation is not allowed.",
              quality: ["great", "great", "great"],
              followUp: "No action will be taken, any step already taken is reversed, and managers have been told.",
              rationale: "Reports to the SEC are protected, and retaliation creates new liability on top of the original conduct.",
            },
            {
              id: "b",
              text: "Terminate her for breaching confidentiality by sending internal messages to a reporter.",
              quality: ["bad", "bad", "bad"],
              followUp: "She was terminated.",
              rationale: "Firing someone who reported to the SEC invites a retaliation claim the company is likely to lose.",
            },
            {
              id: "c",
              text: "Keep her in role but issue a written warning for sharing confidential messages outside the company.",
              quality: ["neutral", "neutral", "bad"],
              followUp: "She received a written warning.",
              rationale: "A warning may still be seen as adverse action against a protected report.",
            },
            {
              id: "d",
              text: "Take no action now and decide after the SEC says whether it will open an inquiry.",
              quality: ["good", "neutral", "bad"],
              followUp: "No decision has been made on her.",
              rationale: "Not acting is right, but leaving it open signals that action may come later.",
            },
          ],
        },
        {
          team: HR,
          decisionOwner: "Chief people officer",
          stem: "Staff are asking whether anything will change. What do you start?",
          discussionPrompt: "Would your staff trust your hotline after this?",
          capabilityKeys: ["ID.IM", "RC.CO"],
          options: [
            {
              id: "a",
              text: "A culture review led outside the executive team, results to the board, and a hotline that staff can trust.",
              quality: ["great", "great", "great"],
              followUp: "An outside culture review is commissioned, reporting to the board, with hotline changes.",
              rationale: "Two more employees were affected. A review outside the executive team can find what the chain missed.",
            },
            {
              id: "b",
              text: "Send a values reminder to all staff and run mandatory respect training for managers this quarter.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "Staff got a values reminder and managers will take training.",
              rationale: "Training helps, but it does not test whether reports reach the board.",
            },
            {
              id: "c",
              text: "Treat the matter as closed now the CEO has gone, to let staff move on.",
              quality: ["bad", "bad", "bad"],
              followUp: "The matter is treated as closed.",
              rationale: "The conduct went on for a year without reaching the board. Closing it leaves that gap.",
            },
            {
              id: "d",
              text: "Hold listening sessions led by the interim CEO, then decide whether a wider review is needed.",
              quality: ["good", "good", "neutral"],
              followUp: "The interim CEO will hold listening sessions.",
              rationale: "Listening is useful. Staff may not speak freely to an executive who worked beside the former CEO.",
            },
          ],
        },
        {
          team: BOARD,
          decisionOwner: "Lead independent director",
          stem: "What should the board review about its own oversight?",
          discussionPrompt: "How would your board have learned about these messages without a leak?",
          capabilityKeys: ["GV.OV", "ID.IM"],
          options: [
            {
              id: "a",
              text: "How reports reach the board, disclosure controls, the Reg FD lapse, with owners and dates.",
              quality: ["great", "great", "great"],
              followUp: "A governance review covers reporting lines, disclosure controls and the Reg FD lapse.",
              rationale: "The board learned from a reporter, and IR confirmed news privately. Both point at controls the board oversees.",
            },
            {
              id: "b",
              text: "No review is needed, since the board acted quickly once the story broke.",
              quality: ["bad", "bad", "bad"],
              followUp: "No governance review is planned.",
              rationale: "Acting fast after a leak does not explain why the board did not know before it.",
            },
            {
              id: "c",
              text: "Hire a search firm for a permanent CEO and fold governance questions into the new CEO's first plan.",
              quality: ["neutral", "neutral", "neutral"],
              followUp: "A CEO search has started.",
              rationale: "A search is needed, but the board's oversight gaps are the board's to review.",
            },
            {
              id: "d",
              text: "Review the IR process and Reg FD training, and leave reporting lines to the culture review.",
              quality: ["good", "good", "good"],
              followUp: "IR process and Reg FD training are under review.",
              rationale: "The IR lapse needs fixing. How misconduct reports reach the board is also a board question.",
            },
          ],
        },
      ],
    }),
  ],
};

export const GENERAL_CRISISSIM_EXECUTIVE_MISCONDUCT = EXECUTIVE_MISCONDUCT;
