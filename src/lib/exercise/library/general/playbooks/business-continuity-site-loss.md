# Business continuity and disaster recovery: site or region loss

[FILL IN organization name]. Business continuity and disaster recovery plan.

- Version: 1.0
- Date: 2026-10-26
- Owner: Head of business continuity (or COO)
- Approver: CEO
- Review cycle: every 12 months, after every exercise or invocation, and when a critical site, supplier or hosting region changes
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This plan covers the loss of a site, a supplier or a hosting region, from any cause: fire, flood, storm, power failure, a strike, a logistics failure, a cloud region outage, or a cyberattack on you or a supplier. It tells you how to decide to invoke, who leads, how to keep the most important activities running within their recovery time objectives, and how to come back.

It follows the structure of ISO 22301:2019 clause 8: business impact analysis and risk assessment (8.2), strategies and solutions (8.3), plans and procedures with a response structure, warning and communication, continuity and recovery (8.4), and an exercise programme (8.5). For EU financial entities it also supports the ICT business continuity and response and recovery plans required by DORA Art. 11 and the exit strategies for ICT providers in Art. 28(8).

Two cases are written out:

- **Supplier site loss.** A sole or main supplier's plant burns, floods or stops, or a logistics hub closes. Your sites are fine; your inputs are not.
- **Own site or hosting region loss.** A plant, office, data center or cloud region you depend on is lost, or an ICT provider that runs a critical service fails.

A cyber cause behaves like a site loss for continuity purposes. In March 2026 a destructive attack on Stryker's Microsoft environment disrupted order processing, manufacturing and shipping; the company told customers through Form 8-K updates and said in April that manufacturing was fully operational again. There was no ransom to negotiate, so the decisions were about recovery order, supply and customer communication.

This plan pairs with the Strategic TTX templates Supplier plant fire stops an appliance maker (supplier site loss, decision points B-A to B-D) and Major ICT incident at an EU bank's core banking provider (provider loss, with Data breach notification and disclosure for the DORA reporting).

Owners and time targets are starting points; the BIA sets the real ones.

## 2. Severity and invocation criteria

| Signal | Threshold | Level |
|---|---|---|
| A site is closed or unsafe | Any critical site, or any site for more than [FILL IN] hours | Level 1 |
| A supplier of a single source or critical input stops shipping | Any expected stop longer than its inventory cover | Level 1 |
| Cloud region or hosting provider outage affecting a critical service | Longer than half the service's RTO, or no ETA | Level 1 |
| ICT provider reports a cyberattack affecting your service | Any | Level 1, and start the incident response playbooks |
| Logistics disruption (port, carrier, border) | Delay longer than inventory cover for any critical input | Level 2 |
| Utility failure at a site | Longer than generator or UPS cover | Level 2 |

Level 1: crisis management team (CMT) convened within 1 hour; continuity plan invoked by the CMT lead. Level 2: business continuity lead and the affected business owner assess within 4 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| CMT lead | COO | CFO |
| Business continuity lead | Head of business continuity | Risk manager |
| Operations lead | VP operations or plant manager | Deputy |
| Supply chain lead | Chief procurement officer | Director of supply planning |
| IT and DR lead | CIO | Infrastructure manager |
| Finance | CFO | Controller |
| Legal | General counsel | Commercial counsel |
| Communications | Head of communications | [FILL IN] |
| Sales and customers | Chief commercial officer | VP key accounts |
| HR and safety | Chief people officer, EHS director | [FILL IN] |
| Executive sponsor | CEO | [FILL IN] |
| Insurer (property, business interruption, contingent business interruption) | [FILL IN policy numbers and claims lines] | Broker [FILL IN] |

