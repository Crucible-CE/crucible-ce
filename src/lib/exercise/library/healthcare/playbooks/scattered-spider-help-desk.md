# Help desk social engineering response

Quarrystone Health Analytics, Inc. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and CIO
- Review cycle: every 12 months, after every exercise that uses it, and whenever the help desk vendor or its scripts change
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers an attacker who calls the IT help desk pretending to be an employee, gets a password reset and an MFA change, and uses the account to reach identity administration, SaaS data and the PHI warehouse. CISA's advisory on Scattered Spider (AA23-320A, updated 2025-07-29) puts new emphasis on exactly this: calls to the help desk to reset a password and move MFA to an attacker device. The same advisory describes rapid bulk data pulls once a cloud data platform is reached, exfiltration to services such as MEGA, extortion, and in some cases encryption of VMware ESXi with DragonForce ransomware.

Scattered Spider was heavily disrupted by arrests in 2025 and 2026 but is not confirmed defunct, and Mandiant warned that other crews copy the playbook. Plan for the technique, not the name.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0: detect, analyze, contain, eradicate, recover and post-incident review. Step owners and time targets are starting points; adjust them to your staffing.

In scope:

- The outsourced help desk (Altamesa Service Desk) and every path that can reset a password or MFA method.
- Entra ID, PIM, Microsoft 365 (Teams, SharePoint, Exchange), Salesforce and the Databricks PHI warehouse.
- Azure VMs and the on-premises VMware cluster if an affiliate deploys ransomware.
- Notice duties as a HIPAA business associate to covered entity customers, and as a Nasdaq listed company.

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Employee reports a password or MFA change they did not request | Any | Sev 2, Sev 1 if the account has PHI or admin access |
| New MFA method on an account followed by sign-in from a new IP, proxy or non-compliant device | Any | Sev 2 |
| Help desk reset on an account eligible for a privileged role in PIM | Any not verified under the rule in section 7 | Sev 1 |
| PIM activation of Global Administrator, Privileged Role Administrator, Privileged Authentication Administrator or Intune Administrator | Any not matched to an approved change | Sev 1 |
| New user created with an MFA method by an admin outside the joiner process | Any | Sev 1 |
| Bulk query or export from the PHI warehouse or Salesforce by a user account | More than 100,000 rows in an hour, or any new personal access token used from a new IP | Sev 1 |
| Unknown participant in an incident call or channel | Any | Sev 1 |

