# Ransomware and extortion response

[FILL IN organization name]. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and CIO
- Review cycle: every 12 months, after every exercise that uses it, and after any major change to backups, virtualization or identity
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers ransomware and data extortion against an enterprise that runs a mix of on-premises servers, VMware ESXi hosts, Windows and Linux workloads, and cloud accounts in AWS, Azure or Google Cloud. It covers encryption, data theft with a leak threat, and both together (double extortion). Section 14 adds steps for healthcare providers, where encryption can reach patient care.

The patterns in this playbook come from current public reporting:

- Qilin, the most active ransomware brand by leak site victims for several quarters through early 2026, entered one victim through a VPN account without MFA, reached a domain controller about 18 days later, and edited the Default Domain Policy so a logon script harvested Chrome stored credentials from every machine (Sophos, 2024). Later Qilin cases used a vulnerable kernel driver to kill security tools, remote management tools for persistence, and encryptors for Windows, Linux and ESXi (Trend Micro, 2025).
- INC Ransom, still among the most active groups in 2026, stole about 3 TB from NHS Dumfries and Galloway in 2024, posted a sample, then leaked clinical data including children's mental health records.
- Akira and LockBit are active with ESXi encryptors. LockBit was disrupted in 2024 but launched a new version with ESXi builds in September 2025.
- Change Healthcare (2024): stolen credentials on a remote access portal without MFA, nine days of lateral movement and theft, then encryption. The company disconnected its systems on the day of encryption.

Plan for the techniques, not the brand. Brands rename and affiliates move between them.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0: detect, analyze, contain, eradicate, recover and post-incident review. Owners and time targets are starting points; adjust them to your staffing.

In scope:

- Windows and Linux servers, ESXi hosts and vCenter, Active Directory, Entra ID or another identity provider.
- Backup systems: backup servers and appliances, immutable or offline copies, cloud snapshots and vaults.
- Cloud accounts reachable with credentials found on premises.
- Notice duties under privacy, sector and securities rules, contracts and insurance.

Out of scope: identity provider takeover without encryption (use Identity provider compromise response), SaaS data theft without encryption (use SaaS data theft and extortion response).

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Ransom note, encrypted file extensions or mass file renames | Any host | Sev 1 |
| EDR sensors stop reporting from many hosts at once | 10 or more hosts in 15 minutes | Sev 1 |
| ESXi host or vCenter unreachable together with guest VMs | Any not matched to a change | Sev 1 |
| Backup jobs deleted, retention shortened or immutability disabled | Any | Sev 1 |
| New kernel driver service or security tool tampering alert | Any on a server | Sev 2, Sev 1 if on more than one host |
| GPO change adding a logon script or scheduled task | Any not matched to a change | Sev 2 |
| Large outbound transfer to a cloud storage or file sharing service from a server | Over 50 GB in a day, or any use of rclone, MEGA or similar | Sev 2 |
| Extortion email, call or chat claiming stolen data | Any | Sev 1 until the claim is sized |

