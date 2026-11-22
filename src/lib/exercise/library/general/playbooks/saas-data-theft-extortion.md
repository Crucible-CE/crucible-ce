# SaaS data theft and extortion response

[FILL IN organization name]. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and CIO
- Review cycle: every 12 months, after every exercise that uses it, and when a major SaaS platform or integration is added
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers theft of data from SaaS platforms and cloud data warehouses, with or without a later extortion demand, by an outside attacker or by an insider. There is usually no encryption and no outage. The first sign is often the extortion email, a customer who sees their data for sale, or an alert on an unusual export.

Patterns this playbook is written against:

- **CRM vishing (UNC6040, ShinyHunters).** Google Threat Intelligence reported in 2025 that callers posing as IT support walked employees to Salesforce's connected app setup page to approve a modified Data Loader app, which granted API access for bulk export. No Salesforce vulnerability was involved. Extortion under the ShinyHunters name sometimes came months later, with a demand for Bitcoin within 72 hours. In October 2025 a leak site listed 39 companies with a deadline. The group is under heavy law enforcement pressure in 2026 but still partly active.
- **Stolen OAuth tokens from an integration (UNC6395, Salesloft Drift).** In August 2025 an attacker used stolen OAuth tokens for the Drift integration to query and export data from Salesforce instances at many organizations, hunting for credentials such as AWS keys, passwords and Snowflake tokens in the records. Google advised treating every Drift connected token as compromised.
- **Warehouse credential theft (UNC5537, Snowflake 2024).** Mandiant found attackers logging in to Snowflake customer accounts with credentials stolen by infostealers, some from 2020. The gaps were no MFA, no rotation and no network restriction. About 165 organizations were notified.
- **Insider exfiltration.** A departing employee copies source code, designs, customer lists or warehouse extracts to personal storage. Section 14 covers the legal steps.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0. Owners and time targets are starting points.

In scope: Salesforce and other CRMs, collaboration suites (Google Workspace, Microsoft 365), code platforms (GitHub, GitLab), data warehouses (Snowflake, Databricks, BigQuery, Redshift), file sharing, and the OAuth integrations between them.

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Extortion email claiming stolen SaaS data, with or without samples | Any | Sev 1 until the claim is sized |
| New connected app or OAuth grant with API or full access scopes | Any not matched to a change | Sev 2, Sev 1 if followed by bulk API reads |
| Bulk export or API query volume from one user or integration | Over [FILL IN] records in an hour, or 10 times the user's baseline | Sev 2 |
| Warehouse login without MFA from a new network | Any for a human user | Sev 2 |
| Integration vendor reports a token compromise | Any integration you use | Sev 1 |
| Departing or departed employee copies data to personal storage | Any source code, customer data or restricted data | Sev 2, Sev 1 if large or after notice of departure |
| Your data offered for sale or posted | Any | Sev 1 |

