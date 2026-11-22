# Ransomware on analytics systems and the PHI warehouse

Quarrystone Health Analytics, Inc. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel, CIO and chief customer officer
- Review cycle: every 12 months, after every exercise that uses it, and after changes to remote access, backup design or customer integrations
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers double extortion ransomware: an attacker enters through remote access without MFA, spends days to weeks inside, steals data from the PHI warehouse and file servers, kills endpoint protection and encrypts Windows servers, Azure VMs and hypervisors, then leaks data in stages to raise pressure. The pattern follows public reporting on Qilin (also called Agenda), which Check Point ranked first by leak site victims for several quarters through Q1 2026 and which absorbed many RansomHub affiliates in 2025.

Reported Qilin behavior used here:

- Sophos X-Ops (2024-08-22): VPN login with valid credentials and no MFA; a domain controller reached about 18 days later; the Default Domain Policy edited to add a logon script, IPScanner.ps1, that harvested Chrome stored credentials from every machine; output staged to SYSVOL per host and exfiltrated; the script ran for three days; logs cleared afterward.
- Trend Micro (2025-10, via The Hacker News): a Linux encryptor run on Windows through WSL; remote tools including AnyDesk, ScreenConnect and Splashtop; a bring your own vulnerable driver (BYOVD) attack with eskle.sys to kill security tools.
- Variants for Windows, Linux and ESXi; disabling vCenter HA and DRS and stealing backup credentials before encryption (vendor summary).

Reference cases: Synnovis (June 2024, pathology provider to London hospitals) and Change Healthcare (February 2024, ALPHV). Both show what a business associate faces: customers losing services, patient safety effects, a partial leak, and a scoping effort that runs for months.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0: detect, analyze, contain, eradicate, recover and post-incident review. Step owners and time targets are starting points; adjust them to your staffing.

In scope: the SSL VPN and contractor access, on-premises AD and the VMware cluster, domain joined Azure analytics VMs, Azure domain controllers, the Databricks PHI warehouse, legacy SQL Server analytics, customer integrations (SFTP, APIs and site to site VPNs), Azure Backup and the on-premises backup appliance.

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Defender for Endpoint sensors go inactive on many servers at once | 10 or more within 15 minutes | Sev 1 |
| Kernel driver service installed outside a change (System event 7045, kernel mode driver) | Any on a server | Sev 1 |
| Security log cleared (Security event 1102) | Any on a domain controller or server | Sev 1 |
| Change to the Default Domain Policy or any GPO that adds a logon script (Security event 5136) | Any outside a change | Sev 1 |
| Ransom note or mass file renaming | Any | Sev 1 |
| VPN login without MFA from a new IP or country | Any for a contractor or admin account | Sev 2 |
| Egress from the warehouse or SQL servers to an unknown destination | More than 50 GB in a day | Sev 1 |
| Customer reports care delays linked to Quarrystone outputs | Any | Sev 1, patient safety track opens |