Sev 1: incident commander named within 15 minutes, executive sponsor within 30 minutes, counsel and IR retainer within 2 hours. [FILL IN thresholds that fit your estate]

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Senior incident responder |
| IT and infrastructure lead | CIO | Infrastructure manager |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | Head of communications | Communications manager |
| Executive sponsor | CEO | COO or CFO |
| Operations lead (business or clinical) | COO, or chief nursing officer for a hospital | Deputy |
| Finance | CFO | Controller |
| Outside counsel | [FILL IN] | [FILL IN] |
| IR retainer | [FILL IN] | [FILL IN] |
| Cyber insurer | [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | IT | Legal and Privacy | Comms | Exec sponsor | Operations | Finance | Outside counsel | IR retainer | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I | I |
| Network isolation and internet cut | A | R | R | I | I | C | C | I | I | C | I |
| Hypervisor and backup protection | A | C | R | I | I | I | I | I | I | C | I |
| Evidence preservation | A | R | C | C | I | I | I | I | C | R | I |
| Downtime procedures and operations continuity | C | I | C | I | C | A | R | C | I | I | I |
| Scope of data theft | A | R | C | C | I | I | I | I | C | R | I |
| Notices to regulators and individuals | C | C | I | A | C | I | I | I | R | I | I |
| Media, staff and customer messages | C | I | I | C | A | C | C | I | C | I | I |
| Restore order | C | C | R | I | I | A | R | C | I | C | I |
| Ransom decision | C | C | C | R | I | A | C | R | R | C | C |
| Materiality determination (if listed) | C | C | I | R | I | A | I | R | R | I | I |
| Post-incident review | A | R | R | R | R | C | R | C | C | C | I |

## 4. Before an incident

- MFA on every remote access path: VPN, Citrix, RDP gateways, remote management tools. Both Qilin and Change Healthcare began with a remote access login that had no MFA.
- EDR on every server, including backup servers, identity sync servers and jump hosts, with tamper protection on.
- ESXi: management interfaces on an isolated network, SSH and the ESXi Shell off by default, lockdown mode on, vCenter not joined to the production domain, and hypervisor logs sent to the SIEM. [FILL IN owner]
- Backups: at least one copy immutable or offline, with credentials not stored in or reachable from the domain. Restore tests every quarter, timed against the RTO. Cloud examples: AWS Backup Vault Lock or S3 Object Lock in compliance mode; Azure Backup immutable vault locked, with soft delete; Google Cloud backup vaults with enforced retention. [FILL IN backup architecture]
- Chrome and Edge password storage disabled by policy on domain machines.
- Out-of-band coordination: phone bridge and chat outside the corporate tenant, offline contact roster, printed copy of this playbook. [FILL IN]
- Downtime procedures written and drilled for every critical business process. [FILL IN process list]
- Insurer, counsel and IR retainer numbers on the offline roster.
- Decide in advance who can authorize cutting internet access and disconnecting partners. [FILL IN authority]

## 5. Detect

**D1.** On any Sev 1 signal, page the security on-call and the IC. The person who sees the signal does not reboot, wipe or log off the host. Owner: whoever sees it. Target: immediately.

**D2.** Confirm the scope of encryption: which hosts show notes or renamed files, which ESXi hosts and datastores are affected, whether domain controllers are encrypted, and whether cloud workloads are affected. Owner: Security lead with IT lead. Target: 30 minutes.

**D3.** Check backups first. Before anything else is restored or rebuilt, confirm which backup copies exist, whether jobs or retention were changed, and whether immutable or offline copies are intact. Owner: IT lead. Target: 1 hour.

**D4.** Look for the precursors: security tool tampering, new kernel driver services, cleared event logs (Security 1102), GPO changes, remote management tools that are not yours (AnyDesk, ScreenConnect, Atera, Splashtop), and large outbound transfers. Owner: Security lead. Target: 2 hours.

```
# Windows: services installed in the last 30 days, including kernel drivers
Get-WinEvent -FilterHashtable @{LogName='System'; Id=7045; StartTime=(Get-Date).AddDays(-30)} |
  Select-Object TimeCreated, @{n='Service';e={$_.Properties[0].Value}}, @{n='Path';e={$_.Properties[1].Value}}

# GPO changes in the last 30 days
Get-GPO -All | Where-Object { $_.ModificationTime -gt (Get-Date).AddDays(-30) } | Select DisplayName, ModificationTime
```

**Decision point D-A: declare Sev 1 and name the IC.** Any confirmed encryption is Sev 1. The IC records the time of declaration. Legal and Privacy records the earliest time anyone in the organization knew of the attack, which may start notice clocks (section 11).

## 6. Analyze

**A1.** Build a first timeline from initial access to encryption. Typical gaps are days to weeks: about 18 days to a domain controller in the Sophos Qilin case, nine days from entry to encryption at Change Healthcare. Owner: IR retainer with Security lead. Target: 24 hours, then daily.

**A2.** Find the entry point: remote access logs, edge device logs, phishing, or an exposed service. Check every remote access login without MFA in the last 60 days. Owner: Security lead. Target: 12 hours.

**A3.** Size data theft: egress volumes by host and destination, staging folders, archive files, use of rclone or cloud storage clients, and any sample the attacker sent. Map stolen paths to data types (personal data, health data, payment data, trade secrets, customer data). Owner: IR retainer. Target: 72 hours for a first estimate.

**A4.** List credentials the attacker could have taken: domain hashes (DCSync), browser stored passwords, password manager files, service account secrets in scripts, cloud access keys on servers, and backup system credentials. Owner: Security lead. Target: 24 hours.

**A5.** Check cloud accounts reachable with those credentials. AWS: CloudTrail for new IAM users, access keys, `DeleteBucket`, `PutBucketLifecycleConfiguration`, KMS key deletion scheduling and snapshot deletion. Azure: activity log for role assignments, `listKeys`, lock and immutability policy deletion. Google Cloud: audit logs for service account key creation and bucket changes. Owner: Security lead. Target: 12 hours.

## 7. Contain

**C1. Isolate.** Use EDR to isolate encrypted and suspicious hosts. Where EDR is blind, isolate by switch port, VLAN or security group. Do not power off encrypted hosts unless encryption is still running and cannot be stopped another way: memory holds keys, tools and evidence. Owner: Security lead. Target: 30 minutes.

**Decision point C-A: cut internet access and partner connections?** Cut internet egress and site-to-site links when encryption is spreading, data is still leaving, or the attacker has interactive control you cannot see. Keep connections needed for safety or for out-of-band coordination. The executive sponsor approves; the IC records the time and reason. Tell each partner by phone before or as the link drops. Change Healthcare disconnected on day one. Leaving connections open so business continues is a decision with a name and a time on it, not a default.

**C2. Protect what still works.** Take the backup system off the domain network, change backup system credentials from a clean workstation, and lock immutable copies if they are not locked. Protect domain controllers that are not encrypted by limiting their network paths. Owner: IT lead. Target: 1 hour.

**C3. Hypervisors.** For ESXi hosts that are still running: enable lockdown mode, stop SSH and the ESXi Shell, and change root passwords from vCenter or the host client. For encrypted hosts, keep them off the network and leave them as they are for forensics. Owner: IT lead. Target: 2 hours.

```
# On a running ESXi host (from the console or a trusted session)
esxcli network firewall ruleset list
vim-cmd hostsvc/disable_ssh
vim-cmd hostsvc/disable_esx_shell
esxcli vm process list
```

**Decision point C-B: shut down the hypervisor estate?** Shutting down every ESXi host stops encryption but destroys memory and can corrupt VMs mid write. Shut down only hosts where encryption is in progress and cannot be stopped by network isolation. The IT lead decides with the IC.

**C4. Credentials.** Disable accounts the attacker used. Reset krbtgt twice, with the replication interval between resets. Reset service account and administrator passwords from a clean admin workstation. Revoke cloud access keys found on compromised servers. Owner: Security lead. Target: 12 hours.

```
# AWS: deactivate an access key found on a compromised server
aws iam update-access-key --user-name <user> --access-key-id <key-id> --status Inactive
# Entra ID: revoke sessions for an account the attacker used
Revoke-MgUserSignInSession -UserId <upn>
```

**C5. Block the remote management tools** the attacker used at the firewall and with EDR, and close the entry point (disable the VPN account, patch or take down the edge device). Owner: Security lead. Target: 4 hours.

**C6. Move the response out of band** if email, chat or identity is affected or the attacker may be watching. Verify each person before adding them to the bridge. Owner: Communications with Security lead. Target: 1 hour.

## 8. Eradicate

**E1.** Remove every persistence item found in analysis: GPO changes, scheduled tasks, services, remote management tools, new accounts, web shells and cloud identities. Image SYSVOL before removing GPO changes. Owner: Security lead.

**E2.** Rebuild domain controllers from known good backups or promote new ones, depending on the IR retainer's assessment of Active Directory. Owner: IT lead.

**E3.** Rebuild ESXi hosts from installation media, not from the encrypted install. Rebuild vCenter if its credentials were exposed. Owner: IT lead.

**E4.** Rotate every credential in the A4 list, including browser stored passwords that reach outside systems (partner portals, banks, SaaS). Tell partners whose credentials were saved on your machines. Owner: Security lead.

## 9. Recover

**R1.** Restore from the newest backup that predates the intrusion, not the newest backup. A backup taken after entry may contain the attacker's tools. Scan restored systems with updated EDR before reconnecting. Owner: IT lead.

**Decision point R-A: restore order.** The executive sponsor approves a restore order set by business or clinical need, not by who complains first. Typical order: identity and DNS, security tooling, backup system, safety and life critical systems, revenue critical systems, then the rest. [FILL IN tier list] Record any change to the order and why.

**R2.** Reconnect partners one at a time, after a written validation (section 9 criteria) and a call to the partner. Owner: IT lead with Operations lead.

**R3.** Keep heightened monitoring for 30 days: new admin accounts, remote management installs, outbound transfers, GPO changes. Owner: Security lead.

**Return to service criteria.** A system or partner connection returns when the Security lead and IT lead sign that:

- The entry point is closed and every persistence item is removed and verified.
- The system was rebuilt or restored from a backup that predates the intrusion and passed integrity checks.
- EDR is running with tamper protection and reporting.
- Credentials in its scope were rotated.
- No attacker activity in 72 hours of monitoring.
- The business owner tested the system and accepts it.

## 10. Evidence preservation and chain of custody

- Memory and disk images from a sample of encrypted hosts, the first host to go dark, and any host with the entry point or staging folders.
- A copy of every ransom note, an encrypted file sample with its original if one exists, and the encryptor binary if found.
- Firewall, VPN, proxy, DNS and EDR logs from at least 60 days before the first sign, exported to storage the attacker never reached.
- ESXi and vCenter logs before any rebuild.
- Cloud audit logs (CloudTrail, Azure activity log, Google Cloud audit logs) exported for the same window.
- Every extortion message with full headers or chat transcripts, kept and exported. Never delete them.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]
- The IR retainer works at the direction of outside counsel to protect privilege.

