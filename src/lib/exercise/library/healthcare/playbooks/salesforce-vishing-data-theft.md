# Salesforce vishing and data theft response

Quarrystone Health Analytics, Inc. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and chief customer officer
- Review cycle: every 12 months, after every exercise that uses it, and whenever Salesforce integrations or connected app policy change
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers theft of data from Salesforce after an employee is talked into approving a malicious connected app, and the extortion that follows, often weeks or months later. Google Threat Intelligence Group (GTIG) described the pattern in 2025 as UNC6040: a caller posing as IT support walks the employee to the connected app setup page to approve a modified Data Loader app, which grants API access. No Salesforce vulnerability is involved. A separate cluster, UNC6240, then extorts victims under the ShinyHunters name and demands Bitcoin within 72 hours. GTIG treats the link between the two clusters as an inference.

A related pattern is covered here too: stolen OAuth tokens for a third party integration used to export Salesforce data and hunt it for credentials (UNC6395 and the Salesloft Drift integration, August 2025). Google advised treating all Drift connected tokens as compromised.

ShinyHunters is under active law enforcement pressure in 2026 and its leak sites have gone up and down. Treat the brand as active but degraded, and treat its claims as unverified until checked.

Why this matters for a business associate: hospital and health plan staff open support cases when a dashboard looks wrong, and they paste patient examples and attach extracts. That makes support cases PHI received from covered entities, wherever they are stored.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0: detect, analyze, contain, eradicate, recover and post-incident review. Step owners and time targets are starting points; adjust them to your staffing.

In scope: Salesforce (accounts, contacts, cases, attachments), connected apps and integrations, secrets found in exported records, and notice duties to covered entities, regulators and investors.

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Extortion message that includes real Salesforce records | Any | Sev 1 |
| New connected app approved by a non-admin user | Any | Sev 2, Sev 1 if followed by bulk API use |
| Bulk API query or export by a user session or connected app | More than 50,000 rows in an hour, or any queryAll on Case or ContentVersion outside an approved job | Sev 1 |
| Employee reports a call from IT asking them to approve an app or enter a code | Any | Sev 2 |
| Third party integration vendor reports a token compromise | Any integration with Salesforce or Microsoft 365 access | Sev 1 |
| Use of a credential that appears in a support case, from an unknown IP | Any | Sev 1 |

