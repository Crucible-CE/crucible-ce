# Data breach notification and disclosure

[FILL IN organization name]. Legal and privacy playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: General counsel
- Approver: CEO and audit committee chair
- Review cycle: every 12 months, after every exercise that uses it, and when the organization enters a new jurisdiction, sector or listing
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details. This is not legal advice; outside counsel confirms each duty for the facts.

## 1. Purpose and scope

This playbook is the legal workflow that runs beside any technical response: ransomware, identity takeover, SaaS theft, an insider, a lost device, or a vendor's breach. It answers four questions in order and records each answer:

1. What happened to which data about whom, as far as is known today?
2. Which duties does that trigger, under which law or contract, and when does each clock start?
3. What do we say, to whom, in what order?
4. For a listed company, is it material, and what do we disclose?

It also covers disclosure decisions for non-cyber events that raise the same questions, such as leaked internal messages or executive misconduct (section 14), and EU financial sector reporting under DORA (section 15).

Phases follow NIST SP 800-61r3 and NIST CSF 2.0 (Govern and Respond, especially RS.CO and GV.OC). Owners and time targets are starting points.

## 2. Severity and declaration criteria

| Signal | Threshold | Legal severity |
|---|---|---|
| Confirmed or likely acquisition of personal data | Any | L1 |
| Encryption of systems holding personal data (no confirmed theft yet) | Any | L1 for health data (HIPAA presumption), L2 otherwise |
| Unauthorized access with no evidence of acquisition | Any | L2 |
| Vendor tells us of an incident involving our data | Any | L2, L1 if our data is confirmed in scope |
| Incident at a listed company with operational, financial or reputational impact | Any | L1 for the disclosure committee |
| Leak of internal communications or nonpublic information | Any | L2, L1 if it involves executives or material information |
| EU financial entity: ICT incident affecting critical services | Any | L1 for DORA classification |

L1: general counsel on the incident bridge within 1 hour; clock register opened; outside counsel engaged. L2: privacy lead reviews within 4 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Legal lead | General counsel | Deputy general counsel |
| Privacy lead | Chief privacy officer or DPO | Privacy counsel |
| Incident commander (technical) | CISO | Director of security operations |
| Disclosure committee (if listed) | CFO (chair), general counsel, CEO, controller, head of investor relations | [FILL IN] |
| Communications | Head of communications | [FILL IN] |
| Customer lead | Chief customer officer | [FILL IN] |
| HR | Chief people officer | [FILL IN] |
| Board liaison | Audit committee chair | Lead independent director |
| Outside counsel | [FILL IN breach counsel and securities counsel] | [FILL IN] |
| Notification vendor | [FILL IN mailing, call center and credit monitoring vendor] | [FILL IN] |
| Cyber insurer | [FILL IN] | Broker [FILL IN] |

| Activity | Legal lead | Privacy lead | IC | Disclosure committee | Comms | Customer lead | HR | Board | Outside counsel | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Open clock register | A | R | C | I | I | I | I | I | C | I |
| Facts and data map | C | R | R | I | I | C | I | I | C | I |
| Duty analysis per jurisdiction | A | R | I | I | I | I | I | I | R | I |
| Materiality determination | C | C | C | A | I | I | I | C | R | I |
| Regulator notices | A | R | C | I | C | I | I | I | R | I |
| Individual notices | A | R | I | I | C | C | C | I | R | C |
| Customer and contract notices | A | C | I | I | C | R | I | I | C | I |
| Media and public statements | C | C | I | C | A | C | I | C | C | I |
| Insurer notice and consent | A | C | I | I | I | I | I | I | C | R |
| Board reporting | R | C | C | C | I | I | I | A | C | I |
| Post-incident review | A | R | R | C | R | R | C | I | C | I |

## 4. Before an incident

- A data map: which systems hold which personal data, for residents of which states and countries, and under which contracts. [FILL IN]
- A clock register template (section 6) and a decision record template (section 8).
- A notification vendor under contract, with mail, call center and credit monitoring ready to start within 72 hours. [FILL IN]
- Contract notice terms for top customers and vendors extracted into one table. [FILL IN]
- Pre-approved holding statements (section 13).
- For listed companies: a written disclosure committee charter covering cybersecurity incidents, with the materiality factors in section 8.
- For EU financial entities: the DORA classification worksheet and reporting templates, and who submits them. [FILL IN]

## 5. Detect and open the file

**N1.** When the IC declares a Sev 1 or Sev 2 incident with any chance of personal or confidential data in scope, the legal lead is told within 1 hour. Owner: IC.

**N2.** Engage outside counsel and have counsel retain the forensics firm, so work is done at counsel's direction. Notify the insurer. Owner: Legal lead. Target: 4 hours.