## 11. Regulatory and contractual notification matrix

Clocks start at awareness, discovery or determination as each rule defines it, not when forensics finishes. Send what is known and supplement. Legal and Privacy keeps one register of every clock with its start time and basis. [FILL IN jurisdictions and sectors that apply]

| Notice | To | Trigger and deadline | Owner |
|---|---|---|---|
| Cyber insurer | Insurer hotline | As soon as practicable, often a condition of cover. Policy: [FILL IN, assumed 48 hours]. Panel vendors or written consent. | General counsel |
| FBI | Field office or IC3 | Early. OFAC treats prompt reporting and cooperation as a significant mitigating factor. | General counsel |
| CISA | CISA | Voluntary today. CIRCIA final rule sent for review 2026-10-01, not yet in effect: proposed 72 hours for covered incidents and 24 hours for ransom payments. Check status. | Security lead |
| SEC Form 8-K (if listed) | SEC | Item 1.05 within four business days of a materiality determination, made without unreasonable delay. Item 8.01 for voluntary disclosure before a determination. | General counsel and CFO |
| NYDFS (if covered) | Superintendent | 72 hours from determining a reportable incident (500.17(a)). Extortion payment: 24 hours from payment and a written explanation within 30 days (500.17(c)). | General counsel |
| GDPR (if EU or UK personal data) | Lead supervisory authority | Without undue delay and where feasible within 72 hours of awareness (Art. 33). Individuals without undue delay if high risk (Art. 34). | Chief privacy officer |
| HIPAA (if health data) | Individuals, HHS, media, or covered entities | See section 14. Encryption of ePHI is a presumed breach unless a documented four-factor assessment shows low probability of compromise. | Chief privacy officer |
| US state breach laws | Residents and attorneys general | Varies. Example: Texas AG within 30 days of determining a breach of 250 or more Texas residents. | Outside counsel |
| Customers and partners | Per contract | [FILL IN contract notice terms] | Legal and Privacy |