Sev 1: incident commander named within 15 minutes, executive sponsor within 30 minutes, counsel within 2 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Senior incident responder |
| SaaS and data platform lead | CIO or VP engineering | Platform owner for the affected app |
| Legal and Privacy | General counsel | Chief privacy officer |
| HR | Chief people officer | HR business partner |
| Communications | Head of communications | Communications manager |
| Executive sponsor | CEO | COO |
| Customer lead | Chief customer officer | VP customer success |
| Outside counsel | [FILL IN] | [FILL IN] |
| Forensics firm | [FILL IN] | [FILL IN] |
| Cyber insurer | [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | SaaS lead | Legal and Privacy | HR | Comms | Exec sponsor | Customer lead | Outside counsel | Forensics |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I |
| Token and app revocation | A | R | R | I | I | I | I | I | I | C |
| Scope what was taken | A | R | C | C | I | I | I | I | C | R |
| Secrets in exported data | A | R | R | I | I | I | I | I | I | C |
| Insider account action and timing | C | R | C | A | R | I | C | I | R | C |
| Legal hold and preservation | C | C | C | A | C | I | I | I | R | R |
| Demand letters and court action | I | C | I | A | C | I | C | I | R | C |
| Law enforcement referral | C | C | I | A | I | I | C | I | R | I |
| Customer and regulator notices | C | C | I | A | I | C | I | R | R | I |
| Media and staff messages | C | I | I | C | C | A | C | C | C | I |
| Extortion decision | C | C | I | R | I | I | A | C | R | C |
| Post-incident review | A | R | R | R | R | R | C | R | C | C |

## 4. Before an incident

- SaaS inventory with owners, data classes and every integration (connected apps, OAuth grants, API users). [FILL IN]
- Salesforce: restrict who can authorize connected apps; require admin approval for new apps; limit API access by profile and IP; turn on event monitoring for API and report exports. Google and Microsoft: restrict user consent to verified publishers or admin approval.
- Warehouses: MFA for every human user, network policies limiting access to known IP ranges, key pair or OAuth auth for service users, credential rotation, and query history retained.
- Data loss alerts on bulk exports, new personal access tokens, and uploads to personal cloud storage from managed devices.
- Offboarding: access removed at notice for high-risk departures, not only on the last day; devices collected and imaged before reprovisioning; exit interview reminder of confidentiality obligations. [FILL IN high-risk role list]
- Employment and contractor agreements include confidentiality and invention assignment terms and the whistleblower immunity notice required by 18 U.S.C. 1833(b)(3).
- Logs routed to long-term storage: SaaS audit and event logs, warehouse query history, IdP logs, endpoint DLP. [FILL IN]

## 5. Detect

**D1.** On an extortion email, a vendor token notice or a bulk export alert, page the security on-call and the IC. Do not reply to the attacker. Owner: whoever receives it. Target: immediately.

**D2.** Size the claim: compare any sample to source records, find the object or table, and the earliest and latest record dates. Owner: Security lead. Target: 2 hours.

**D3.** Find the access path: which user, connected app, OAuth token, API user or warehouse credential made the reads. Owner: SaaS lead. Target: 4 hours.

```
Salesforce: Setup > Connected Apps OAuth Usage; Event Monitoring logs (API, BulkApi, ReportExport)
Snowflake:
SELECT user_name, client_ip, reported_client_type, first_authentication_factor, second_authentication_factor, event_timestamp
FROM snowflake.account_usage.login_history
WHERE event_timestamp > DATEADD(day, -30, CURRENT_TIMESTAMP()) ORDER BY event_timestamp;
GitHub: organization audit log, filter action:git.clone and action:repo.download_zip
Google Workspace: Admin console > Reporting > Audit > Drive and Token logs
```

**Decision point D-A: declare and name the IC.** Any confirmed export of personal, customer or restricted data is Sev 1. Legal and Privacy records the discovery time and its basis. If the export was logged earlier, that may set a "should have known" time.

## 6. Analyze

**A1.** Build the timeline: first access, every export, last access. Note the gap between theft and extortion. Owner: Forensics with Security lead. Target: 24 hours, then daily.

**A2.** Scope records by data class and by person or customer: personal data, customer confidential data, credentials, trade secrets. Write down what logs cannot prove. Owner: Forensics. Target: 72 hours for a first estimate.

**A3.** Search exported data for secrets: cloud access keys, passwords, API tokens, warehouse credentials in case notes, attachments and custom fields. UNC6395 searched stolen Salesforce data for exactly this. Owner: Security lead. Target: 12 hours.

**A4.** Check for reuse: did any secret from the exported data get used against cloud accounts or other apps? Owner: Security lead. Target: 24 hours.

**A5.** For an insider: reconstruct what the person accessed and copied in the 90 days before notice, from DLP, endpoint, code platform and storage logs, under counsel's direction. Owner: Forensics. Target: 48 hours.

## 7. Contain

**C1. Revoke the access path.** Revoke the connected app or OAuth grant, rotate the integration's credentials, disable the user or API user, and block the source IPs. Owner: SaaS lead. Target: 1 hour.

**Decision point C-A: revoke every token for an integration?** When a vendor reports a token compromise, or one token is confirmed abused, revoke every token for that integration across all platforms, not only the one you saw. Google gave this advice for Drift. The business loses the integration until it is rebuilt; the executive sponsor accepts that on the record.

**C2. Rotate exposed secrets** found in A3, starting with cloud keys and admin credentials. Owner: Security lead. Target: 12 hours.

**C3. Close the vishing path.** Tell staff that IT will never ask them to approve an app or enter a code during a call, and require admin approval for new connected apps. Owner: SaaS lead with Communications. Target: same day.

**C4. Warehouse.** Disable users without MFA, apply network policies, rotate service credentials, and review grants on the affected databases. Owner: SaaS lead. Target: 4 hours.

**Decision point C-B: insider timing.** When the subject still works for you, counsel decides when to cut access. Cutting at once stops further copying; waiting a few hours lets forensics image devices and lets HR and counsel prepare the conversation. Copying in progress or access to the most sensitive data means cut now. Record who decided and why.

## 8. Eradicate

**E1.** Remove every app, grant, token, user and key the attacker created. Owner: SaaS lead.

**E2.** Check for persistence in the IdP if a user account was used (factors, sessions, OAuth grants). Owner: Security lead.

**E3.** For an insider: recover or confirm destruction of company data on personal devices and accounts through counsel, with a forensic examiner's certification where agreed. Owner: Legal and Privacy.

## 9. Recover

**R1.** Rebuild integrations with least privilege scopes, IP restrictions and new credentials. Owner: SaaS lead.

**R2.** Remove secrets from CRM records and other unstructured fields, and add a scanning rule. Owner: Security lead.

**Return to service criteria.** Normal operations resume when the Security lead and SaaS lead sign that:

- The access path is closed and every attacker artifact removed.
- Secrets found in exported data are rotated.
- Integrations are rebuilt with least privilege.
- 72 hours of monitoring show no further access.
- Scoping is written down with what is confirmed, estimated and unknown.

## 10. Evidence preservation and chain of custody

- SaaS audit and event logs, OAuth grant records, warehouse query and login history, exported to storage the attacker never had access to. Some platforms keep these only for days or weeks unless exported.
- Any extortion message with full headers, kept and exported. Never delete it.
- For an insider: forensic images of the laptop and phone before reprovisioning, email and chat exports, badge records, and copies of signed agreements. HR does not wipe or reissue the device.
- A written legal hold to custodians, IT and the relevant vendors.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]
- Forensics works at the direction of outside counsel.

