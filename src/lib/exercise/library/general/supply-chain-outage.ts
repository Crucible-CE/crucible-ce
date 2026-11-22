// Strategic TTX: a fire at a sole-source supplier's plant stops control
// boards for most of an appliance maker's range. Non-cyber, operational.
// Follows the ISO 22301:2019 clause 8 structure (BIA, strategies, plans,
// exercise programme) as summarized in the threat brief addendum. Matches
// playbooks/business-continuity-site-loss.md (B-A to B-D). The path
// branches on whether allocation holds with customers. All names are
// fictional.

import type { LibraryStrategicTemplate } from "../types";
import { active, kua, standby } from "../healthcare/strategic-shared";
import { GENERAL_COLLECTION_LABEL } from "./label";

export const SUPPLY_CHAIN_TEMPLATE_ID = "lib-general-strategic-supply-chain-outage";

const ORG = "Vardell Appliance Group";
const DOMAIN = "vardell.example";
const SUPPLIER = "Halvard Controls";
const ALT = "Sorell Electronics";
const RETAILER = "Corbel Home Centers";

const EXEC = "Executive";
const OPS = "Operations";
const SUPPLY = "Supply Chain";
const SALES = "Sales and Customers";
const FINLEG = "Finance and Legal";
const PEOPLE = "Communications and People";
const TEAMS = [EXEC, OPS, SUPPLY, SALES, FINLEG, PEOPLE];

const CLOCKS = {
  customer: { key: "customer_notice", label: "Customer delay and force majeure notice (contract: 5 business days)", businessDays: 5 },
  insurer: { key: "insurer_notice", label: "Contingent business interruption notice (policy: 30 days)", durationHours: 30 * 24 },
} as const;

const PROFILE =
  `**${ORG}, LLC** makes dishwashers, ranges and cooktops at two plants in Tennessee and Ohio, with about 3,400 staff and $1.6 billion in annual revenue. It is owned by a private equity fund and has a revolving credit facility. ` +
  `About 70 percent of its models use one main electronic control board, made only by ${SUPPLIER} at a plant in Guadalajara, Mexico. ${SUPPLIER} has a second plant in Penang, Malaysia, not qualified for Vardell's boards. ` +
  `Sales go through home improvement retailers, led by ${RETAILER} at about 31 percent of revenue, and through homebuilders and distributors. Retail contracts require written notice of supply delays within 5 business days and allow on-time, in-full chargebacks. ` +
  "The business impact analysis sets an MTPD of 6 weeks for dishwashers and ranges. Vardell holds property, business interruption and contingent business interruption cover.";