Sev 1: incident commander within 15 minutes, executive sponsor within 30 minutes, counsel, IR retainer and insurer within 2 hours, FBI the same day.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Senior detection engineer |
| Cloud and IT lead | CIO | Infrastructure manager |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | VP Communications | Communications manager |
| Executive sponsor | CEO | CFO |
| Customer Success | Chief customer officer | VP customer support |
| Clinical liaison | Chief medical informatics officer [FILL IN] | [FILL IN] |
| Outside counsel | Ressler Kemp LLP [FILL IN] | [FILL IN] |
| IR retainer | Kestrel Point Incident Response [FILL IN] | [FILL IN] |
| Cyber insurer | Halbrook Specialty [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | Cloud and IT | Legal and Privacy | Comms | Exec sponsor | Customer Success | Outside counsel | IR retainer | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I |
| Protect what still works | A | R | R | I | I | I | I | I | C | I |
| Customer integrations decision | C | C | R | C | I | A | R | I | C | I |
| Patient safety support | C | I | C | C | C | A | R | I | I | I |
| Credential reset after harvest | A | R | R | I | I | I | C | I | C | I |
| Scope of stolen data | A | R | C | C | I | I | I | C | R | I |
| BAA and HIPAA notices | C | C | I | A | C | I | R | R | I | I |
| Ransom decision | C | C | C | R | I | A | I | R | C | C |
| Materiality determination | C | C | I | R | I | A | I | R | I | I |
| Leak response and media | C | R | I | C | A | C | C | C | R | I |
| Recovery and return to service | A | R | R | I | I | I | C | I | C | I |
| Post-incident review | A | R | R | R | R | C | R | C | C | I |

## 4. Before an incident

- MFA on every remote access path, including contractor VPN accounts and the legacy SSL VPN. Change Healthcare's attackers used a Citrix portal without MFA; the Sophos Qilin case used a VPN without MFA.
- Chrome password storage disabled by policy on domain machines, and enterprise password management for staff.
- GPO changes on the Default Domain Policy and logon scripts alert the SOC.
- Defender for Endpoint tamper protection on, and the vulnerable driver blocklist enforced.
- Backups: Azure Backup with soft delete and an immutable vault locked; the on-premises backup appliance off the production domain with separate credentials and an offline or immutable copy.
- A list of customers whose care operations depend on Quarrystone outputs (worklists, alerts, lab follow-up), with a clinical contact at each, and a manual extract procedure. [FILL IN list owner]
- Customer integration inventory: every SFTP drop, API key and site to site VPN, with a way to cut each one quickly.

## 5. Detect

**D1.** When many sensors go dark together, assume an EDR killer, not an outage. Check for new kernel driver services and cleared logs on the first hosts to go silent. Owner: Security lead. Target: 15 minutes.

```
DeviceEvents
| where Timestamp > ago(1d)
| where ActionType in ("DriverLoad", "ServiceInstalled")
| project Timestamp, DeviceName, ActionType, FileName, FolderPath, InitiatingProcessAccountName
| order by Timestamp asc
```

**D2.** Confirm encryption scope: on-premises hypervisors, Windows servers, Azure VMs. Record which systems still work, especially Azure domain controllers, the Databricks warehouse and backups. Owner: Cloud and IT lead. Target: 30 minutes.

**D3.** Collect the ransom note and any chat portal details without using them. Owner: Security lead. Target: 30 minutes.

**Decision point D-A: declare Sev 1 and open the patient safety track?** Declare Sev 1 on any ransom note or mass encryption. Open the patient safety track if any customer uses outputs for care operations and those outputs are interrupted.

## 6. Analyze

**A1.** Find the entry point. Review VPN logs for logins without MFA, especially contractor accounts, for the last 30 days at least. Owner: IR retainer with Security lead. Target: 8 hours.

**A2.** Look for the GPO credential harvest: Security event 5136 on the Default Domain Policy, new logon scripts in SYSVOL, and per host output files. If found, assume every password saved in Chrome on a domain machine is known to the attacker. That includes passwords for customer portals, cloud consoles and the warehouse. Owner: Security lead. Target: 8 hours.

**A3.** Find remote tools and persistence: AnyDesk, ScreenConnect, Splashtop, Atera and other RMM agents, new services and scheduled tasks, new accounts. Owner: Security lead. Target: 24 hours.

**A4.** Scope exfiltration: Databricks audit logs, SQL Server logs, file server access, network egress and destination IPs. Map tables and files to customers. Owner: IR retainer. Target: first estimate in 24 hours, then daily for as long as it takes.

**A5.** Scope will be slow. Synnovis said its data investigation took over a year because the stolen data was fragmented. Plan for a first notice on known facts and a schedule of supplements, not a single final list.

## 7. Contain

**C1. Protect what still works.** Cut network paths from on-premises to the Azure domain controllers and the warehouse, close the VPN, and take the on-premises backup appliance off the production network. Owner: Cloud and IT lead. Target: 1 hour.

**C2. Do not power off encrypted systems.** Isolate them on the network and leave them as they are for the IR retainer, unless the IC records a reason. Capture memory and disk from a sample of encrypted hosts before any rebuild. Owner: Security lead. Target: 4 hours.

**C3. Rotate warehouse and cloud credentials.** Rotate credentials the analytics VMs used to reach Databricks and storage, rotate storage account keys (key1 and key2), and revoke Databricks tokens issued to service accounts. Owner: Cloud and IT lead. Target: 4 hours.

**Decision point C-A: disconnect customer integrations?** Disconnect every integration into the affected environment when encryption or attacker access reaches systems that exchange data with customers, or when harvested credentials include customer access. Change Healthcare disconnected its systems on the day it found the attack. Call each customer before or as the connection is cut; do not let them learn from failed jobs. The executive sponsor approves and the time is recorded.

**C4. Credentials after a harvest.** Force password resets for every user who logged on to a domain machine while the harvest ran, reset service account passwords, reset krbtgt twice, and revoke Entra sessions for privileged users. Tell each customer which of its portal or SFTP credentials were saved on Quarrystone machines so it can rotate them. Owner: Security lead with Customer Success. Target: 24 hours.

```
Revoke-MgUserSignInSession -UserId <upn>
Update-MgUser -UserId <upn> -AccountEnabled:$false
az storage account keys renew --account-name <account> --resource-group <rg> --key key1
az storage account keys renew --account-name <account> --resource-group <rg> --key key2
```

**C5. Remove the harvest.** Image SYSVOL first, then remove the logon script and restore the Default Domain Policy from a known good backup. Owner: Cloud and IT lead. Target: 24 hours.

**C6. Remote access.** Keep the SSL VPN off. Move contractors to a path that requires MFA and device checks. Owner: Cloud and IT lead. Target: before any contractor access resumes.

## 8. Eradicate

**E1.** Rebuild domain controllers, hypervisors and encrypted servers from clean media. Do not decrypt and reuse hosts unless the IR retainer signs off. Owner: Cloud and IT lead.

**E2.** Remove every remote tool and persistence item from the A3 list across the estate, including Azure VMs. Owner: Security lead.

**E3.** Enforce the vulnerable driver blocklist and tamper protection before reconnecting any host. Owner: Security lead.

**E4.** Rebuild the backup appliance with separate credentials, off the production domain. Owner: Cloud and IT lead.

## 9. Recover

**R1. Restore order.** Unless the IC records otherwise: identity (clean domain controllers), the warehouse and its pipelines, outputs that customers use for care operations, then other dashboards and reports. Customers in the patient safety track come first within each tier. Owner: Cloud and IT lead.

**Decision point R-A: restore priorities for patient safety.** If a customer reports care delays, move that customer's clinical outputs to the top of the restore order even if it delays larger customers, and record why. In June 2025 King's College Hospital said a long wait for a blood test result during the Synnovis attack was among the factors in a patient's death. Offer a validated manual extract from a clean source with a named on-call contact while restores run.

**R2. Restore from clean sources.** Restore Azure VMs from recovery points that predate the intrusion, not only the encryption. The attacker may have been inside for weeks. Check Azure Backup soft delete (14 days default) and immutable vault state first.

**R3. Validate.** Compare restored data with record counts and checksums from before the intrusion where they exist, and with customer resubmissions where they do not.

**Return to service criteria.** A customer reconnects only when the Security lead and Cloud and IT lead sign, and the IC approves, that:

- The systems serving that customer are rebuilt or restored from clean sources and carry Defender for Endpoint with tamper protection.
- No attacker activity in 72 hours of monitoring.
- Every credential that customer shares with Quarrystone has been rotated by both sides.
- The integration uses MFA or certificate based access and is limited to known IPs.
- The customer has a written summary of what was restored and what was not.

## 10. Evidence preservation and chain of custody

- Memory and disk images from a sample of encrypted hosts, domain controllers and the first hosts to go dark.
- VPN logs, domain controller security logs, SYSVOL image, Defender XDR incidents, Databricks audit logs and network flow logs.
- Ransom notes and chat portal details, collected without logging in.
- Leak site and Telegram captures, collected by the IR retainer through counsel.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]
- The IR retainer works at the direction of outside counsel.