Sev 1: incident commander named within 15 minutes, executive sponsor within 30 minutes, counsel and IR retainer within 2 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Salesforce security administrator |
| Cloud and IT lead | CIO | Salesforce platform owner |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | VP Communications | Communications manager |
| Executive sponsor | CEO | CFO |
| Customer Success | Chief customer officer | VP customer support |
| Salesforce | Salesforce security contact [FILL IN case process and account team] | [FILL IN] |
| Outside counsel | Ressler Kemp LLP [FILL IN] | [FILL IN] |
| IR retainer | Kestrel Point Incident Response [FILL IN] | [FILL IN] |
| Cyber insurer | Halbrook Specialty [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | Cloud and IT | Legal and Privacy | Comms | Exec sponsor | Customer Success | Outside counsel | IR retainer | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I |
| Preserve Salesforce logs | A | R | R | C | I | I | I | C | C | I |
| Revoke apps and tokens | A | R | R | I | I | I | I | I | C | I |
| Rotate secrets found in records | A | R | R | I | I | I | C | I | C | I |
| PHI determination for case data | C | C | I | A | I | I | C | R | C | I |
| BAA and HIPAA notices | C | C | I | A | C | I | R | R | I | I |
| Customer calls, one owner per account | C | I | I | C | C | C | A | C | I | I |
| Extortion decision | C | C | I | R | I | A | I | R | C | C |
| Materiality determination | C | C | I | R | I | A | I | R | I | I |
| Leak site monitoring | A | R | I | C | C | I | I | C | R | I |
| Post-incident review | A | R | R | R | R | C | R | C | C | I |

## 4. Before an incident

- Only Salesforce administrators can approve connected apps. Users cannot self-authorize. In Setup, Connected Apps OAuth Usage is reviewed monthly. [FILL IN reviewer]
- API Enabled is limited to the profiles that need it, and Login IP Ranges restrict API access to company and integration IPs. GTIG's UNC6040 guidance is to restrict API access by IP and profile and to review connected apps and Data Loader use.
- Event Monitoring (or another export of API events) is licensed and routed to long-term storage, with an alert on bulk queries of Case, Attachment and ContentVersion. [FILL IN]
- Support staff know that IT never asks them to approve an app or read out a code by phone, and they have a number to call back.
- A scan for secrets (passwords, keys, SAS URLs, tokens) runs over new cases, and patient identifiers in cases are redacted where possible.
- An inventory of every third party app with tokens into Salesforce and Microsoft 365 exists, with an owner per app.

## 5. Detect

**D1.** If the first sign is an extortion message, do not reply. Preserve it with headers. The IC instructs every recipient in writing not to reply or forward. Owner: IC. Target: 30 minutes.

**D2.** Validate any sample records against Salesforce: record IDs, case numbers and timestamps. Note which customers the samples belong to. Owner: Security lead. Target: 2 hours.

**D3.** Export logs before changing anything: Setup Audit Trail, Login History, Connected Apps OAuth Usage, and API event or Event Monitoring logs for the longest period available. Owner: Security lead with the Salesforce platform owner. Target: 2 hours.

**D4.** Find the access path. In Setup, open Connected Apps OAuth Usage and look for apps that no admin installed, especially apps named like Data Loader. In Login History look for "Remote Access 2.0" logins by that app and the source IPs. Owner: Security lead. Target: 4 hours.

**Decision point D-A: is this Sev 1?** Yes if any sample record is real. A real sample is enough to declare, even before the access path is known.

## 6. Analyze

**A1.** Establish when the export happened, which objects were queried, row counts and source IPs. Where logs from that period are gone, say so in writing and rely on the attacker's samples and object level reasoning. Owner: Security lead with IR retainer. Target: 24 hours.

**A2.** Interview the employee who approved the app, with HR and counsel present, as a witness, not a suspect. Record the call details: number, time, what the caller said. Owner: Security lead. Target: 24 hours.

**A3. PHI determination.** Review exported cases and attachments for patient identifiers: names, MRNs, member IDs, dates of birth, diagnoses. PHI that a covered entity sent to Quarrystone is PHI wherever it sits, including Salesforce. Count affected individuals per customer. Owner: Chief privacy officer with outside counsel. Target: first count in 24 hours, then daily.

**Decision point A-A: is the CRM data PHI under the BAAs?** Treat case data that identifies patients as PHI. Do not treat Salesforce as outside the BAAs because it is "the CRM". Record the decision and its basis.

**A4. Secrets in the data.** Search the exported records for credentials: SFTP passwords, API keys, storage SAS URLs, connection strings and tokens. UNC6395 hunted Salesforce data for exactly this: AWS keys, passwords and Snowflake tokens. For each secret, record where it was found and what it opens. Owner: Security lead. Target: 8 hours.

**A5.** Check whether those secrets were used: storage logs for SAS use, SFTP logs, customer portal logs. If storage data plane logs were off, ask the customer and say what cannot be proven. Owner: Security lead. Target: 24 hours.

**A6.** Check other integrations. If any third party app with tokens into Salesforce also has tokens into Microsoft 365 or another platform, review its activity there too. Owner: Security lead. Target: 24 hours.

## 7. Contain

**C1.** Block the malicious connected app and revoke its OAuth tokens. In Setup, Connected Apps OAuth Usage, choose the app and revoke; then in Manage Connected Apps set it so only admin approved users are pre-authorized, or block it. Owner: Security lead. Target: 1 hour after D3 is complete.

**C2.** Revoke and reissue tokens for every other integration whose access cannot be confirmed as legitimate. Where an integration vendor reports a compromise, treat all its tokens as compromised, as Google advised for Drift. Owner: Cloud and IT lead. Target: 24 hours.

**C3.** Restrict API access: remove API Enabled from profiles that do not need it, set Login IP Ranges on the rest, and set connected app policy so only admins can approve apps. Owner: Cloud and IT lead. Target: 24 hours.

**Decision point C-A: cut API access for everyone?** A full API cut stops the theft path fast but breaks customer case integrations and reporting. Choose it only if the access path is unknown after D4. Otherwise revoke the specific app and restrict by profile and IP. Record the choice.

**C4. Rotate every secret found in exported records.** Rotate each one now, whether or not it appears to have been used. For Azure storage SAS signed with an account key, rotate both account keys and revoke user delegation keys. Owner: Cloud and IT lead, with Customer Success for customer owned credentials. Target: 24 hours.

```
az storage account keys renew --account-name <account> --resource-group <rg> --key key1
az storage account keys renew --account-name <account> --resource-group <rg> --key key2
az storage account revoke-delegation-keys --name <account> --resource-group <rg>
```

For customer credentials (for example a hospital's SFTP password pasted into a case), the customer must rotate. Customer Success tells each one which credential was exposed. Do not delete the cases: the attacker already has the secrets, and the cases are evidence.

**C5.** Reset the password and revoke sessions for the employee who approved the app, and check their account for other grants. Owner: Security lead. Target: 1 hour.

## 8. Eradicate

**E1.** Confirm that no unapproved connected app, token or user remains, with a second review by someone who did not do the first. Owner: Security lead.

**E2.** Purge secrets from cases going forward (redaction or field level controls) after evidence copies are preserved. Owner: Cloud and IT lead.

**E3.** Add detection for bulk exports and for new connected app approvals. Owner: Security lead.

## 9. Recover

There is no encryption to recover from in this pattern. Recovery is about trust, customers and the record.

**R1.** Return API access to integrations one at a time, with IP restrictions and least privilege, after the integration owner confirms it. Owner: Cloud and IT lead.

**R2.** Give every affected customer a named owner, the facts, the credentials of theirs that were exposed, and a date for the next update. Owner: Customer Success.

**R3.** Offer customers evidence that the specific gap is closed: admin only app approval, IP and profile restrictions, bulk export alerting, and an independent assessment summary under NDA. Owner: Customer Success with CISO.

**Return to service criteria.** Normal Salesforce use and integrations resume when the Security lead signs that:

- Only admins can approve connected apps, and the full app inventory is reviewed.
- API access is limited by profile and IP.
- Every secret found in exported records is rotated or confirmed rotated by its owner.
- Bulk export alerting is live and tested.

## 10. Evidence preservation and chain of custody

- Extortion emails with full headers, kept in place and exported. Never delete them.
- Setup Audit Trail, Login History, Connected Apps OAuth Usage and API event logs, exported before any change, with hashes.
- A copy of the affected cases and attachments, held by counsel, for the PHI and secrets review.
- Notes of the interview with the employee who approved the app.
- Leak site captures, collected by the IR retainer through counsel. Staff do not visit leak sites from company devices.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]

## 11. Regulatory and contractual notification matrix

Discovery: under 45 CFR 164.410 discovery is the first day the breach is known, or with reasonable diligence would have been known, to any workforce member or agent. In this pattern the first sign is often the extortion email, weeks after the export. If the export was in logs that someone was supposed to watch, counsel must assess whether the company should have known earlier. Record a working discovery time now and counsel's written view on the earlier date. Do not wait for the final count: the clocks run from discovery.

No encryption, so the ransomware presumption does not apply, but exfiltration of PHI is a breach unless a documented assessment shows a low probability of compromise.

| Notice | To | Trigger and deadline | How | Owner |
|---|---|---|---|---|
| Cyber insurer | Halbrook Specialty | As soon as practicable. Policy: [FILL IN, assumed 48 hours]. Often a condition of cover. | Hotline and written notice | General counsel |
| BAA incident notice (contractual) | Customers whose patients appear in exported records | 5 business days from discovery under current BAAs [FILL IN per customer] | Written notice and a call from the named owner | Chief privacy officer |
| HIPAA breach notice to covered entities | Affected covered entities | No later than 60 calendar days after discovery. Identify each affected individual to the extent possible. Send what is known and supplement. | Written notice | Chief privacy officer |
| Individual, HHS and media notice | Patients, HHS, media | Covered entity's duty, delegable to Quarrystone (OCR Change Healthcare FAQ). HHS at the same time as individuals for 500 or more; media where more than 500 residents of a state. | Delegation in writing per customer | Chief privacy officer |
| Texas attorney general | Texas AG | No later than 30 days after determining a breach of 250 or more Texas residents, through the online form. Counsel confirms who files. | Online form | General counsel |
| Other states | State AGs | Varies. Many exempt or deem compliant HIPAA entities. | Per state | Outside counsel |
| SEC Form 8-K | SEC | Item 1.05 within four business days of a materiality determination, made without unreasonable delay. Item 8.01 for voluntary disclosure before a determination. A data theft can be material with no outage. | EDGAR | General counsel and CFO |
| Salesforce | Salesforce security | Promptly, to get platform side logs and help | Support case | Security lead |
| FBI | Field office or IC3 | Early. Law enforcement actively investigates this group. | [FILL IN] | General counsel |

Law enforcement delay: under 164.412 notification may be delayed on a law enforcement statement that it would impede an investigation. If the FBI asks for a delay, ask for the statement, record its scope, and tell affected customers that a delay applies. Keep BAA notices to customers on time unless the statement covers them and counsel agrees.

Public customers: a public health plan customer may file its own 8-K and name Quarrystone. Coordinate timing through counsel. Quarrystone's materiality determination is its own and is not set by a customer's filing.

## 12. Ransom and extortion decision procedure

This pattern is theft only. Payment buys a promise to delete that cannot be verified.

1. Nobody replies. Only the panel negotiator, if engaged, communicates with the attacker.
2. Security sizes the claim from the samples and the logs.
3. Outside counsel runs an OFAC sanctions screen. OFAC's 2021 advisory strongly discourages payment; payment to a sanctioned person can violate sanctions on a strict liability basis.
4. Counsel notifies the FBI and records the contact.
5. The insurer confirms consent terms and its panel negotiator.
6. The executive sponsor presents the options to the board: decline and prepare customers for a leak; engage through the negotiator to size the claim or buy time; pay. The board decides and the decision is recorded. [FILL IN approval authority]
7. If the attacker lists the company on a leak site with a countdown, the IC reconvenes the decision makers. A countdown is the pressure the attacker planned, not new information about the data.
8. Customers who ask whether the company paid get a truthful answer.

Reference: in October 2025 Salesforce said it would not engage, negotiate with or pay any extortion demand; the group then published data said to be from several companies after its deadline.

## 13. Communications templates

**Internal holding note (staff)**

> Subject: Security incident involving Salesforce
>
> We are responding to a security incident in which someone obtained data from our Salesforce system. Outside experts are helping us.
>
> IT will never ask you to approve an app, enter a code or install software over the phone. If anyone calls asking for that, hang up and call [FILL IN].
>
> Do not reply to any message about this incident from outside the company, and do not forward it. Send it to [FILL IN]. Next update by [time].

**Customer notice (covered entity), first notice under the BAA**

> Subject: Notice of security incident under our business associate agreement
>
> On [date] we discovered that an unauthorized party copied data from our customer support system, including support cases your staff opened with us. Some of those cases contained patient information.
>
> What we know: [date range, objects, number of your patients identified so far]. What we do not yet know: [open questions]. We also found that the following credential of yours was in a case and may be exposed: [credential]. Please rotate it.
>
> We will update you by [date]. We can send notices to individuals, HHS and media on your behalf if you ask us to in writing. Your contact is [name, phone, email].

**Regulator note outline**

- Our role as a business associate and the covered entities affected.
- Dates of the theft (best estimate), discovery, containment and each notice, and why the theft was not detected sooner.
- How access was obtained, without a platform vulnerability.
- Types of PHI and number of individuals, confirmed and estimated.
- Controls changed: app approval, API restrictions, secret scanning, export alerts.
- Contact for follow-up.

**Media holding statement**

> Quarrystone Health Analytics is investigating unauthorized access to data in one of our business systems. We have stopped the access, engaged outside experts and notified law enforcement. We are contacting affected customers directly.

## 14. Post-incident review

Within 30 days:

- Timeline from the call to the extortion email, and why the export was not detected when it happened.
- Each decision point (D-A, A-A, C-A, the extortion decision, the law enforcement delay and the materiality determination).
- Which secrets were in the CRM, who put them there, and how that changes.
- Notice timeliness against each clock in section 11.
- Customer outcomes: who stayed, who left, and what evidence they asked for.
- Corrective actions with owners and dates, reported to the board. The control gap is that a user could approve an app. Do not make the review about the person who approved it.

## 15. Known gaps and placeholders

- [FILL IN] Salesforce security contact and case process.
- [FILL IN] connected app inventory location and owners.
- [FILL IN] Event Monitoring or log export status and retention.
- [FILL IN] counsel, IR retainer and insurer numbers.
- [FILL IN] callback number support staff use to verify IT.
- Gap: support cases contain PHI and customer credentials. Redaction and secret scanning reduce, but do not remove, what a theft exposes.

## Sources

- Google Threat Intelligence Group, "The cost of a call: from voice phishing to data extortion," 2025-06 (updated 2025-08). https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion
- Google Threat Intelligence Group, "Widespread data theft targets Salesforce instances via Salesloft Drift," 2025-08-26 (updated 2025-08-28). https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift
- The Hacker News, "Salesloft OAuth breach via Drift AI chat agent," 2025-08. https://thehackernews.com/2025/08/salesloft-oauth-breach-via-drift-ai.html
- BleepingComputer, "ShinyHunters launches Salesforce data leak site to extort 39 victims," 2025-10. https://www.bleepingcomputer.com/news/security/shinyhunters-starts-leaking-data-stolen-in-salesforce-attacks/
- BleepingComputer, "Salesforce refuses to pay ransom over widespread data theft attacks," 2025-10. https://bleepingcomputer.com/news/security/salesforce-refuses-to-pay-ransom-over-widespread-data-theft-attacks
- KrebsOnSecurity, "ShinyHunters wage broad corporate extortion spree," 2025-10-07. https://krebsonsecurity.com/2025/10/shinyhunters-wage-broad-corporate-extortion-spree/
- BleepingComputer, "ShinyHunters hacker reportedly detained in Jordan, aiding FBI," 2026-10-03. https://www.bleepingcomputer.com/news/security/shinyhunters-hacker-reportedly-detained-in-jordan-aiding-fbi/
- Microsoft Learn, Manage storage account access keys (not re-verified). https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage
- HHS, Breach Notification Rule (not re-verified). https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html
- eCFR, 45 CFR Part 164 Subpart D (not re-verified). https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D
- HHS OCR, Change Healthcare Cybersecurity Incident FAQ (not re-verified). https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Greenberg Traurig, "SEC clarifies confusion concerning cybersecurity incident reporting," 2024-05. https://www.gtlaw.com/ar/insights/2024/5/sec-clarifies-confusion-concerning-cybersecurity-incident-reporting
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Debevoise, OFAC and FinCEN update ransomware guidance, 2021-11. https://www.debevoise.com/insights/publications/2021/11/ofac-and-fincen-update-ransomware-guidance-to
- Howden, "Cyber claims ready." https://www.howdengroup.com/my-en/insight/cyber-claims-ready