## 12. Ransom and extortion decision procedure

1. Nobody contacts the attacker or opens the negotiation portal without the IC's approval. Staff forward messages to the IC through the out-of-band channel.
2. Security preserves every message and checks any sample against source systems to size the claim.
3. Outside counsel runs an OFAC sanctions screen on the group, wallet and any known affiliates. Payment to a sanctioned person can violate sanctions on a strict liability basis. OFAC strongly discourages payment.
4. Counsel reports to the FBI and shares indicators.
5. The insurer confirms consent terms and its panel negotiator. Most policies require written consent before any payment.
6. The IT lead gives a written restore estimate without a decryptor, by business tier, with assumptions.
7. The executive sponsor presents options to the board: do not pay; engage to buy time while restoring; pay for a decryptor; pay for deletion of stolen data. The board decides. [FILL IN approval authority]
8. Record the decision, who made it, the basis and the time.
9. If payment is made: NYDFS 24 hour report where it applies, CIRCIA payment report once in effect, and FinCEN reporting by the financial institution that moves the funds.

What the record should say: payment does not undo theft, does not end any notice duty, and does not guarantee deletion. Change Healthcare reportedly paid $22 million in 2024, after which its affiliate was exit scammed by ALPHV and another group claimed to hold the data. Synnovis did not pay a reported $50 million demand and about 400 GB was published about two weeks later.