## 11. Regulatory and contractual notification matrix

Discovery: at the time of impact at the latest, or earlier if a GPO change or exfiltration alert was seen and not acted on. Under 45 CFR 164.410 discovery is when any workforce member knew or with reasonable diligence would have known. Legal and Privacy records the time and basis.

Ransomware: OCR's 2016 fact sheet treats ransomware encryption of ePHI as a presumed breach unless a documented four-factor assessment shows a low probability of compromise. With confirmed exfiltration, plan on breach.

The 60 day outer limit applies even when scoping is incomplete. Send what is known before day 60 and supplement on a written schedule.

| Notice | To | Trigger and deadline | How | Owner |
|---|---|---|---|---|
| Cyber insurer | Halbrook Specialty | As soon as practicable. Policy: [FILL IN, assumed 48 hours]. Written consent before any payment; panel negotiator. | Hotline and written notice | General counsel |
| BAA incident notice (contractual) | Every covered entity whose PHI was on affected systems | 5 business days from discovery under current BAAs [FILL IN per customer] | Written notice and a call from the named owner | Chief privacy officer |
| HIPAA breach notice to covered entities | Affected covered entities | No later than 60 calendar days after discovery. Identify each affected individual to the extent possible. Supplement as scoping continues. | Written notice and supplements | Chief privacy officer |
| Individual, HHS and media notice | Patients, HHS, media | Covered entity's duty, delegable to Quarrystone. Only one entity needs to notify (OCR Change Healthcare FAQ, updated 2024-05-31). HHS with individual notice for 500 or more; media where more than 500 residents of a state. | Delegation in writing per customer | Chief privacy officer |
| Texas attorney general | Texas AG | No later than 30 days after determining a breach of 250 or more Texas residents, through the online form. Counsel confirms who files. | Online form | General counsel |
| Other states | State AGs | Varies. Many exempt or deem compliant HIPAA entities; check each state. | Per state | Outside counsel |
| SEC Form 8-K | SEC | Item 1.05 within four business days of a materiality determination, made without unreasonable delay. Item 8.01 for voluntary disclosure before a determination. | EDGAR | General counsel and CFO |
| FBI | Field office or IC3 | Same day. OFAC counts prompt reporting as a significant mitigating factor. | [FILL IN] | General counsel |
| CISA | CISA | Voluntary today. CIRCIA is not yet in effect; proposed clocks are 72 hours for covered incidents and 24 hours for ransom payments. Check status. | Portal | Security lead |
| HHS OCR data requests | OCR | As stated in the letter | Through counsel | General counsel |