Sev 1: incident commander named within 15 minutes, executive sponsor within 30 minutes, counsel and IR retainer within 2 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Identity engineering lead |
| Cloud and IT lead | CIO | Cloud platform lead |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | VP Communications | Communications manager |
| Executive sponsor | CEO | CFO |
| Customer Success | Chief customer officer | VP customer support |
| Help desk vendor | Altamesa service delivery manager [FILL IN 24 hour contact] | Altamesa security officer [FILL IN] |
| Outside counsel | Ressler Kemp LLP [FILL IN] | [FILL IN] |
| IR retainer | Kestrel Point Incident Response [FILL IN] | [FILL IN] |
| Cyber insurer | Halbrook Specialty [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | Cloud and IT | Legal and Privacy | Comms | Exec sponsor | Customer Success | Outside counsel | IR retainer | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I |
| Account containment | A | R | C | I | I | I | I | I | C | I |
| Help desk reset freeze and verification rule | C | R | R | I | I | A | I | I | C | I |
| Out-of-band coordination | A | R | C | I | R | I | I | I | I | I |
| Scope of data accessed | A | R | C | C | I | I | I | C | R | I |
| Discovery time and breach analysis | C | C | I | A | I | I | I | R | C | I |
| BAA and HIPAA notices | C | C | I | A | C | I | R | R | I | I |
| Media and reporter questions | C | I | I | C | A | C | C | C | I | I |
| Customer integrations pause | C | C | R | C | I | A | R | I | C | I |
| Ransom decision | C | C | C | R | I | A | I | R | C | C |
| Materiality determination | C | C | I | R | I | A | I | R | I | I |
| Post-incident review | A | R | R | R | R | C | R | C | C | I |

## 4. Before an incident

- The help desk verification rule in section 7 is in the Altamesa contract and scripts, and is tested by unannounced calls every quarter. [FILL IN test owner]
- Privileged roles are eligible in PIM, with approval on activation by someone other than the requester. MFA alone is not enough for Global Administrator activation.
- Admin accounts use phishing-resistant MFA (passkeys or certificates), which a help desk cannot reset by phone.
- Break-glass: two cloud-only accounts with passkey or certificate sign-in, excluded from blocking Conditional Access, alert on sign-in, tested every 90 days. [FILL IN holders]
- Out-of-band coordination channel outside the Microsoft 365 tenant, with a roster kept offline. [FILL IN]
- Logs: Entra sign-in and audit logs keep 30 days on P1 and P2. Microsoft Graph activity logs are kept only if routed. Unified Audit Log keeps 180 days on Audit Standard. Databricks audit logs and storage data plane logs are kept only if delivery is configured. Route all of them to long-term storage now.
- Databricks personal access tokens are limited by policy, and their creation alerts the SOC.

## 5. Detect

**D1.** Treat a user report of an unrequested reset as an incident until proven otherwise. The person who takes the report calls the security on-call line, not the help desk. Owner: whoever takes the report. Target: immediately.

**D2.** Pull the Entra audit trail for the account: "Reset password (by admin)", "Admin deleted security info", "User registered security info", and every sign-in since the reset with IP, app and device compliance. Owner: Security lead. Target: 15 minutes.

```
SigninLogs
| where TimeGenerated > ago(2d)
| where UserPrincipalName =~ "rahul.desai@quarrystonehealth.example"
| project TimeGenerated, IPAddress, AppDisplayName, ResultType, DeviceDetail, ConditionalAccessStatus
| order by TimeGenerated asc
```

**D3.** Check the help desk ticket and call recording for the reset: who called, from what number, what verification was done, and which agent did it. Ask Altamesa to preserve every recording from the last 30 days. Owner: Security lead with the help desk vendor. Target: 1 hour.

**D4.** Look for follow-on calls. Callers in this pattern often research a second, more privileged target from runbooks or org charts and call again. Search help desk tickets for resets on IT staff, PIM eligible users and executives in the same period. Owner: Security lead. Target: 1 hour.

**Decision point D-A: declare Sev 1?** Yes if the account reached PHI, any admin interface or a second reset was attempted. The IC records the time of declaration. Legal and Privacy also records the earliest time any workforce member knew of the takeover. That may be the discovery time for HIPAA (section 11).

## 6. Analyze

**A1.** Map what the account touched: SharePoint and Teams (CISA lists SharePoint searching, T1213.002), mail, Salesforce, the Databricks workspace and any Azure subscriptions. Owner: Security lead. Target: 4 hours.

**A2.** Find tokens and credentials that survive a password reset: Databricks personal access tokens, app passwords, OAuth grants, service principal secrets, SSH keys and session cookies. Entra does not revoke session cookies issued by the apps themselves. Owner: Security lead. Target: 4 hours.

**A3.** If an admin role was used, list everything an admin could have added since the first reset: users, MFA methods, role assignments, PIM eligibility, app registrations, service principal credentials, federated domains, Conditional Access changes and Azure role assignments. Owner: Security lead. Target: 8 hours.

**A4.** Scope data access from Databricks audit logs (query text, tables, row counts), storage logs and network egress. Map tables to customers. Write down what logs cannot prove. Owner: IR retainer with Security lead. Target: 24 hours, then daily.

**A5.** Check whether the attacker can see the response. Review membership and recent joins of incident Teams channels, calls and mail threads. Vendor reporting says this group joins victims' incident calls and uses their own Teams and Slack. Owner: Security lead. Target: 1 hour.

## 7. Contain

**C1. Contain the account.** In this order: disable in on-premises AD, reset the password twice, disable in Entra ID, revoke refresh tokens, remove the attacker's MFA method, disable registered devices, and revoke app tokens such as Databricks personal access tokens. Owner: Security lead. Target: 15 minutes from confirmation.

```
Disable-ADAccount -Identity rdesai
Update-MgUser -UserId rahul.desai@quarrystonehealth.example -AccountEnabled:$false
Revoke-MgUserSignInSession -UserId rahul.desai@quarrystonehealth.example
Get-MgUserAuthenticationMethod -UserId rahul.desai@quarrystonehealth.example
Update-MgDevice -DeviceId <device-object-id> -AccountEnabled:$false
databricks token-management list
databricks token-management delete <token-id>
```

Access tokens can stay valid for about an hour unless the app supports Continuous Access Evaluation.

**C2. Freeze privileged resets.** Tell Altamesa in writing to stop every password and MFA reset for accounts in the privileged list until the IC lifts the freeze. [FILL IN privileged list location] Owner: Cloud and IT lead. Target: 30 minutes.

**Decision point C-A: the verification rule.** From declaration until the post-incident review, every MFA reset requires a video call with photo ID and the employee's manager on the line, with no exception for executives. Knowledge questions (employee ID, SSN digits, hire date) are not verification: a caller who researched the target has them. If video is not possible, the reset waits or happens in person at the Columbus office with ID. The executive sponsor approves and the vendor confirms in writing.

**C3. If an admin role was used.** Sign in with break-glass, remove the attacker's role assignments and accounts, revoke sessions for every privileged account, and review PIM activations since the first reset. Owner: Security lead. Target: 1 hour.

```
Get-MgRoleManagementDirectoryRoleAssignmentScheduleInstance -All | Where-Object { $_.StartDateTime -gt (Get-Date).AddDays(-2) }
Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'" -All
```

In the Entra admin center, check Identity Governance, Privileged Identity Management, Microsoft Entra roles, then Resource audit for every activation.

**C4. Emergency Conditional Access.** Turn on the pre-built emergency policies: require phishing-resistant MFA for all admin roles, block sign-ins from the proxy ranges and countries seen, and require compliant devices for access to Databricks and Azure management. [FILL IN policy names] Owner: Security lead. Target: 2 hours.

**Decision point C-B: shut down identity sync?** Do not shut down Entra Connect by reflex. MGM shut down identity sync servers in 2023 and the outage worsened. Shut it down only if the on-premises side is compromised or a synced identity is being used to regain access. Cloud admin roles are not removed by stopping sync. The IC records the reason either way.

**C5. Move the response out of band.** If an attacker has or had admin access to Microsoft 365, move coordination to the out-of-band bridge and chat group. Verify each participant by calling them back on a number from the offline roster before adding them. Owner: Communications with Security lead. Target: 1 hour.

**C6. Warn staff.** Send all staff a short message: IT and the help desk never ask you to read out a code, approve a prompt you did not start, or install remote access software. Report such calls to [FILL IN]. Owner: Communications. Target: same day.

## 8. Eradicate

**E1.** Remove everything in the A3 list. Pay attention to service principals with Azure roles: an attacker who was Global Administrator can leave a credential on an app that still has Contributor on a subscription. Microsoft's Midnight Blizzard case showed that app permissions persist after the creator is gone. Owner: Security lead.

**E2.** Rotate secrets the attacker could have read in SharePoint runbooks, Key Vault or pipelines, including storage account keys (rotate both key1 and key2 to invalidate SAS signed with them). Owner: Cloud and IT lead.

```
az storage account keys renew --account-name <account> --resource-group <rg> --key key1
az storage account keys renew --account-name <account> --resource-group <rg> --key key2
```

**E3.** If ransomware was deployed through Azure Run Command or another control plane path, remove the identity that ran it, block Run Command for non-admin roles, and isolate affected VMs with Defender for Endpoint before any restore. Owner: Cloud and IT lead.

**E4.** If the on-premises VMware cluster was encrypted, follow the hypervisor steps in the playbook Ransomware on analytics systems and the PHI warehouse.

## 9. Recover

**R1.** Restore accounts through an in-person or video verified process. Each restored user registers a phishing-resistant method. Owner: Cloud and IT lead.

**R2.** Restore VMs from recovery points that predate the intrusion, onto rebuilt hosts, after Azure Backup soft delete and immutability are checked. A recovery point taken after the first reset may hold what the attacker left. Owner: Cloud and IT lead.

**Decision point R-A: customer integrations.** If encryption or attacker access reaches systems that exchange data with customers, pause inbound and outbound feeds for the affected customers and tell each of them by phone before or as the feed stops. Set a restore order by clinical need. Change Healthcare disconnected its systems on the day of the attack in 2024. Leaving the choice to each customer is not acceptable: they cannot judge Quarrystone's environment. The executive sponsor approves.

**Return to service criteria.** A system or customer feed returns when the Security lead and Cloud and IT lead sign that:

- Every item in the A3 list is removed and verified.
- No attacker sign-in or token use in 72 hours of monitoring.
- The help desk verification rule is in force and has been tested by one unannounced call.
- Restored data passed integrity checks.
- The customer has been told what was restored and what was not.

## 10. Evidence preservation and chain of custody

- Help desk call recordings, ticket history and agent notes for every reset in scope, preserved by the vendor under a written hold.
- Entra sign-in and audit logs, Unified Audit Log, Defender XDR incidents, Databricks audit logs and Salesforce event logs, exported to storage the attacker never had access to.
- Any extortion email with full headers, kept in place and exported. Never delete it.
- Teams messages from compromised accounts.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]
- The IR retainer works at the direction of outside counsel to protect privilege.