| Activity | CMT lead | BC lead | Operations | Supply chain | IT and DR | Finance | Legal | Comms | Sales | HR and safety | Exec sponsor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Invoke the plan | A | R | C | C | C | I | I | I | I | C | I |
| Life safety and site access | C | I | R | I | I | I | I | I | I | A | I |
| Impact assessment against BIA | A | R | R | R | R | C | I | I | C | I | I |
| Failover or alternate site | A | C | R | C | R | C | I | I | I | C | C |
| Alternate supply and allocation | A | C | C | R | I | C | C | I | R | I | C |
| Customer allocation and notices | C | I | C | C | I | C | R | C | R | I | A |
| Force majeure and contract notices | C | I | I | C | I | C | A | I | R | I | C |
| Insurance notices and claims | C | C | C | C | I | R | A | I | I | I | I |
| Staff, customer and media messages | C | C | C | C | I | I | C | A | C | R | C |
| Return to normal | A | R | R | R | R | C | I | C | C | C | C |
| Post-incident review | A | R | R | R | R | C | C | C | C | C | C |

## 4. Before an incident: BIA, strategies and dependencies

- **BIA (ISO 22301 8.2.2).** For each product or service: the activities that deliver it, how impact grows over time if they stop, the maximum tolerable period of disruption (MTPD), the recovery time objective (RTO, shorter than the MTPD), the recovery point objective (RPO) for data, and the resources and dependencies each activity needs. [FILL IN BIA table]
- **Dependency map.** For each critical activity: sites, people, systems, data, utilities, and suppliers down to the tier that has a single source. Include ICT providers and the regions they run in. [FILL IN]
- **Strategies (8.3).** For each dependency, a chosen option: second source qualified in advance, safety stock, alternate site, reciprocal agreements, cloud multi-region or a warm standby, manual workarounds.
- **Supplier terms.** Force majeure clauses, notice periods, allocation rules, audit rights, and whether you can buy from others when a supplier cannot ship. For ICT providers: exit plans, data return in a usable format, and a transition period.
- **Insurance.** Property, business interruption and contingent business interruption (losses from a supplier's or customer's site loss), with notice terms and any named supplier requirement. [FILL IN]
- **Exercises (8.5).** At least one tabletop per year for each Level 1 scenario, and a technical failover test for each critical system. DORA Art. 11 requires yearly tests of ICT continuity plans for financial entities, including switchover to redundant infrastructure.

## 5. Detect and assess

**B1.** The person who learns of the event tells the BC lead and the CMT lead by phone. For a supplier event, that is usually the buyer or the supplier quality engineer. Owner: whoever learns of it. Target: within 30 minutes.

**B2.** Confirm life safety first. Are people at the affected site safe and accounted for? Owner: HR and safety. Target: immediately.

**B3.** Get facts from the source: what happened, which lines or services, expected duration, and what the supplier or provider has said in writing. Ask for daily written updates. Owner: Supply chain lead or IT and DR lead. Target: 4 hours.

**B4.** Map the event to the BIA: which products, services and customers depend on the lost site or supplier, how much inventory or capacity cover exists in days, and when each activity passes its RTO and MTPD. Owner: BC lead. Target: 8 hours.

**Decision point B-A: invoke the plan?** Invoke when any critical activity will pass its RTO before the source can restore it, or when the source cannot give a credible ETA. Invoking early costs little; invoking late loses the alternate capacity to others. The CMT lead decides and records the time and basis.

## 6. Analyze: options and their cost

**A1.** List options for each affected activity: alternate supplier, alternate site, redesign or substitute, buy from a competitor or distributor, expedite freight, run down safety stock, or reduce output. For each: time to first output, capacity, cost, quality risk and contract constraints. Owner: Supply chain lead with Operations. Target: 24 hours.

**A2.** Model demand against constrained supply by week, with and without each option. Owner: Supply chain lead with Finance. Target: 48 hours.

**A3.** Check the contracts on both sides: the supplier's force majeure claim and its notice; your customers' contracts, their notice periods, penalties, allocation rights and termination rights. Owner: Legal. Target: 48 hours.

**A4.** For a cyber cause at a supplier or provider: what data of yours they hold, whether connections from them to you must be cut, and when they expect to be clean. Owner: IT and DR lead with the CISO.

## 7. Contain: protect what you have

**C1. Secure scarce inventory and capacity.** Place holds on remaining stock of affected inputs, stop non-critical use, and reserve alternate capacity and freight. Owner: Supply chain lead. Target: 24 hours.