Public customers: health plan and hospital customers that are public may make their own disclosure decisions based on what Quarrystone tells them. Share timing through counsel under NDA.

## 12. Ransom and extortion decision procedure

1. Nobody uses the chat portal or replies except the panel negotiator, if the board approves engagement.
2. Outside counsel runs an OFAC sanctions screen of the actor and wallet. Payment to a sanctioned person can violate sanctions on a strict liability basis. A clean screen does not prove who controls a wallet.
3. Counsel notifies the FBI and shares indicators.
4. The insurer confirms in writing its consent terms and panel negotiator.
5. The Cloud and IT lead gives a written restore timeline without the decryptor, by customer tier, with assumptions.
6. The executive sponsor presents options to the board with the facts above. The board decides and the vote and reasons are recorded. [FILL IN approval authority and limit]
7. Payment does not end notice duties, does not remove data already published, and does not prevent a second extortion. Change Healthcare reportedly paid $22 million; another group later claimed to hold the data. Synnovis reportedly did not pay a demand of about $50 million, and about 400 GB was published about 17 days after the attack.
8. If data is published, the decision is reviewed with the board on the record. Publication alone is not a reason to pay.

## 13. Communications templates

**Internal holding note (staff)**

> Subject: Ransomware incident and what to do today
>
> We are responding to a ransomware attack that has taken down many of our systems and customer services. Do not turn on, restart or reconnect any computer or server unless IT asks you to. Do not use the company VPN.
>
> Customers and reporters may contact you. Send them to [FILL IN]. Do not discuss the incident outside the company or online. Next update by [time] through [FILL IN channel].

**Customer notice (covered entity), first notice under the BAA**

> Subject: Notice of security incident under our business associate agreement
>
> On [date] we discovered a ransomware attack on our systems. The attacker encrypted systems that process your data and copied data from our analytics warehouse before encrypting.
>
> What we know: [facts, data types, date range]. What we do not yet know: [which of your patients are affected]. We disconnected your integration on [date and time] to protect your systems. The following credentials of yours were saved on our systems and should be rotated: [list].
>
> We will send supplements on [schedule] as our investigation identifies affected individuals. We can send notices to individuals, HHS and media on your behalf if you ask us to in writing. Your contact is [name, phone, email].

**Clinical customer note (patient safety track)**

> Our daily [worklist or alert] for your organization is unavailable. We expect it back by [date range]. Until then we can provide a manual extract from a clean source each morning by [time]. Your 24 hour contact is [name, phone].

**Regulator note outline (OCR)**

- Our role as a business associate and the covered entities affected.
- Dates: initial access (best estimate), discovery, containment, notice to each covered entity.
- How access was obtained (remote access without MFA) and what was encrypted and copied.
- Types of PHI and number of individuals, confirmed and estimated, and the scoping schedule.
- Our most recent risk analysis and the changes since: MFA on all remote access, credential storage, backups.
- Contact for follow-up.

**Media holding statement**

> Quarrystone Health Analytics is responding to a ransomware attack that has disrupted services to our healthcare customers. We contained the attack, engaged outside experts and notified law enforcement. We are working with each customer, including on support for patient care, and will share more as our investigation allows.

## 14. Post-incident review