## 11. Regulatory and contractual notification matrix

| Notice | To | Trigger and deadline | Owner |
|---|---|---|---|
| Cyber insurer | Insurer hotline | As soon as practicable. Policy: [FILL IN, assumed 48 hours]. | General counsel |
| Customer DPA notice (processor) | Each affected customer | Per data processing agreement: [FILL IN, assumed 48 hours from awareness]. GDPR Art. 33(2): a processor notifies the controller without undue delay. | Chief privacy officer |
| GDPR (as controller) | Lead supervisory authority | Without undue delay and where feasible within 72 hours of awareness (Art. 33). Individuals without undue delay if high risk (Art. 34). | Chief privacy officer |
| US state breach laws | Residents and attorneys general | If personal information was acquired. Varies; example: Texas AG within 30 days of determining a breach of 250 or more Texas residents. | Outside counsel |
| SEC Form 8-K (if listed) | SEC | Item 1.05 within four business days of a materiality determination; Item 8.01 for voluntary disclosure. | General counsel and CFO |
| NYDFS (if covered) | Superintendent | 72 hours from determination (500.17(a)). | General counsel |
| FBI | Field office or IC3 | Early for extortion; for an insider, after counsel decides (section 14). | General counsel |
| SaaS or integration vendor | Vendor security team | Same day. The vendor may see other affected customers. | SaaS lead |

Trade secret theft without personal data usually starts no regulatory clock. Contracts with customers may still require notice if their confidential information was in scope.

## 12. Ransom and extortion decision procedure

1. Nobody replies to the attacker. Messages go to the IC.
2. Security sizes the claim from samples (section 5).
3. Outside counsel runs an OFAC sanctions screen.
4. Counsel reports to the FBI. The ShinyHunters cluster is under active FBI investigation, with arrests in 2025 and 2026.
5. The insurer confirms consent terms.
6. The executive sponsor presents options to the board: do not engage; engage to learn more; pay for deletion. The board decides. [FILL IN approval authority]
7. Record the decision, the basis and the time.

Payment for deletion buys a promise from a criminal. Salesforce said in 2025 it would not engage, negotiate with or pay any extortion demand, and the group published data said to be from several companies after its deadline. Notice duties do not change with payment.

## 13. Communications templates

**Customer notice (processor to controller)**

> Subject: Security incident affecting data we process for you
>
> On [date] we became aware that an unauthorized party exported records from our [system] using [a compromised integration token or account]. We revoked that access on [date and time].
>
> What we know: [records, data types, date range]. What we do not yet know: [open questions]. We will update you by [date]. Your contact is [name, phone, email].

**Staff note (vishing)**

> IT will never call you to approve a new app, enter a code, or visit a setup page. If anyone asks, hang up and call [FILL IN].

**Regulator note outline**

- Who we are, our role (controller or processor), and the affected service.
- Dates of first access, discovery, containment and this notice.
- How access was obtained and what was exported.
- Data types and number of individuals, confirmed and estimated.
- Measures taken and planned. Contact and next update date.

**Media holding statement**

> [Organization] is investigating unauthorized access to data in one of our business applications. We closed the access, engaged outside experts and notified law enforcement. We are contacting affected customers directly.