## 11. Regulatory and contractual notification matrix

Discovery: under 45 CFR 164.410 a breach is discovered on the first day it is known, or with reasonable diligence would have been known, to any workforce member or agent. A Defender alert that sat unread may set the "should have known" time. Legal and Privacy records the discovery time and its basis. The clocks run from discovery, not from when forensics finishes: notices go out with what is known and are supplemented.

Ransomware: if encryption reaches systems with ePHI, OCR's ransomware guidance treats it as a presumed breach unless a documented four-factor assessment shows a low probability of compromise.

| Notice | To | Trigger and deadline | How | Owner |
|---|---|---|---|---|
| Cyber insurer | Halbrook Specialty | As soon as practicable. Policy: [FILL IN, assumed 48 hours]. Pre-notice costs may be denied. Panel vendors or written consent. | Hotline and written notice | General counsel |
| BAA incident notice (contractual) | Affected covered entity customers | 5 business days from discovery under current BAAs [FILL IN per customer] | Written notice plus a call from the account owner | Chief privacy officer |
| HIPAA breach notice to covered entities | Affected covered entities | No later than 60 calendar days after discovery. Identify each affected individual to the extent possible. | Written notice, supplemented | Chief privacy officer |
| Individual, HHS and media notice | Patients, HHS, media | Covered entity's duty, delegable to Quarrystone. Only one entity needs to notify (OCR Change Healthcare FAQ). | Delegation agreed in writing per customer | Chief privacy officer |
| Texas attorney general | Texas AG | No later than 30 days after determining a breach affecting 250 or more Texas residents, through the online form. Counsel confirms who files. | Online form | General counsel |
| Other states | State AGs | Varies. Many exempt or deem compliant HIPAA entities. | Per state | Outside counsel |
| SEC Form 8-K | SEC | Item 1.05 within four business days of a materiality determination, made without unreasonable delay. Item 8.01 for voluntary disclosure before a determination. | EDGAR | General counsel and CFO |
| FBI | Field office or IC3 | Early. OFAC counts prompt reporting as a significant mitigating factor. | [FILL IN] | General counsel |
| CISA | CISA | Voluntary today. CIRCIA not yet in effect; check status. | Portal | Security lead |