**Decision point B-B: allocate constrained supply.** When you cannot serve everyone, allocate on a written rule: safety and regulatory obligations first, then contract commitments, then strategic customers, then the rest, with a stated percentage. Do not let the loudest customer set the rule. The executive sponsor approves; Sales communicates it; Legal checks it against contracts. Record any exception and why.

**C2. Qualify alternates.** Start qualification of the second source at once, in parallel with the supplier's recovery. Quality signs off before any part ships to customers. Owner: Supply chain lead with Quality. Target: start within 48 hours.

**C3. ICT failover.** For a lost hosting region or provider: fail over critical services to the secondary region or warm standby according to the DR runbook, in BIA order. Confirm data at the secondary site meets the RPO before accepting writes. [FILL IN runbook] Owner: IT and DR lead.

Cloud examples, to adapt to your own runbook:

- AWS: promote the cross-region read replica or restore from cross-region backups in AWS Backup; switch Route 53 failover records; confirm IAM roles, KMS keys and secrets exist in the secondary region before you need them.
- Azure: initiate failover for geo-redundant storage accounts or paired region services where configured; fail over Azure SQL failover groups; check Azure Site Recovery replication health before a planned or unplanned failover.
- Google Cloud: promote a cross-region Cloud SQL replica; switch global load balancer backends; confirm that organization policies and service accounts apply in the target region.

Most cloud services do not fail over by themselves across regions. Services that do may need a customer action to start it. Confirm which is which in the runbook, not during the outage.

**C4. People and alternate site.** When your own site is lost, move critical roles to the alternate site or to remote work in BIA order. Confirm laptops, access, phones and printed procedures for the first shift. Tell staff where to go and when by text and phone, not only email, because email may be one of the lost services. Owner: HR and safety with IT and DR lead. Target: first shift after invocation.

**C5. Manual workarounds.** Where a system is lost and failover is not possible within the RTO, start the written manual workaround: paper order intake, spreadsheet scheduling, phone confirmation of shipments. Record every manual transaction for later re-entry. Owner: Operations lead.

**Decision point B-C: fail over or wait?** Fail over when the provider's ETA is longer than the remaining RTO, or is unknown. Failing over has its own risks: data loss up to the RPO, split-brain if the primary returns, and failback work later. The IT and DR lead recommends; the CMT lead decides and records the basis.

## 8. Eradicate the dependency

**E1.** If the event shows a single point of failure the BIA missed, record it and assign an owner. Owner: BC lead.

**Decision point B-D: exit or stay?** After the immediate response, decide whether to keep the supplier or provider, add a second one, or exit. For EU financial entities, exit plans for ICT providers supporting critical or important functions must already exist and be tested (DORA Art. 28(8)). The executive sponsor decides.

## 9. Recover and return to normal

**R1.** Ramp up in BIA order as capacity returns. Owner: Operations lead.

**R2.** Lift allocation in a stated sequence and tell customers each step. Owner: Sales.

**R3.** File and track insurance claims with documented losses, extra expense and mitigation costs. Owner: Finance.

**R4.** For ICT: fail back only after the primary site is verified, data is reconciled, and a window is agreed. Owner: IT and DR lead.

**Return to normal criteria.** The CMT stands down when the BC lead and Operations lead sign that:

- Every critical activity is within its normal service level.
- Allocation is lifted or a written plan for lifting it is agreed with customers.
- Alternate sources in use are qualified, or a date to return to the original source is set.
- Insurance claims are filed.
- Open risks are logged with owners.

## 10. Records and evidence

- Event log kept by the BC lead: every decision with time, owner and basis.
- Supplier and provider written updates, force majeure notices and responses.
- Allocation rule and every exception.
- Costs, losses and mitigation spend, with receipts, for insurance.
- For a cyber cause: preserve evidence as in the incident response playbooks.

## 11. Notification matrix