## 14. Insider data theft: legal steps

This section pairs with the Crisis Sim template on insider data theft. Counsel leads; these are decisions, not legal requirements.

**L1. Preserve first.** Legal hold to custodians and IT. Image the subject's devices and export their accounts before any confrontation or reprovisioning. Owner: Legal and Privacy with Forensics. Target: before access is cut where possible.

**L2. Check the paper.** Confidentiality, invention assignment and non-solicitation agreements; whether they include the whistleblower immunity notice (without it, exemplary damages and attorney fees under the Defend Trade Secrets Act are not available against that employee); what was taken and whether it qualifies as a trade secret. Owner: Outside counsel.

**L3. Talk to the person.** HR and counsel meet the subject with a written request to return and not use company information, and to identify every copy. Do not threaten criminal referral to get the data back. Owner: HR with counsel.

**Decision point L-A: letter, lawsuit or both?** Options: a demand letter to the person; a letter to the new employer asking it to preserve and quarantine; a civil suit under the DTSA and state law with a request for a temporary restraining order. A DTSA ex parte seizure is available only in extraordinary circumstances, such as a showing that the person would evade an ordinary order and destroy or hide the material. An injunction cannot stop someone from taking a job; it must rest on evidence of threatened misappropriation. Counsel recommends; the executive sponsor decides.

**Decision point L-B: refer to law enforcement?** Referral to the FBI can support a criminal case for trade secret theft. It also means less control over timing and publicity, and evidence may be requested. Counsel recommends; the executive sponsor decides and records why.

**L4. Customers.** If customer data or customer confidential information was taken, the notice duties in section 11 apply as for any other theft.

**L5. Internal message.** Tell the team what they need to know without naming the person or stating conclusions before they are proven. Owner: HR with Communications.

## 15. Post-incident review

Within 30 days of closure:

- Timeline from first access to containment, and the gap between theft and discovery.
- Each decision point (D-A, C-A, C-B, L-A, L-B and any extortion decision): what was decided, when, by whom.
- Which controls would have stopped or detected it: app approval, MFA, network policies, DLP, offboarding timing.
- Notice timeliness against each clock.
- Corrective actions with owners and dates, reported to the board.

## 16. Known gaps and placeholders

- [FILL IN] SaaS inventory and integration owners.
- [FILL IN] high-risk departure list and offboarding steps.
- [FILL IN] DPA notice terms per customer.
- [FILL IN] counsel, forensics and insurer numbers.
- Gap: some SaaS logs are kept for days unless exported. Turn on export now.

## Sources

- NIST SP 800-61r3, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- Google Threat Intelligence Group, "The cost of a call: from voice phishing to data extortion," 2025-06 (updated 2025-08). https://cloud.google.com/blog/topics/threat-intelligence/voice-phishing-data-extortion
- Google Threat Intelligence Group, "Widespread data theft targets Salesforce instances via Salesloft Drift," 2025-08-26 (updated 2025-08-28). https://cloud.google.com/blog/topics/threat-intelligence/data-theft-salesforce-instances-via-salesloft-drift
- Mandiant, "UNC5537 targets Snowflake customer instances for data theft and extortion," 2024-06-10. https://cloud.google.com/blog/topics/threat-intelligence/unc5537-snowflake-data-theft-extortion
- BleepingComputer, "ShinyHunters launches Salesforce data leak site to extort 39 victims," 2025-10. https://www.bleepingcomputer.com/news/security/shinyhunters-starts-leaking-data-stolen-in-salesforce-attacks/
- BleepingComputer, "Salesforce refuses to pay ransom over widespread data theft attacks," 2025-10. https://bleepingcomputer.com/news/security/salesforce-refuses-to-pay-ransom-over-widespread-data-theft-attacks
- BleepingComputer, "ShinyHunters hacker reportedly detained in Jordan, aiding FBI," 2026-10-03. https://www.bleepingcomputer.com/news/security/shinyhunters-hacker-reportedly-detained-in-jordan-aiding-fbi/
- 18 U.S.C. 1836, Defend Trade Secrets Act civil proceedings. https://www.law.cornell.edu/uscode/text/18/1836
- 18 U.S.C. 1833, immunity notice. https://www.law.cornell.edu/uscode/text/18/1833
- GDPR, Regulation (EU) 2016/679. https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- EDPB Guidelines 9/2022 on personal data breach notification, v2.0. https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf
- 23 NYCRR 500.17. https://www.law.cornell.edu/regulations/new-york/23-NYCRR-500.17
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