Law enforcement delay: under 164.412 notification may be delayed on a law enforcement statement that it would impede an investigation. Record it.

## 12. Ransom and extortion decision procedure

1. Nobody replies to the attacker. Staff who receive messages forward them to the IC through the out-of-band channel and do not answer.
2. Security preserves the message with headers and matches any sample data to source tables to size the claim.
3. Outside counsel runs an OFAC sanctions screen. Payment to a sanctioned person can violate sanctions on a strict liability basis.
4. Counsel notifies the FBI and shares indicators.
5. The insurer confirms its consent terms and panel negotiator.
6. The IC gives a written recovery estimate without paying.
7. The executive sponsor presents options to the board. The board decides. [FILL IN approval authority]
8. Record the decision, who made it, the basis and the time.

Reference cases from the same campaign in September 2023: Caesars reportedly paid about $15 million of a $30 million demand and reported no customer facing outage; MGM reportedly did not pay and reported about a $100 million hit to adjusted property EBITDAR for the quarter. Neither outcome is a rule. Payment does not undo the theft or any notice duty.

## 13. Communications templates

**Internal holding note (staff)**

> Subject: Security incident and help desk changes
>
> We are responding to a security incident in which someone pretended to be an employee to get account access. Our security team and outside experts are working on it.
>
> Starting now, password and MFA resets need a video call with ID and your manager. IT and the help desk will never ask you to read out a code or approve a sign-in you did not start. If you get a call like that, hang up and report it to [FILL IN].
>
> Do not discuss the incident outside the company. Send customer or press questions to [FILL IN]. Next update by [time].

**Customer notice (covered entity), first notice under the BAA**

> Subject: Notice of security incident under our business associate agreement
>
> On [date] we discovered that an unauthorized person used a compromised employee account to access our systems, including the data warehouse where we process your data. We contained the account on [date and time].
>
> What we know: [facts, including tables or record types]. What we do not yet know: [open questions]. We will identify affected individuals as our investigation allows and update you by [date].
>
> We can send notices to individuals, HHS and media on your behalf if you ask us to in writing. Your contact is [name, phone, email].

**Regulator note outline**