**N3.** Issue a legal hold for logs, tickets, chat, email and devices in scope. Owner: Legal lead. Target: 24 hours.

**N4.** Record the earliest time anyone in the organization knew or should have known. Several rules start their clocks at awareness or discovery, and a regulator may test "should have known" against alerts that sat unread. Owner: Privacy lead. Target: 24 hours.

## 6. The clock register

One table, kept by the privacy lead, updated at every incident call:

| Clock | Rule or contract | Start event | Start time and basis | Due | Status | Owner |
|---|---|---|---|---|---|---|
| [example] GDPR supervisory authority | Art. 33 | Awareness of a personal data breach | [time, who, why] | +72 hours | Open | DPO |

Rules for the register:

- Each clock gets its own start event. "Awareness", "discovery", "determination" and "materiality determination" are different moments.
- A clock is not stopped because scoping is incomplete. Most rules allow phased or supplemented notice.
- A law enforcement request to delay notice is recorded with who asked, when and for how long. HIPAA allows delay on such a statement (45 CFR 164.412); other rules differ.

## 7. Duty analysis

**Decision point N-A: is this a notifiable breach?** For each jurisdiction and data class, counsel records whether the facts meet the definition, and if not, why not. Typical tests:

- **GDPR and UK GDPR.** A personal data breach is notified to the lead supervisory authority without undue delay and, where feasible, within 72 hours of awareness, unless unlikely to result in a risk (Art. 33). Individuals are told without undue delay when high risk is likely (Art. 34). A processor tells the controller without undue delay. Every breach is documented, notified or not.
- **US states.** Every state has a breach law, with its own definition of personal information, risk of harm test, deadline and attorney general notice. Example: Texas requires notice to the attorney general within 30 days of determining a breach affecting 250 or more Texas residents, and to individuals within 60 days. Many states exempt or deem compliant entities that follow HIPAA or federal banking rules. [FILL IN state matrix]
- **HIPAA.** Covered entities notify individuals without unreasonable delay and no later than 60 days after discovery; HHS at the same time for 500 or more; media for more than 500 residents of a state or jurisdiction. Business associates notify covered entities no later than 60 days after discovery, and business associate agreements often set much shorter windows. Ransomware encryption of ePHI is a presumed breach unless a documented four-factor assessment shows a low probability of compromise.
- **NYDFS.** Covered entities notify the superintendent no later than 72 hours after determining a cybersecurity incident occurred, including at an affiliate or a third-party service provider (500.17(a)); extortion payments within 24 hours (500.17(c)).
- **Contracts.** Customer agreements, data processing agreements and business associate agreements often require notice in 24 hours to 5 business days. A contract clock may be the first one due.
- **Sector rules.** Card brand rules through the acquirer, banking regulators, telecom, education, government contracts. [FILL IN]

## 8. Materiality and the SEC (listed companies)

**M1.** The disclosure committee meets within 24 hours of an L1 incident and then on a set cadence. Owner: CFO.

**Decision point M-A: is the incident material?** The determination must be made without unreasonable delay after discovery. Form 8-K Item 1.05 is due within four business days after the company determines the incident is material. Delay is available only if the US Attorney General finds that disclosure poses a substantial risk to national security or public safety. Under the SEC staff statement of May 21, 2024, an incident not yet determined material, or determined immaterial, can be disclosed voluntarily under Item 8.01; if later found material, Item 1.05 follows within four business days of that determination.

The decision record (one page, kept by securities counsel):

- Date and time of the meeting, members present.
- Facts known and unknown, with sources.
- Quantitative factors: costs to date and estimated, revenue impact, insurance, liquidity.
- Qualitative factors: operational disruption, customer harm, reputational impact, regulatory exposure, litigation, data types and volume, effect on competitive position.
- Determination: material, not material yet, or not material, and the reasoning.
- Next review date and what new fact would change the answer.

**M2.** If material, securities counsel drafts Item 1.05: nature, scope and timing of the incident, and its material impact or reasonably likely impact. Do not include technical details that would help an attacker. Amend when new material information is known. Owner: General counsel.

**M3.** Keep investor relations, executives and staff from selective disclosure while the decision is open (section 14).

## 9. Notification to regulators, individuals and customers

**N5. Regulator notices.** Use each regulator's portal or form. Send what is known; mark what is estimated; give the date of the next update. Owner: Privacy lead with outside counsel.

**N6. Individual notices.** Plain language: what happened, what information, what we are doing, what you can do, how to reach us. Offer credit monitoring or identity protection where the data supports it. [FILL IN offer] Owner: Privacy lead with the notification vendor.

**N7. Customer notices.** Through the account owner by phone and in writing, before or with any public statement. Owner: Customer lead.