export const GENERAL_STRATEGIC_SUPPLY_CHAIN: LibraryStrategicTemplate = {
  id: SUPPLY_CHAIN_TEMPLATE_ID,
  collection: GENERAL_COLLECTION_LABEL,
  title: "Supplier plant fire stops an appliance maker",
  summary:
    "A fire at a sole-source supplier's plant stops the control board used in 70 percent of an appliance maker's models, with nine days of stock on hand. Six teams decide on invoking continuity plans, allocating short supply to retailers and builders, qualifying a second source, and staffing reduced lines. The path branches on whether allocation holds with customers.",
  branching: "branched",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "Supplier plant fire stops an appliance maker",
      domain: "operational",
      crisisType: "Major Supply Chain Disruption",
      industryKey: "manufacturing",
      orgProfileMd: PROFILE,
      complexity: "intermediate",
      stakeholders: ["Retail customers", "Homebuilders", "Employees", "Supplier", "Lenders and owner", "Insurers", "Trade press"],
    },
    winCondition: "none",
    teams: TEAMS,
    scenarioAnchor: { weekday: 3, time: "05:40" },
    targetDurationMin: 140,
    regulatoryClocks: [CLOCKS.customer, CLOCKS.insurer],
    executiveBriefMd: [
      PROFILE,
      "",
      `Overnight a fire broke out at ${SUPPLIER}'s Guadalajara plant. No one was hurt. You play Vardell's leadership and response teams: Executive, Operations, Supply Chain, Sales and Customers, Finance and Legal, and Communications and People.`,
      "",
      "Decide, name who owns each decision, and say what you do not know yet. Two clocks can start: customer delay notices under retail contracts (5 business days) and contingent business interruption notice to the insurer.",
      "",
      "This is a non-cyber operational crisis. The library playbook is Business continuity and disaster recovery: site or region loss.",
    ].join("\n"),
  },
  objectives: [
    { key: "invoke", text: "Invoke the continuity plan and convene the crisis team within the first day, with the BIA driving decisions.", capabilityKeys: ["RS.MA", "GV.RR"] },
    { key: "allocate", text: "Set a written allocation rule, approved by the executive sponsor and checked against contracts.", capabilityKeys: ["GV.RR", "RC.CO"] },
    { key: "source", text: "Start qualification of a second source within 48 hours, in parallel with the supplier's recovery.", capabilityKeys: ["GV.SC", "RC.RP"] },
    { key: "notify", text: "Send customer delay notices and insurer notice inside their windows, with facts and next update dates.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "people", text: "Keep employees informed about schedules and pay with one consistent message.", capabilityKeys: ["RC.CO"] },
    { key: "improve", text: "Decide on dual sourcing and update the BIA with owners and dates.", capabilityKeys: ["ID.IM", "GV.SC"] },
  ],
  injects: [
    {
      nodeId: "v1",
      title: "Fire in Guadalajara",
      scenarioOffsetMin: 0,
      plannedDelayMin: 20,
      objectiveKeys: ["invoke"],
      phase: "opening",
      narrativeMd: [
        `Wednesday 05:40. ${SUPPLIER}'s account manager called Vardell's buyer at 05:10: a fire started in the surface mount line at 01:30 and spread to the finished goods store. Local fire services have the site. Everyone is accounted for.`,
        "",
        kua(
          [
            "Vardell has 9 days of boards in its plants and 6 days more in transit at a border crossing.",
            "Boards from this plant go into about 70 percent of Vardell's models.",
            `${SUPPLIER}'s Penang plant makes similar boards but has never built Vardell's design.`,
          ],
          ["How long the plant will be down.", "Whether finished boards in the store survived."],
          ["Other appliance makers that use the plant will compete for any alternate capacity."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "v1-call",
          kind: "voicemail",
          title: "Supplier account manager",
          from: SUPPLIER,
          sentAt: "Wednesday 05:10",
          content: `This is Tomas at ${SUPPLIER}. There was a fire at Guadalajara overnight. Nobody hurt, thank God. The SMT hall and the warehouse are affected. We will know more after the fire service lets us in. I will call again at noon. Please do not share this outside your team yet.`,
        },
      ],
      teamVariants: [
        active(SUPPLY, "You know the board inventory by plant and the in-transit loads.", [
          "What do you secure in the next four hours: inventory, in-transit loads, alternate capacity?",
          "Who do you call at the supplier and at other suppliers today?",
        ]),
        active(OPS, "Both plants start first shift at 06:00.", [
          "Do you change the production plan today, and on what basis?",
          "What is the safety stock rule for boards from now on?",
        ]),
        active(EXEC, "The COO calls the CEO at 05:45.", ["Do you invoke the continuity plan and convene the crisis team? Who leads?"]),
        standby(SALES, "Customers do not know yet."),
        standby(FINLEG, "Finance and Legal have not been called."),
        standby(PEOPLE, "Nothing is public."),
      ],
      expectedActions: {
        [SUPPLY]: [
          "Puts a hold on all boards in stock and in transit for critical models",
          "Calls the supplier's leadership and asks for daily written updates",
          "Asks other suppliers for capacity and lead times the same day",
        ],
        [OPS]: ["Runs models that do not use the board first", "Sets a board consumption plan tied to the BIA"],
        [EXEC]: ["Invokes the plan and convenes the crisis team with a named lead", "Sets a cadence and asks for the BIA impact by evening"],
      },
      capabilityKeys: ["RS.MA", "GV.SC"],
      gradingNotes: "ISO 22301 clause 8.4.2 expects a response structure that activates on a defined trigger. Effective answers invoke early, because alternate capacity goes to whoever asks first.",
    },
    {
      nodeId: "v2",
      title: "Ten weeks at least",
      scenarioOffsetMin: 480,
      plannedDelayMin: 25,
      objectiveKeys: ["allocate", "source", "notify"],
      phase: "main",
      narrativeMd: [
        `Wednesday 13:40. ${SUPPLIER} confirms the surface mount hall is destroyed. Its estimate for restart is **at least 10 weeks**. Penang could supply about 30 percent of Vardell's volume after a 4 to 6 week qualification, and ${SUPPLIER} says it will allocate Penang capacity across customers \"fairly\".`,
        "",
        kua(
          [
            `${ALT} can build a compatible board in 8 to 10 weeks, but it needs a firmware port and safety recertification of the appliances that use it.`,
            "At current output, board stock runs out in 15 days including the in-transit loads.",
            `${RETAILER} has a holiday promotion on Vardell dishwashers starting in 5 weeks.`,
          ],
          [`How ${SUPPLIER} will divide Penang capacity.`, "Whether the fire is covered as force majeure under the supply agreement."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "v2-letter",
          kind: "document",
          title: "Supplier force majeure notice",
          from: SUPPLIER,
          sentAt: "Wednesday 13:15",
          content: `${SUPPLIER} hereby gives notice of a force majeure event under section 14 of the supply agreement. A fire at our Guadalajara facility on this date prevents production of the products covered by the agreement. We expect the event to continue for at least ten weeks. We will allocate available capacity from other facilities among affected customers and will provide weekly updates.`,
        },
      ],
      teamVariants: [
        active(SALES, "Customers will hear from the trade press soon if not from you.", [
          "What allocation rule do you propose, and how do you tell each customer?",
          `What do you say to ${RETAILER} about the holiday promotion?`,
        ]),
        active(SUPPLY, "Alternate capacity is limited and others want it.", [
          `Do you start qualifying Penang and ${ALT} now, and what do you commit to each?`,
        ]),
        active(FINLEG, "The supplier has claimed force majeure.", [
          "How do you respond to the force majeure notice, and what notices do you send customers and insurers?",
          "What does the 15 day stock runway mean for revenue and covenants?",
        ]),
        active(EXEC, "The crisis team meets at 15:00.", ["Who approves the allocation rule, and what principles must it follow?"]),
        standby(OPS, "Operations is running non-board models first."),
        standby(PEOPLE, "Plant staff are asking why the schedule changed."),
      ],
      expectedActions: {
        [SALES]: [
          "Proposes a written rule: safety and service obligations, then contract commitments, then strategic customers, by percentage",
          "Calls each key account the same day with the same facts",
          `Offers ${RETAILER} a revised promotion plan rather than a promise`,
        ],
        [SUPPLY]: [
          "Starts Penang qualification and a parallel second source program",
          "Asks the supplier in writing for its allocation method",
        ],
        [FINLEG]: [
          "Replies to the force majeure notice reserving rights",
          "Sends customer delay notices and insurer notice with known facts",
          "Models revenue by week and checks covenant headroom",
        ],
        [EXEC]: ["Approves the allocation rule and records exceptions", "Funds the second source program"],
      },
      capabilityKeys: ["GV.RR", "GV.SC", "RS.CO"],
      gradingNotes: "Allocation on a written rule is the key decision. Teams that let each account manager promise supply create the conditions for the branch where allocation breaks down.",
      clockUpdates: [
        { key: CLOCKS.customer.key, action: "trigger" },
        { key: CLOCKS.insurer.key, action: "trigger" },
      ],
    },
    {
      nodeId: "v3a",
      title: "Allocation holds",
      scenarioOffsetMin: 3080,
      plannedDelayMin: 20,
      objectiveKeys: ["allocate", "people"],
      phase: "main",
      narrativeMd: [
        `Friday 09:00. Every key account has the allocation rule in writing: 60 percent of confirmed orders for 6 weeks, with service parts first. ${RETAILER} accepted it and asked to move its promotion to ranges, which use less of the board.`,
        "",
        kua(
          [
            "Delay notices went to customers on Thursday. The insurer has notice.",
            "The Tennessee plant will run four day weeks on two dishwasher lines from Monday.",
          ],
          ["How long four day weeks will last.", "Whether the union local at the Ohio plant will accept schedule changes."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(PEOPLE, "Staff on the affected lines are worried about pay.", [
          "What do you tell staff about schedules and pay, and who says it?",
          "How do you handle questions from the press about layoffs?",
        ]),
        active(OPS, "Some lines can make ranges instead of dishwashers.", ["How do you use idle capacity without burning boards meant for allocation?"]),
        active(SALES, `${RETAILER} wants the range promotion confirmed.`, ["What do you confirm, and what do you hold back?"]),
        standby(EXEC, "The crisis team meets daily."),
        standby(SUPPLY, "Penang samples ship Monday."),
        standby(FINLEG, "Finance is updating the forecast."),
      ],
      expectedActions: {
        [PEOPLE]: [
          "Tells affected staff the schedule, pay and how long it may last before the press does",
          "Gives one statement to press: supplier fire, reduced schedules, no layoffs announced",
        ],
        [OPS]: ["Moves idle crews to range lines and maintenance", "Protects allocated board stock from local use"],
        [SALES]: ["Confirms the range promotion with volumes tied to the allocation", "Puts every commitment in writing"],
      },
      capabilityKeys: ["RC.CO", "GV.RR"],
    },
    {
      nodeId: "v3b",
      title: "Allocation breaks down",
      scenarioOffsetMin: 3080,
      plannedDelayMin: 20,
      objectiveKeys: ["allocate", "notify"],
      phase: "main",
      narrativeMd: [
        `Friday 09:00. A trade publication reported the fire on Thursday afternoon, with a line that Vardell \"faces shortages\". ${RETAILER}'s merchandising head learned of it from the story. Two Vardell account managers have promised full supply to their builders; a third told a distributor shipments were \"unaffected\".`,
        "",
        kua(
          [
            `${RETAILER} says it will apply on-time, in-full chargebacks from next week and may give the holiday floor space to a competitor.`,
            "Delay notices have gone to some customers, not all.",
          ],
          ["How much board stock is already promised beyond the allocation.", `Whether ${RETAILER} will follow through.`],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "v3b-email",
          kind: "email",
          title: "Retailer merchandising head",
          from: RETAILER,
          sentAt: "Friday 07:45",
          content:
            `**From:** VP Merchandising, ${RETAILER}\n**To:** Chief commercial officer <cco@${DOMAIN}>\n**Subject:** Supply\n\n` +
            "I read about your supplier fire in the trade press. Not from you. Two of your competitors called us yesterday with capacity. Unless I have a written supply plan by Monday I will move the holiday dishwasher bay and apply OTIF chargebacks from week 43.",
        },
      ],
      teamVariants: [
        active(EXEC, `${RETAILER} is 31 percent of revenue.`, [
          "Who calls the retailer's leadership today, and what do they offer?",
          "What do you do about the promises account managers made?",
        ]),
        active(SALES, "Account managers have made conflicting promises.", [
          "How do you reset every customer to one allocation rule without losing trust?",
        ]),
        active(FINLEG, "Chargebacks and contract terms are now in play.", [
          "What do the contracts say about notice, chargebacks and force majeure, and which notices are late?",
        ]),
        standby(OPS, "Operations is running non-board models first."),
        standby(SUPPLY, "Penang samples ship Monday."),
        standby(PEOPLE, "Staff have read the trade story."),
      ],
      expectedActions: {
        [EXEC]: [
          "Has the CEO call the retailer's leadership with a written plan by Monday",
          "Withdraws unauthorized promises and records the allocation rule",
        ],
        [SALES]: ["Sends every customer the same allocation rule in writing", "Names one owner per key account"],
        [FINLEG]: [
          "Sends any late delay notices at once and checks the effect of lateness",
          "Reviews chargeback terms and force majeure coverage in each contract",
        ],
      },
      capabilityKeys: ["RS.CO", "GV.RR", "GV.OC"],
      gradingNotes: "This branch follows weak allocation and late customer contact. Effective answers reset every customer to one written rule and fix late notices before negotiating chargebacks.",
    },
    {
      nodeId: "v4",
      title: "A second source and a recertification",
      scenarioOffsetMin: 10280,
      plannedDelayMin: 25,
      objectiveKeys: ["source", "notify"],
      phase: "main",
      narrativeMd: [
        `Wednesday 09:00, one week in. Penang samples passed first tests. ${ALT}'s compatible board needs a firmware port and safety recertification of the dishwashers and ranges that use it; the certification lab quotes 4 to 6 weeks.`,
        "",
        kua(
          [
            "Board stock now lasts until about day 16 at the allocation rate.",
            `The contingent business interruption policy covers loss from damage at a named supplier. ${SUPPLIER} is named.`,
            "Engineering could ship a reduced-feature board from an existing design in 3 weeks without recertification for ranges only.",
          ],
          [`What ${ALT} will charge for expedited tooling.`, "Whether Penang can hold 30 percent once other customers are added."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(SUPPLY, `Penang and ${ALT} both have costs and risks.`, [
          `Do you commit to ${ALT} tooling now, before you know the restart date at Guadalajara?`,
        ]),
        active(OPS, "Engineering wants a decision on the reduced-feature board.", [
          "Do you ship ranges with the reduced-feature board, and what must quality sign before you do?",
        ]),
        active(FINLEG, "The insurer has asked for a loss estimate.", ["What do you send the insurer, and what records do you keep from now on?"]),
        active(EXEC, "The owner's operating partner asks for a recovery plan by Friday.", ["What does the plan say, and what decisions does it ask the owner to make?"]),
        standby(SALES, "Customers have the allocation rule."),
        standby(PEOPLE, "Four day weeks continue."),
      ],
      expectedActions: {
        [SUPPLY]: [`Commits to ${ALT} tooling as a hedge and records the cost`, "Gets Penang's allocation commitment in writing"],
        [OPS]: [
          "Ships the reduced-feature board only after quality and safety sign-off",
          "Tells customers what changes for the end user",
        ],
        [FINLEG]: [
          "Sends a documented loss estimate with extra expense and mitigation costs",
          "Keeps records of every cost tied to the event",
        ],
        [EXEC]: ["Gives the owner a recovery plan with dates and asks for funding decisions", "States the risks and what is not known"],
      },
      capabilityKeys: ["GV.SC", "RC.RP", "GV.OC"],
      gradingNotes: "ISO 22301 clause 8.3 asks for strategies chosen in advance. Effective answers treat the second source as a hedge worth paying for, even if the original supplier recovers.",
    },
    {
      nodeId: "v5",
      title: "Week five",
      scenarioOffsetMin: 40520,
      plannedDelayMin: 20,
      objectiveKeys: ["people", "allocate"],
      phase: "main",
      narrativeMd: [
        `Wednesday 09:00, week five. Penang is shipping at 30 percent. ${SUPPLIER} now says Guadalajara will restart in week 12, two weeks later than first said. One ${ALT} board failed a thermal test and the fix adds two weeks.`,
        "",
        kua(
          [
            "Dishwasher output is 55 percent of plan. Ranges are near normal with the reduced-feature board.",
            "Four day weeks on two lines have lasted five weeks.",
            "The MTPD for dishwashers in the BIA is 6 weeks.",
          ],
          ["Whether retail customers will hold their allocation another month.", "Whether staff on reduced weeks will leave."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(EXEC, "Dishwashers are about to pass their MTPD.", [
          "What do you decide now that dishwashers will exceed the maximum tolerable period of disruption?",
        ]),
        active(PEOPLE, "Staff on four day weeks are asking how long it will last.", ["What do you tell them, and what support do you offer?"]),
        active(SALES, "Customers will hear about the delay soon.", ["How do you tell customers about the later restart and the new dates?"]),
        active(SUPPLY, `${ALT} has slipped two weeks.`, ["What do you do to protect the second source date?"]),
        standby(OPS, "Lines are running to the allocation plan."),
        standby(FINLEG, "The insurer has the updated estimate."),
      ],
      expectedActions: {
        [EXEC]: [
          "Records the MTPD breach and the decision taken, such as prioritizing top models or extra shifts later",
          "Asks the owner for any funding the plan needs",
        ],
        [PEOPLE]: ["Gives staff an honest range of dates and the pay position", "Offers redeployment or training on idle days"],
        [SALES]: ["Tells every customer the new dates in writing on the same day", "Updates the allocation rule if it changes"],
        [SUPPLY]: [`Puts an engineer on site at ${ALT}`, "Asks Penang for any capacity above 30 percent"],
      },
      capabilityKeys: ["RC.CO", "GV.RR", "GV.SC"],
    },
    {
      nodeId: "v6",
      title: "Restart and the next fire",
      scenarioOffsetMin: 101000,
      plannedDelayMin: 10,
      objectiveKeys: ["improve"],
      phase: "resolution",
      narrativeMd: [
        `Wednesday 09:00, week eleven. Guadalajara restarts next week. ${ALT} boards passed recertification and are qualified. Dishwasher output is back to 85 percent.`,
        "",
        kua(
          [
            "The owner's operating partner wants to know whether to keep two suppliers.",
            `${ALT}'s boards cost 6 percent more.`,
          ],
          ["Whether the board shortage cost market share that will not come back."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(EXEC, "The owner asks for a dual sourcing decision.", [`Do you keep ${ALT} as a second source, and on what volume split?`]),
        active(SUPPLY, "The BIA missed a single point of failure.", ["What other single-source parts would stop production, and what will you do about them?"]),
        active(FINLEG, "The insurance claim is open.", ["What is left to settle, and what changes in the supply agreement?"]),
        active(OPS, "The board wants a post-incident review.", ["What did the BIA get wrong, and what changes in the plan?"]),
        active(SALES, "Customers want to know what changes.", ["What do you tell customers about resilience from now on?"]),
        active(PEOPLE, "Staff worked short weeks for ten weeks.", ["How do you close the event with staff?"]),
      ],
      expectedActions: {
        [EXEC]: ["Keeps a second source with a stated split and cost", "Commissions a post-incident review with owners and dates"],
        [SUPPLY]: ["Lists single-source parts by tier with a plan for each", "Adds supplier site risk to sourcing reviews"],
        [FINLEG]: ["Settles the claim with documented losses", "Adds allocation transparency and audit rights to the supply agreement"],
        [OPS]: ["Updates MTPD, RTO and stock rules in the BIA", "Schedules a tabletop exercise on the next single source"],
        [SALES]: ["Tells customers about dual sourcing and safety stock changes", "Reviews contract notice terms"],
        [PEOPLE]: ["Thanks staff plainly and explains what changes", "Reports how pay and schedules were handled"],
      },
      capabilityKeys: ["ID.IM", "GV.SC"],
    },
  ],
  branches: [
    { from: "v1", to: "v2", condition: { type: "default" }, priority: 0 },
    { from: "v2", to: "v3b", condition: { type: "team_outcome", team: SALES, outcome: "ineffective" }, priority: 0 },
    { from: "v2", to: "v3b", condition: { type: "team_outcome", team: FINLEG, outcome: "ineffective" }, priority: 1 },
    { from: "v2", to: "v3a", condition: { type: "default" }, priority: 2 },
    { from: "v3a", to: "v4", condition: { type: "default" }, priority: 0 },
    { from: "v3b", to: "v4", condition: { type: "default" }, priority: 0 },
    { from: "v4", to: "v5", condition: { type: "default" }, priority: 0 },
    { from: "v5", to: "v6", condition: { type: "default" }, priority: 0 },
  ],
};