- Our role as a business associate and the covered entities affected.
- Dates of the reset, discovery, containment and each notice.
- How access was obtained, in plain terms, and what was accessed.
- Types of PHI and number of individuals, confirmed and estimated.
- Changes to help desk verification and admin MFA.
- Contact for follow-up.

**Media holding statement**

> Quarrystone Health Analytics is investigating a cybersecurity incident. We acted to contain it, engaged outside experts and notified law enforcement. We are contacting affected customers directly and will share more as our investigation allows.

## 14. Post-incident review

Within 30 days of return to service:

- Timeline from the first call to recovery.
- Why the help desk accepted the caller, and whether the verification rule would have stopped it.
- Each decision point (D-A, C-A, C-B, R-A, the ransom decision and the materiality determination): what was decided, when, by whom.
- Whether the attacker saw the response, and when the team moved out of band.
- Notice timeliness against each clock in section 11.
- Corrective actions with owners and dates, reported to the board. Make the verification rule permanent in the vendor contract.

## 15. Known gaps and placeholders

- [FILL IN] help desk vendor 24 hour contact and contract clause for the verification rule.
- [FILL IN] privileged account list and who maintains it.
- [FILL IN] out-of-band bridge, chat group and offline roster.
- [FILL IN] emergency Conditional Access policy names.
- [FILL IN] counsel, IR retainer and insurer numbers.
- Gap: Databricks audit log delivery and storage data plane logs must be on before an incident to scope warehouse theft.
- Gap: PIM activation for Global Administrator should require approval, not only MFA.

## Sources

- CISA, AA23-320A Scattered Spider (rev. 2025-07-29). https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a
- CISA alert, "CISA and Partners Release Updated Advisory on Scattered Spider Group," 2025-07-29. https://www.cisa.gov/news-events/alerts/2025/07/29/cisa-and-partners-release-updated-advisory-scattered-spider-group
- MGM Resorts Form 8-K, 2023-10-05. https://www.sec.gov/Archives/edgar/data/789570/000119312523251667/d461062d8k.htm
- Caesars Entertainment Form 8-K, 2023-09-14. https://www.sec.gov/Archives/edgar/data/1590895/000119312523235015/d537840d8k.htm
- BleepingComputer, "Caesars Entertainment confirms ransom payment, customer data theft," 2023-09. https://www.bleepingcomputer.com/news/security/caesars-entertainment-confirms-ransom-payment-customer-data-theft/
- Kolide/1Password, "What everyone got wrong about the MGM hack." https://www.kolide.com/blog/what-everyone-got-wrong-about-the-mgm-hack
- Cybersecurity Dive, "UK arrests 2 more alleged Scattered Spider hackers over London transit system breach," 2025-09. https://www.cybersecuritydive.com/news/uk-arrests-scattered-spider-london-transit-hack-us-healthcare/760508/
- US DOJ, "Alleged member of criminal cyber hacking group Scattered Spider arrested in Finland and extradited," 2026-07-01. https://www.justice.gov/opa/pr/alleged-member-criminal-cyber-hacking-group-scattered-spider-arrested-finland-and-extradited
- Microsoft Learn, Revoke user access in Entra ID. https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access
- Microsoft Learn, Manage emergency access accounts. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
- Microsoft Learn, Entra ID data retention. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-reports-data-retention
- Microsoft Learn, Purview audit log retention policies. https://learn.microsoft.com/en-us/purview/audit-log-retention-policies
- MSRC, "Microsoft actions following attack by nation state actor Midnight Blizzard," 2024-01-19. https://msrc.microsoft.com/blog/2024/01/microsoft-actions-following-attack-by-nation-state-actor-midnight-blizzard/
- HHS, Breach Notification Rule (not re-verified). https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html
- HHS, Ransomware Fact Sheet (not re-verified). https://www.hhs.gov/sites/default/files/RansomwareFactSheet.pdf
- HHS OCR, Change Healthcare Cybersecurity Incident FAQ (not re-verified). https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Kramer Levin, SEC Division of Corporation Finance clarifies Form 8-K disclosures. https://kramerlevin.com/en/perspectives-search/sec-division-of-corporation-finance-clarifies-form-8-k-disclosures-of-material-cybersecurity-incidents.html
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Hunton, CISA plans to finalize cyber incident reporting regulations. https://www.hunton.com/privacy-and-cybersecurity-law-blog/cisa-plans-to-finalize-cyber-incident-reporting-regulations-in-september-2026
- Marsh Commercial, "Incident response guide." https://marshcommercial.co.uk/content/dam/marshcommercial/marsh-commercial/documents/pdfs/Incident_Response_Guide.pdf