**N8. Media.** One statement, approved by Legal and Communications, consistent with every notice. Owner: Communications.

**Decision point N-B: notify before scoping is complete?** Yes, when a clock is due. Send what is known with a supplement date. Waiting for a final list can miss every deadline, as the Synnovis data review, which took over a year, would have.

## 10. Ransom and extortion: effect on notice

- Payment does not end any notice duty. Data taken is taken, whatever an attacker promises.
- A threat to publish is a fact that supports a finding of acquisition and of risk to individuals.
- If a payment is considered: OFAC screening, FBI contact, insurer consent, and board approval, following Ransomware and extortion response, section 12. NYDFS covered entities report payment within 24 hours; CIRCIA proposes 24 hours for covered entities once in effect.
- Record in the decision record whether the extortion changes the materiality analysis.

## 11. Recover and close the file

**R1.** Track every notice to delivery: returned mail, call center volume, regulator questions. Owner: Privacy lead.

**R2.** Answer regulator inquiries through counsel, with the clock register and decision records as the backbone. Owner: Legal lead.

**R3.** Close the file when every clock is met, every regulator inquiry is answered, and the post-incident review is done. Keep the file for [FILL IN retention]. Owner: Legal lead.

## 12. Evidence and privilege

- Forensic work at the direction of outside counsel. Keep the forensic report separate from business remediation documents.
- Board and disclosure committee minutes record facts and reasoning, not speculation.
- Do not create informal written assessments of fault in chat or email.
- Keep the clock register, decision records, drafts and final notices together. [FILL IN location]

## 13. Communications templates

**Regulator notice outline**

- Who we are, our role (controller, processor, covered entity, business associate), registration or license numbers.
- Dates: first access, discovery or awareness, containment, this notice.
- What happened, in plain terms.
- Data categories and approximate number of individuals and records, confirmed and estimated.
- Likely consequences and measures taken or proposed.
- Contact point and date of the next update.

**Individual notice**

> Subject: Notice of a data security incident
>
> We are writing to tell you about an incident that may involve your information. On [date] we learned that [plain description]. The information involved may include [data types]. We [steps taken]. We are offering [service] at no cost; to enroll, [steps]. You can also [steps people can take]. If you have questions, call [number] between [hours].

**Holding statement**

> [Organization] is investigating a security incident. We acted to contain it, engaged outside experts and notified law enforcement. We will notify anyone whose information was affected and will share more as our investigation allows.

**Board update outline**

- What we know and do not know.
- Clocks met and next due.
- Materiality status and next review.
- Exposure: regulatory, litigation, contractual, insurance.
- Decisions the board needs to make, with a recommendation.

## 14. Disclosure of non-cyber events: leaks, misconduct and Regulation FD

This section pairs, in part, with the Crisis Sim template on an executive misconduct leak. The legal workflow is the same: facts, duties, order of communication, materiality.

**X1. Leaked internal messages.** Treat the leak as two problems: what the messages say, and how they got out. Preserve the source systems under legal hold. An internal investigation into the leak must not target protected whistleblowing: SEC and Sarbanes-Oxley protections and the DTSA immunity notice apply to reports to regulators and counsel. Counsel directs the investigation.

**X2. Board oversight.** Allegations against the CEO or another executive go to the board, usually a committee of independent directors with its own outside counsel. The executive does not direct the investigation or the response.

**X3. Regulation FD.** Material nonpublic information disclosed selectively to analysts, investors or similar persons must be made public at the same time if intentional, or promptly if not. Promptly means as soon as reasonably practicable and no later than the later of 24 hours or the start of the next day's NYSE trading after a senior official learns of it. Public disclosure is usually a Form 8-K (Item 7.01 furnished, or Item 8.01 filed) or a press release with broad distribution. Until a decision is made, executives and investor relations say nothing beyond prior public statements.

**X4. Officer changes.** If the CEO, president, principal financial, accounting or operating officer, or a named executive officer resigns, retires or is terminated, Form 8-K Item 5.02(b) is due within four business days. A director who resigns over a disagreement triggers Item 5.02(a), with the director's letter as an exhibit.

**Decision point X-A: what do we disclose and when?** The disclosure committee applies section 8 to the facts: is the information material, has it been selectively disclosed, does an 8-K item apply? Record the decision in the same format.

**X5. Media.** Say what the board is doing (investigation, leave, interim leadership), not conclusions it has not reached. Staff hear first or at the same time.

## 15. EU financial entities: DORA and NIS2

This section pairs with the Strategic TTX template on a major ICT incident at an EU bank, together with Business continuity and disaster recovery.