| Notice | To | Trigger and deadline | Owner |
|---|---|---|---|
| Property and business interruption insurer | Insurer and broker | Per policy: [FILL IN notice terms]. Tell them before spending on mitigation where possible. | Finance |
| Contingent business interruption insurer | Insurer and broker | Per policy: [FILL IN, and whether the supplier must be named]. | Finance |
| Customers (force majeure or delay) | Customers per contract | Per contract: [FILL IN notice periods]. Usually written notice within a set number of days of the event. | Legal and Sales |
| Supplier (reserve rights) | The supplier | Respond to its force majeure notice in writing, reserving rights. | Legal |
| Lenders | Banks under credit agreements | Material adverse events may need notice under covenants. [FILL IN] | Finance |
| SEC (if listed) | SEC | A material event may need Form 8-K (Item 8.01 or 7.01) or updated risk disclosure. | General counsel |
| DORA (EU financial entities) | Competent authority | If an ICT-related incident is classified as major, see Data breach notification and disclosure, section 15. | Head of operational risk |
| Employees and works councils | Staff | Before or with any public statement; local law may require consultation for layoffs or short time. [FILL IN] | HR |
| Regulators for product safety | Per sector | If a substitute part or process changes a regulated product. [FILL IN] | Quality |

## 12. Cyber cause: ransom and extortion

If the cause is a cyberattack on you, a supplier or an ICT provider:

- Start Ransomware and extortion response (if on you) and keep this plan running for continuity.
- A supplier's ransom decision is theirs. Do not pay, fund or encourage payment on a supplier's behalf without counsel, OFAC screening and insurer consent.
- Do not reconnect to a supplier or provider until it gives written confirmation of containment and indicators you can check.
- Ask what of your data the supplier held, because a supplier's breach can start your own notice duties.

## 13. Communications templates

**Customer notice (allocation)**

> Subject: Supply update for [product]
>
> On [date] [supplier event, plain terms] stopped supply of a component used in [product]. Your people and our sites are safe. We expect to ship [percent] of confirmed orders from [date] to [date], allocated under the rule below, and to return to full supply by [date range]. Your account manager [name] will call you today. We will update you every [interval].

**Force majeure notice outline**

- The event, date and how it prevents performance.
- The obligations affected and expected duration.
- Steps taken to mitigate.
- Reservation of rights.
- Contact and next update date.

**Staff note**

> [Event] has stopped supply of [input] to [site]. No one was hurt. [Lines] will run reduced shifts from [date]. Your manager will confirm your schedule. Pay for [period] is [FILL IN]. Questions to [FILL IN].

**Media holding statement**

> A fire at a supplier's facility has disrupted supply of a component we use in some products. We are working with the supplier and alternate sources and are keeping our customers informed. We expect to restore full supply over the coming weeks.

## 14. Post-incident review

Within 30 days of stand-down:

- Timeline from event to stand-down.
- Each decision point (B-A, B-B, B-C, B-D): what was decided, when, by whom, on what facts.
- BIA accuracy: were RTOs, MTPDs and inventory cover right?
- Which strategies worked, and which existed only on paper.
- Customer outcome: allocation fairness, penalties, lost business.
- Corrective actions with owners and dates, reported to the board. Update the BIA and this plan.

## 15. Known gaps and placeholders

- [FILL IN] BIA table with MTPD, RTO and RPO per activity.
- [FILL IN] dependency map to single-source tiers.
- [FILL IN] alternate supplier qualification status.
- [FILL IN] insurance policies and notice terms.
- [FILL IN] DR runbooks per critical service.
- Gap: suppliers below tier 1 are often unknown until they fail.

## Sources

- ISO 22301:2019, Security and resilience, Business continuity management systems, Requirements (not re-verified). https://www.iso.org/standard/75106.html
- NQA, ISO 22301 transition gap guide. https://www.nqa.com/medialibraries/NQA/NQA-Media-Library/PDFs/NQA-ISO-22301-Transition-Gap-Guide.pdf
- NIST SP 800-34 Rev. 1, Contingency Planning Guide for Federal Information Systems (not re-verified). https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final
- NIST SP 800-61r3, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- Regulation (EU) 2022/2554 (DORA), Arts. 11, 28 and 30. https://eur-lex.europa.eu/eli/reg/2022/2554/oj
- SEC, Form 8-K and General Instructions. https://www.sec.gov/files/form8-k.pdf
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Stryker Form 8-K (Item 7.01 customer update), 2026-03. https://www.sec.gov/Archives/edgar/data/310764/000119312526104431/d101097d8k.htm