## 13. Communications templates

**Internal holding note (staff)**

> Subject: IT outage and security incident
>
> We are responding to a cyberattack that has taken some systems offline. Our security team and outside experts are working on it, and we have notified law enforcement.
>
> Use the downtime procedures for your area. Do not turn computers back on or plug in devices that IT has taken offline. Do not discuss the incident outside the company. Send press, customer or partner questions to [FILL IN]. Next update by [time].

**Partner notice (connection cut)**

> We have disconnected our connection to your systems at [time] because of a security incident on our network. We did this to protect you. We have no evidence today that your systems were accessed through this connection. We will tell you before we reconnect and will share indicators you can check. Your contact is [name, phone].

**Regulator note outline**

- Who we are and why this regulator is notified.
- Dates and times of first activity, discovery, containment and this notice.
- What happened in plain terms: entry point, encryption, data theft.
- Data types and number of individuals, confirmed and estimated.
- Measures taken and planned.
- Contact for follow-up and the date of the next update.

**Media holding statement**

> [Organization] is responding to a cybersecurity incident that has disrupted some of our systems. We took steps to contain it, engaged outside experts and notified law enforcement. [Critical services] continue under our backup procedures. We will share more as our investigation allows.

## 14. Healthcare providers: patient care, diversion and HIPAA

This section applies when the organization delivers patient care. It pairs with the Crisis Sim template on hospital ransomware.

**H1. Downtime procedures.** When the EHR, lab, pharmacy or imaging systems are down, clinical leaders switch to paper downtime procedures: downtime forms, printed medication administration records from the last downtime report, runner systems for lab results, and manual registration. Owner: chief nursing officer. Target: within 30 minutes of the outage. [FILL IN downtime kit locations]

**H2. Clinical command.** The hospital incident command system activates with a clinical lead beside the IC. Clinical decisions stay with clinicians; the IC gives them facts about systems and restore times. Owner: chief medical officer.

**Decision point P-A: divert ambulances?** Under EMTALA rules a hospital may direct an inbound non-hospital ambulance elsewhere only when it is in diversionary status, that is, it lacks the staff or facilities to accept more emergency patients. Anyone who arrives at the emergency department is still screened and stabilized. Decide diversion by service line (for example stroke, STEMI, trauma) based on what the outage actually breaks: imaging, lab turnaround, medication dispensing. Tell the regional EMS coordinator and nearby hospitals, set a time to review, and record who decided and why. [FILL IN regional EMS contact]

**H3. Patient safety review.** Review results that may have been missed or delayed during the outage: critical lab values, imaging reads, medication orders. In 2025 King's College Hospital said a long wait for a blood test result caused by the Synnovis attack was among the factors in a patient's death. Owner: chief medical officer. Target: daily during the outage.

**H4. Medical devices.** Ask the biomedical engineering team which networked devices depend on encrypted systems. Do not power cycle devices in use on patients to clear a network issue. Owner: biomedical engineering lead.

**H5. HIPAA notices.** As a covered entity: individuals without unreasonable delay and no later than 60 calendar days after discovery (45 CFR 164.404); HHS at the same time when 500 or more individuals are affected (164.408); prominent media in a state or jurisdiction when more than 500 residents there are affected (164.406). Discovery is the first day the breach is known, or would have been known with reasonable diligence, to any workforce member. Notice may be delayed on a law enforcement statement that it would impede an investigation (164.412). Owner: chief privacy officer.

**H6. Business associates.** If a vendor's systems hold your patients' data, ask each one in writing whether it was affected, and agree who sends notices. HHS OCR said in the Change Healthcare FAQ that only one entity needs to notify.

## 15. Post-incident review