**F1. Classify.** Under Delegated Regulation (EU) 2024/1772 an ICT-related incident is major when it affects critical services and either there was malicious unauthorized access to network and information systems that may lead to data loss, or at least two other thresholds are met. Thresholds include: more than 10 percent of the service's clients or more than 100,000 clients affected; more than 30 percent of counterparts; transactions over 10 percent of the daily average number or value; reputational impact; duration over 24 hours or downtime over 2 hours for ICT services supporting critical or important functions; two or more Member States; data losses; economic impact over EUR 100,000. An outage at an ICT third-party provider counts if it affects your services. Owner: Head of operational risk with the IC. Target: as soon as facts allow.

**Decision point F-A: classify as major?** The classification decision has its own time stamp, because the initial notification clock runs from it. Record the criteria met and the evidence.

**F2. Report (DORA Art. 19 and Delegated Regulation (EU) 2025/301, Art. 5).** Initial notification within 4 hours of classification as major and no later than 24 hours after becoming aware of the incident (within 4 hours of classification if classified later). Intermediate report within 72 hours of the initial notification, updated when status changes materially and when regular activities are recovered. Final report within one month of the latest intermediate report, with root cause and actual impact. A missed deadline is explained to the authority without undue delay. Some weekend relief exists, but not for initial and intermediate reports from credit institutions. Owner: Head of operational risk. [FILL IN competent authority and portal]

**F3. Clients (Art. 19(3)).** When the incident affects clients' financial interests, inform them without undue delay, with the measures taken to limit harm. Owner: Communications with Legal.

**F4. NIS2.** For a financial entity that is essential or important under NIS2, DORA applies as the sector-specific act (DORA Art. 1(2), NIS2 Art. 4), so DORA reporting replaces NIS2 Art. 23 for that entity. An ICT provider or a non-financial group company may still have its own NIS2 duties: early warning within 24 hours, incident notification within 72 hours, final report within one month. Ask your provider what it filed.

**F5. GDPR in parallel.** If personal data was affected, GDPR Art. 33 runs on its own clock to the data protection authority, separate from DORA.

## 16. Post-incident review

Within 30 days of closing the notice phase:

- Clock register: each clock's start, due and actual time, with any miss explained.
- Each decision point (N-A, N-B, M-A, X-A, F-A): what was decided, when, by whom, on what facts.
- Consistency check: did every notice, statement and filing say the same thing?
- Regulator and customer feedback.
- Corrective actions with owners and dates, reported to the audit committee.

## 17. Known gaps and placeholders

- [FILL IN] data map and state matrix.
- [FILL IN] contract notice table.
- [FILL IN] notification vendor and credit monitoring offer.
- [FILL IN] disclosure committee charter and members.
- [FILL IN] DORA competent authority, portal and templates, if applicable.
- Gap: whether a given event is material is fact specific and cannot be decided in advance.

## Sources

- NIST SP 800-61r3, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- GDPR, Regulation (EU) 2016/679. https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- EDPB Guidelines 9/2022 on personal data breach notification, v2.0. https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- HHS, Breach Notification Rule (not re-verified). https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html
- HHS, Ransomware Fact Sheet (not re-verified). https://www.hhs.gov/sites/default/files/RansomwareFactSheet.pdf
- 23 NYCRR 500.17. https://www.law.cornell.edu/regulations/new-york/23-NYCRR-500.17
- SEC, Form 8-K and General Instructions. https://www.sec.gov/files/form8-k.pdf
- SEC final rule release 33-11216 (not re-verified). https://www.sec.gov/files/rules/final/2023/33-11216.pdf
- Greenberg Traurig, SEC clarifies cybersecurity incident reporting, 2024-05. https://www.gtlaw.com/ar/insights/2024/5/sec-clarifies-confusion-concerning-cybersecurity-incident-reporting
- 17 CFR 243.101, Regulation FD definitions. https://www.law.cornell.edu/cfr/text/17/243.101
- 18 U.S.C. 1833, immunity notice. https://www.law.cornell.edu/uscode/text/18/1833
- Regulation (EU) 2022/2554 (DORA). https://eur-lex.europa.eu/eli/reg/2022/2554/oj
- Delegated Regulation (EU) 2024/1772 (classification). https://eur-lex.europa.eu/eli/reg_del/2024/1772/oj
- Delegated Regulation (EU) 2025/301, Art. 5 (time limits), as reproduced by Advisera. https://advisera.com/cdr-2025-301/time-limits-for-the-initial-notification-and-for-the-intermediate-and-final-reports/
- Directive (EU) 2022/2555 (NIS2). https://eur-lex.europa.eu/eli/dir/2022/2555/oj
- The Register, "NHS supplier ends probe into ransomware attack that contributed to patient death," 2025-11-13. https://www.theregister.com/2025/11/13/synnovis_qilin_investigation/
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