Within 30 days of return to service, led by someone outside the response:

- Timeline from VPN login to recovery, and why the dwell time went unseen.
- Each decision point (D-A, C-A, R-A, the ransom decision and the materiality determination): what was decided, when, by whom.
- Patient safety: which customers were affected, what support was given, and how fast.
- Notice timeliness against each clock in section 11, including supplements after day 60.
- Corrective actions with owners and dates, reported to the board: MFA on every remote path, removal of browser password storage, Tier 0 monitoring, locked immutable backups.
- Update the risk analysis. OCR's ransomware settlements usually turn on it.

## 15. Known gaps and placeholders

- [FILL IN] clinical customer list, contacts and manual extract procedure.
- [FILL IN] customer integration inventory and the fastest way to cut each one.
- [FILL IN] counsel, IR retainer, insurer and FBI contacts.
- [FILL IN] payment approval authority.
- Gap: the legacy SSL VPN does not enforce MFA for contractor accounts.
- Gap: the on-premises backup appliance shares the production domain.

## Sources

- Sophos X-Ops, "Qilin ransomware caught stealing credentials stored in Google Chrome," 2024-08-22. https://news.sophos.com/en-us/2024/08/22/qilin-ransomware-caught-stealing-credentials-stored-in-google-chrome/
- The Hacker News, "Qilin ransomware combines Linux payload with BYOVD exploit," 2025-10. https://thehackernews.com/2025/10/qilin-ransomware-combines-linux-payload.html
- Becker's Hospital Review, "Qilin ransomware racks up 168 healthcare victims," 2026. https://www.beckershospitalreview.com/healthcare-information-technology/cybersecurity/qilin-ransomware-racks-up-168-healthcare-victims/
- Infosecurity Magazine, "Synnovis: Qilin publishes NHS patient data," 2024-06. https://www.infosecurity-magazine.com/news/synnovis-publish-nhs-patient-data
- ITPro, "Thousands of procedures canceled at London hospitals as Qilin releases blood test data," 2024-06. https://itpro.com/security/cyber-attacks/thousands-of-procedures-canceled-at-london-hospitals-as-qilin-releases-blood-test-data
- The Record, "Ransomware attack contributed to patient's death, says Britain's NHS," 2025-06. https://therecord.media/ransomware-attack-contributed-patient-death-uk-nhs
- The Register, "NHS supplier ends probe into ransomware attack that contributed to patient death," 2025-11-13. https://www.theregister.com/2025/11/13/synnovis_qilin_investigation/
- Testimony of Andrew Witty, Senate Finance Committee, 2024-05-01. https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf
- CSO Online, "UnitedHealth hackers exploited Citrix vulnerabilities, CEO to testify," 2024. https://www.csoonline.com/article/2096621/unitedhealth-hackers-exploited-citrix-vulnerabilities-ceo-to-testify.html
- Healthcare IT News, "New numbers: Change Healthcare data breach 193 million affected," 2025. https://healthcareitnews.com/news/new-numbers-change-healthcare-data-breach-193-million-affected
- HHS OCR, Change Healthcare Cybersecurity Incident FAQ (not re-verified). https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html
- HHS, Ransomware Fact Sheet (not re-verified). https://www.hhs.gov/sites/default/files/RansomwareFactSheet.pdf
- Baird Holm, summary of the OCR ransomware fact sheet. https://www.bairdholm.com/blog/new-ocr-ransomware-fact-sheet-explains-a-covered-entitys-obligations
- Hunton, HHS ransomware settlements and the Risk Analysis Initiative. https://www.hunton.com/privacy-and-cybersecurity-law-blog/hhs-announces-additional-settlements-following-ransomware-attacks-including-first-enforcement-under-risk-analysis-initiative
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Greenberg Traurig, "SEC clarifies confusion concerning cybersecurity incident reporting," 2024-05. https://www.gtlaw.com/ar/insights/2024/5/sec-clarifies-confusion-concerning-cybersecurity-incident-reporting
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Covington Inside Privacy, CISA submits final CIRCIA rule for OMB review. https://www.insideprivacy.com/critical-infrastructure/cisa-submits-final-circia-rule-for-omb-review/
- Microsoft Learn, Azure Backup secure by default. https://learn.microsoft.com/en-us/azure/backup/secure-by-default
- Microsoft Learn, Immutable vault for Azure Backup. https://learn.microsoft.com/en-us/azure/backup/backup-azure-immutable-vault-concept
- Microsoft Learn, Revoke user access in Entra ID. https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access