Within 30 days of return to service:

- Timeline from initial access to recovery, with the dwell time and when each precursor could have been seen.
- Each decision point (D-A, C-A, C-B, R-A, P-A where used, the ransom decision and any materiality determination): what was decided, when, by whom and on what facts.
- Backup outcome: which copies survived, restore times against RTO, and gaps.
- Notice timeliness against each clock in section 11.
- Operations or clinical impact and how downtime procedures held up.
- Corrective actions with owners and dates, reported to the board.

## 16. Known gaps and placeholders

- [FILL IN] organization name, tier list and restore order.
- [FILL IN] backup architecture and who holds immutable vault credentials.
- [FILL IN] authority to cut internet access and partner links.
- [FILL IN] out-of-band bridge, chat and offline roster.
- [FILL IN] counsel, IR retainer and insurer numbers.
- [FILL IN] jurisdictions, sector rules and contract notice terms.
- Gap: ESXi logs must reach the SIEM before an incident to scope hypervisor access.

## Sources

- NIST SP 800-61r3, Incident Response Recommendations and Considerations for Cybersecurity Risk Management, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- NIST Cybersecurity Framework 2.0, 2024. https://www.nist.gov/cyberframework
- Sophos X-Ops, "Qilin ransomware caught stealing credentials stored in Google Chrome," 2024-08-22. https://news.sophos.com/en-us/2024/08/22/qilin-ransomware-caught-stealing-credentials-stored-in-google-chrome/
- The Hacker News, "Qilin ransomware combines Linux payload with BYOVD exploit," 2025-10. https://thehackernews.com/2025/10/qilin-ransomware-combines-linux-payload.html
- The Record, NHS Dumfries and Galloway data leak, 2024. https://therecord.media/healthcare-ransomware-data-breach-nhs-scotland
- Check Point, "LockBit 5.0: ransomware gang returns." https://blog.checkpoint.com/research/lockbit-returns-and-it-already-has-victims/
- CISA, Akira ransomware guidance (AA24-109A update), 2025-11-13. https://www.cisa.gov/news-events/news/cisa-fbi-and-partners-unveil-critical-guidance-protect-against-akira-ransomware-threat
- Testimony of Andrew Witty, Senate Finance Committee, 2024-05-01. https://www.finance.senate.gov/imo/media/doc/0501_witty_testimony.pdf
- Infosecurity Magazine, "Synnovis: Qilin publishes NHS patient data," 2024-06. https://www.infosecurity-magazine.com/news/synnovis-publish-nhs-patient-data
- The Record, "Ransomware attack contributed to patient's death, says Britain's NHS," 2025-06. https://therecord.media/ransomware-attack-contributed-patient-death-uk-nhs
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Debevoise, OFAC and FinCEN update ransomware guidance, 2021-11. https://www.debevoise.com/insights/publications/2021/11/ofac-and-fincen-update-ransomware-guidance-to
- Covington Inside Privacy, CISA submits final CIRCIA rule for OMB review, 2026-10. https://www.insideprivacy.com/critical-infrastructure/cisa-submits-final-circia-rule-for-omb-review/
- 23 NYCRR 500.17. https://www.law.cornell.edu/regulations/new-york/23-NYCRR-500.17
- GDPR, Regulation (EU) 2016/679. https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng
- HHS, Breach Notification Rule (not re-verified). https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html
- HHS, Ransomware Fact Sheet (not re-verified). https://www.hhs.gov/sites/default/files/RansomwareFactSheet.pdf
- HHS OCR, Change Healthcare Cybersecurity Incident FAQ (not re-verified). https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Holland and Hart, "Diverting ambulances and EMTALA." https://www.hollandhart.com/diverting-ambulances-and-emtala
- Kramer Levin, SEC Division of Corporation Finance clarifies Form 8-K disclosures. https://kramerlevin.com/en/perspectives-search/sec-division-of-corporation-finance-clarifies-form-8-k-disclosures-of-material-cybersecurity-incidents.html
- Reed Smith, "Pressure points in cyber insurance policies revealed in litigation," 2023-06. https://www.reedsmith.com/de/perspectives/cyber-insurance-claims/2023/06/pressure-points-in-cyber-insurance-policies-revealed-in-litigation
