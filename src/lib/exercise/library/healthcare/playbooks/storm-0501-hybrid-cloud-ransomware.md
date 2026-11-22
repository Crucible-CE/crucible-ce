# Hybrid cloud ransomware response

Quarrystone Health Analytics, Inc. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and CIO
- Review cycle: every 12 months, after every exercise that uses it, and after any change to Entra Connect, backup or Key Vault design
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers an attacker who holds on-premises Active Directory, pivots to Entra ID through the Entra Connect Sync server, takes Global Administrator, and then steals, deletes and encrypts data in Azure. Microsoft Threat Intelligence describes this pattern for Storm-0501 in its 2024 and 2025 reports. In the 2025 case the cloud phase needed no traditional malware: the attacker used Azure control plane operations to exfiltrate with AzCopy, delete snapshots, restore points, backup containers and storage accounts, and encrypt what remained with a customer managed key that it then deleted. The ransom demand arrived over Microsoft Teams from a compromised internal account.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0: detect, analyze, contain, eradicate, recover and post-incident review. Step owners and time targets are starting points; adjust them to your staffing.

In scope:

- Entra ID, the Entra Connect Sync server (QS-ENTCON01), on-premises AD and the Directory Synchronization Account.
- The Azure analytics subscription: the PHI data lake (Azure Data Lake Storage), Key Vaults, Recovery Services vaults, analytics VMs, Azure SQL and the Databricks PHI warehouse.
- Notice duties as a HIPAA business associate to 46 covered entity customers, and as a Nasdaq listed company.

Out of scope: ransomware that encrypts the on-premises and VM estate through group policy (see Ransomware on analytics systems and the PHI warehouse) and help desk social engineering (see Help desk social engineering response). Use those playbooks alongside this one if the facts overlap.

Use this playbook with the company incident response plan. Where they disagree, the incident commander decides and records why.

## 2. Severity and declaration criteria

Declare an incident and open this playbook when any one of these is true:

| Signal | Threshold | Severity |
|---|---|---|
| `Microsoft.Authorization/elevateAccess/action` by any account | Any occurrence not on an approved change | Sev 1 |
| New Owner or User Access Administrator assignment at root or subscription scope | Any not on an approved change | Sev 1 |
| Deletion of snapshots, restore point collections, backup protection containers or storage accounts | More than 5 in 60 minutes, or any in the PHI lake | Sev 1 |
| Resource lock or immutability policy deleted | Any in the analytics subscription | Sev 1 |
| New federated domain or change to domain authentication | Any | Sev 1 |
| Encryption scope created or changed on a PHI storage account | Any not on an approved change | Sev 1 |
| Password reset or new MFA method on a synced account with an admin role | Any not raised by the owner through a verified request | Sev 2, Sev 1 if followed by sign-in from a new IP |
| Directory Synchronization Account signs in from anywhere but the sync server | Any | Sev 1 |
| Ransom message on any channel, including Teams | Any | Sev 1 |

Sev 1 means the incident commander is named within 15 minutes, the executive sponsor is called within 30 minutes, and outside counsel and the IR retainer are engaged within 2 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Senior detection engineer |
| Cloud and IT lead | Cloud platform lead | CIO |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | VP Communications | Communications manager |
| Executive sponsor | CEO | CFO |
| Customer Success | Chief customer officer | VP customer support |
| Outside counsel | Ressler Kemp LLP [FILL IN partner and 24 hour number] | [FILL IN] |
| IR retainer | Kestrel Point Incident Response [FILL IN retainer ID and hotline] | [FILL IN] |
| Cyber insurer | Halbrook Specialty [FILL IN policy number and breach hotline] | Broker [FILL IN] |

R is responsible, A is accountable, C is consulted, I is informed.

| Activity | IC | Security | Cloud and IT | Legal and Privacy | Comms | Exec sponsor | Customer Success | Outside counsel | IR retainer | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | I | I | I | I | I | I | I |
| Clean admin path and break-glass | A | R | R | I | I | I | I | I | C | I |
| Entra Connect and federation containment | A | R | R | I | I | I | I | I | C | I |
| Key Vault and backup protection | A | C | R | I | I | I | I | I | C | I |
| Evidence preservation | A | R | R | C | I | I | I | C | R | I |
| Discovery time and breach analysis | C | C | I | A | I | I | I | R | C | I |
| BAA and HIPAA notices | C | C | I | A | C | I | R | R | I | I |
| Customer calls | C | I | I | C | C | I | A | C | I | I |
| Media and staff statements | C | I | I | C | A | C | C | C | I | I |
| Ransom decision | C | C | C | R | I | A | I | R | C | C |
| Materiality determination | C | C | I | R | I | A | I | R | I | I |
| Recovery and return to service | A | R | R | I | I | I | C | I | C | I |
| Post-incident review | A | R | R | R | R | C | R | C | C | I |

## 4. Before an incident

These are the conditions this playbook assumes. Check them every quarter. An unchecked item is a known gap.

- Break-glass: at least two cloud-only accounts on the tenant's onmicrosoft.com domain, permanent active Global Administrator, passkey (FIDO2) or certificate sign-in different from normal admin methods, excluded from blocking Conditional Access policies, with an alert on every sign-in, and a sign-in test at least every 90 days. [FILL IN account names, where the keys are stored, and who holds them]
- Global Administrators are cloud-only accounts. No synced account holds a privileged Entra role.
- PIM: admin roles are eligible, not standing, with MFA and approval on activation, and at least one approver who is not the requester. Microsoft lists the case where every Global Administrator is eligible and no approver exists as a break-glass reason.
- The Entra Connect server is treated as Tier 0, onboarded to Defender for Endpoint with tamper protection, and has a TPM. The Directory Synchronization Account is limited by Conditional Access to the sync server's IP address.
- Federation is set with `federatedIdpMfaBehavior = rejectMfaByFederatedIdp`.
- Defender for Resource Manager and Defender for Storage are on for the analytics subscription.
- Key Vaults have soft delete and purge protection on.
- Recovery Services vaults have soft delete on and are locked as immutable. Blob containers in the PHI lake use locked time-based retention where the data model allows it.
- Logs are routed with diagnostic settings: Entra sign-in and audit logs (30 days on P1 and P2 otherwise), the Azure Activity Log (90 days otherwise), and data plane logs for storage, Key Vault and SQL (not collected at all without a diagnostic setting). Upgrading a license later does not bring back old logs.

## 5. Detect

**D1.** Triage the alert. Confirm the operation, the caller, the caller IP and the time from the Azure Activity Log or Defender for Cloud. Owner: Security lead. Target: 15 minutes from alert.

**D2.** Check Directory Activity for `elevateAccess`. Tenant level elevation does not appear in a subscription's activity log. In the Azure portal open Monitor, then Activity log, and set the scope to Directory. Owner: Security lead. Target: 15 minutes.

**D3.** Run the control plane query below in Log Analytics or Sentinel. Owner: Security lead. Target: 30 minutes.

```
AzureActivity
| where TimeGenerated > ago(30d)
| where OperationNameValue in~ (
    "MICROSOFT.AUTHORIZATION/ELEVATEACCESS/ACTION",
    "MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE",
    "MICROSOFT.STORAGE/STORAGEACCOUNTS/LISTKEYS/ACTION",
    "MICROSOFT.STORAGE/STORAGEACCOUNTS/WRITE",
    "MICROSOFT.AUTHORIZATION/LOCKS/DELETE",
    "MICROSOFT.STORAGE/STORAGEACCOUNTS/BLOBSERVICES/CONTAINERS/IMMUTABILITYPOLICIES/DELETE",
    "MICROSOFT.STORAGE/STORAGEACCOUNTS/ENCRYPTIONSCOPES/WRITE",
    "MICROSOFT.COMPUTE/SNAPSHOTS/DELETE",
    "MICROSOFT.COMPUTE/RESTOREPOINTCOLLECTIONS/DELETE",
    "MICROSOFT.RECOVERYSERVICES/VAULTS/BACKUPFABRICS/PROTECTIONCONTAINERS/DELETE",
    "MICROSOFT.STORAGE/STORAGEACCOUNTS/DELETE")
| project TimeGenerated, Caller, CallerIpAddress, OperationNameValue, ActivityStatusValue, _ResourceId
| order by TimeGenerated asc
```

If the Activity Log is not routed to Log Analytics, export it now with the CLI before the 90 day window passes:

```
az monitor activity-log list --start-time 2026-10-01T00:00:00Z --max-events 50000 > activitylog-analytics.json
```

**D4.** Check Entra ID audit logs for the identity steps Storm-0501 used: password resets that came from the sync account, new security info on privileged accounts, new federated domains, and new Global Administrators. Owner: Security lead. Target: 30 minutes.

```
Connect-MgGraph -Scopes "AuditLog.Read.All","Directory.Read.All","RoleManagement.Read.Directory","Domain.Read.All"
Get-MgDomain | Select-Object Id, AuthenticationType, IsVerified
Get-MgRoleManagementDirectoryRoleAssignment -Filter "roleDefinitionId eq '62e90394-69f5-4237-9190-012177145e10'" -All
```

The role definition ID above is Global Administrator. Repeat for Privileged Role Administrator and any role that can manage Intune or Conditional Access.

**Decision point D-A: is this Sev 1?** Yes if any row in section 2 marked Sev 1 is confirmed. The IC records the time of declaration. That time is also the latest possible HIPAA discovery time (see section 11).

## 6. Analyze

**A1.** Name the compromised identities: the account that ran the control plane operations, every account it created or elevated, and any non-human synced identity with a privileged role and no MFA method. Owner: Security lead. Target: 1 hour.

**A2.** Find the path from on-premises. With the IR retainer, check the Entra Connect server for new logons (Security event 4624), new processes (4688) and new services (System event 7045), and check domain controllers for replication requests that indicate DCSync (event 4662 with the DS-Replication-Get-Changes-All right). Check whether the server was onboarded to Defender for Endpoint. Microsoft reports Storm-0501 ran `sc query sense` and `sc query windefend` to find hosts that were not. Owner: IR retainer with Security lead. Target: 4 hours.

**A3.** Find persistence the attacker may have added: federated domains and federation settings, new app registrations and service principal credentials, consented OAuth grants, new users with MFA methods, PIM eligibility changes, managed identities with new role assignments, and federated credentials on user-assigned identities. Owner: Security lead. Target: 4 hours.

**A4.** Establish the exfiltration window. Look for `listkeys`, storage accounts made public (`storageAccounts/write`), and outbound traffic from the lake. If storage data plane logs were off, write down that file level scope cannot be proven from logs. Owner: Security lead. Target: 8 hours, then daily.

**A5.** Establish what is recoverable: Key Vault soft deleted keys, Recovery Services vault soft deleted items, remaining snapshots, and storage account state. Owner: Cloud and IT lead. Target: 2 hours.

Known, unknown and assumed: at every IC update, state the three lists in writing. Do not let an assumption become a fact by repetition.

## 7. Contain

Order matters. The sync path and federation must be closed before or at the same time as credential resets, or resets will be undone.

**C1. Get a clean admin path.** Sign in with a break-glass account from a known clean device. Confirm the break-glass accounts were not modified. If break-glass is unavailable, open a severity A case with Microsoft support for tenant recovery. Owner: Security lead. Target: 30 minutes.

**C2. Stop further deletion.** Remove the attacker's role assignments at root, management group and subscription scope. Remove any root User Access Administrator assignment created by elevation. Owner: Cloud and IT lead. Target: 30 minutes.

```
az role assignment list --all --include-inherited --query "[?roleDefinitionName=='Owner' || roleDefinitionName=='User Access Administrator']" -o table
az role assignment delete --assignee svc-dataops-sync@quarrystonehealth.example --role "User Access Administrator" --scope "/"
```

**C3. Protect keys and backups now.** For every Key Vault, check soft delete and purge protection, turn on purge protection, and recover any deleted key that the storage accounts depend on. For every Recovery Services vault, check soft delete and immutability. Owner: Cloud and IT lead. Target: 1 hour.

```
az keyvault list --query "[].{name:name, softDelete:properties.enableSoftDelete, purgeProtection:properties.enablePurgeProtection}" -o table
az keyvault update --name kv-qs-ops7731 --enable-purge-protection true
az keyvault key list-deleted --vault-name kv-qs-ops7731 -o table
az keyvault key recover --vault-name kv-qs-ops7731 --name <key-name>
az backup vault backup-properties show --name rsv-analytics-prod --resource-group rg-backup
az backup vault show --name rsv-analytics-prod --resource-group rg-backup --query properties.securitySettings
```

Purge protection is what stops a deleted customer managed key from becoming permanent encryption. Microsoft reports that the 2025 victim recovered its key through soft delete.

**C4. Close the sync path.** Decide with the IR retainer whether to capture memory from the Entra Connect server first. Then isolate the server with Defender for Endpoint or at the network, and stop the sync scheduler. Owner: Cloud and IT lead with Security lead. Target: 2 hours.

```
Set-ADSyncScheduler -SyncCycleEnabled $false
Get-ADSyncScheduler
```

**Decision point C-A: stop Entra Connect sync?** Stop it when the server is confirmed or suspected compromised, or when the attacker used a synced identity. Stopping sync stops joiners, leavers and on-premises password changes for every staff member until the server is rebuilt. Before you stop it, name who will process urgent joiners and leavers directly in Entra ID and how. The IC approves and records the time. Do not rebuild the server in place.

**C5. Close federation.** Remove any federated domain the company did not create, and check federation settings on the domains it did. Owner: Security lead. Target: 2 hours, in the same window as C4.

```
Get-MgDomain | Where-Object AuthenticationType -eq "Federated"
Get-MgDomainFederationConfiguration -DomainId qs-partner-sso.example
```

**C6. Contain identities in one window.** For each compromised account, in this order: disable in on-premises AD, reset the on-premises password twice, disable in Entra ID, revoke refresh tokens, and disable registered devices. Then reset every privileged credential. Owner: Security lead. Target: 4 hours from declaration.

```
Disable-ADAccount -Identity svc-dataops-sync
Set-ADAccountPassword -Identity svc-dataops-sync -Reset -NewPassword (Read-Host -AsSecureString)
Set-ADAccountPassword -Identity svc-dataops-sync -Reset -NewPassword (Read-Host -AsSecureString)
Update-MgUser -UserId svc-dataops-sync@quarrystonehealth.example -AccountEnabled:$false
Revoke-MgUserSignInSession -UserId svc-dataops-sync@quarrystonehealth.example
Update-MgDevice -DeviceId <device-object-id> -AccountEnabled:$false
```

Access tokens can stay valid for about an hour after revocation unless the app supports Continuous Access Evaluation. Entra does not revoke session cookies issued by apps themselves.

**Decision point C-B: reset all at once or in stages?** Reset all privileged credentials in one coordinated window after C4 and C5 are done. Staged resets while sync or federation is open let the attacker regain access, as the exercise branch "They are back in" shows. Stage only if the IC records a reason, such as a dependency that would stop customer feeds.

**C7. Emergency Conditional Access.** In the Entra admin center under Protection, Conditional Access, turn on the pre-built emergency policies: block all sign-ins except break-glass and the named response group; require phishing-resistant MFA for every admin role; restrict the Directory Synchronization Account to the sync server's IP. [FILL IN policy names] Owner: Security lead. Target: 4 hours.

**C8. Storage credentials.** Rotate both account keys on every storage account the attacker could list keys for, delete or change stored access policies, revoke user delegation keys, and consider disabling Shared Key authorization. Owner: Cloud and IT lead. Target: 8 hours.

```
az storage account keys renew --account-name qsphilake01 --resource-group rg-phi-lake --key key1
az storage account keys renew --account-name qsphilake01 --resource-group rg-phi-lake --key key2
az storage account revoke-delegation-keys --name qsphilake01 --resource-group rg-phi-lake
az storage account update --name qsphilake01 --resource-group rg-phi-lake --allow-shared-key-access false
```

**C9. Teams and the ransom channel.** Disable any internal account the attacker used to send messages, and preserve the messages. Move incident coordination out of the tenant to the out-of-band bridge and chat group. [FILL IN out-of-band bridge and group details] Owner: Security lead. Target: 1 hour from the message.

## 8. Eradicate

**E1.** Reset krbtgt twice, with enough time between resets for replication, and reset every Tier 0 credential on premises. Owner: Cloud and IT lead with IR retainer. Target: before sync is turned back on.

**E2.** Rebuild the Entra Connect server from clean media on a new host with a TPM, onboard it to Defender for Endpoint with tamper protection before it connects, and use a new Directory Synchronization Account. The Hacker News, citing Microsoft, reported that Entra Connect 2.5.3.0 adds application based authentication. [FILL IN target version] Owner: Cloud and IT lead.

**E3.** Remove every app registration, service principal credential, OAuth grant, user and role assignment the attacker created, using the A3 list. Owner: Security lead.

**E4.** Make every Global Administrator cloud-only with phishing-resistant MFA. Remove privileged roles from all synced identities. Owner: Security lead.

**E5.** Confirm with the IR retainer that no attacker access remains on premises or in the tenant. Record the evidence for that conclusion. Owner: IC.

## 9. Recover

**R1. Restore order.** Restore in this order unless the IC records a different one: identity and admin access; Key Vaults and keys; storage accounts holding raw customer feeds; the Databricks warehouse and Azure SQL; analytics VMs; customer dashboards and outbound feeds. Within each tier, customers whose care operations depend on outputs go first. Owner: Cloud and IT lead.

**R2. Protect the restore.** Before restoring into a storage account, lock the backup vault as immutable and apply locked time-based retention on restored containers where possible. Rebuild pipelines under new identities, not the old service principals. Owner: Cloud and IT lead.

**R3. Recover from backup.** Azure Backup soft delete keeps deleted backup data for 14 days by default (configurable from 14 to 180 days) in vaults where it is enforced. VM snapshots kept for instant restore can be deleted before that period ends. Immutable vaults do not cover operational backups of blobs, files and disks, so check those separately. Owner: Cloud and IT lead.

**Return to service criteria.** A customer feed or dashboard returns to service only when all of these are signed by the Cloud and IT lead and the Security lead, and approved by the IC:

- No attacker access found in the last 72 hours of monitoring with the restored logging in place.
- The data restored for that customer passed integrity checks against record counts and checksums from before the incident, where they exist.
- Pipelines run under new identities with least privilege.
- Entra Connect is rebuilt and onboarded to Defender for Endpoint, or sync stays off.
- Purge protection, locked immutable backup vaults and data plane logging are on for the restored resources.
- The customer has been told what was restored, what was not, and the date.

## 10. Evidence preservation and chain of custody

- Preserve before you change. Export the Activity Log, Entra sign-in and audit logs, the Unified Audit Log and Defender XDR incidents to a storage account the attacker never had access to, with locked time-based retention. Unified Audit Log (Audit Standard) keeps 180 days; Entra logs keep 30 days on P1 and P2.
- Capture memory and disk from the Entra Connect server and at least one domain controller before rebuild, through the IR retainer.
- Preserve every Teams message from the attacker with headers and the sending account's sign-in history.
- Record each item in the evidence log: item, source, collected by, time (UTC), hash (SHA-256), storage location, and every transfer. [FILL IN evidence log location]
- Direct the IR retainer through outside counsel so that its work product stays privileged. The insurer's panel counsel may require this.

## 11. Regulatory and contractual notification matrix

Discovery: under 45 CFR 164.410, a breach is discovered on the first day it is known, or by exercising reasonable diligence would have been known, to any workforce member or agent other than the person who committed it. Record the discovery time and its basis in writing. If exfiltration alerts were missed the day before the deletions, counsel should assess whether discovery was earlier than the declaration.

Ransomware: HHS OCR's 2016 fact sheet treats ransomware encryption of ePHI as a presumed breach unless a documented four-factor risk assessment shows a low probability of compromise. Cloud side encryption with a deleted key is ransomware for this purpose.

| Notice | To | Trigger and deadline | How | Owner |
|---|---|---|---|---|
| Cyber insurer | Halbrook Specialty | As soon as practicable. Policy wording: [FILL IN, assumed 48 hours]. Often a condition of cover. Use panel vendors or get prior written consent for others. | Breach hotline and written notice [FILL IN] | General counsel |
| BAA incident notice (contractual) | Each covered entity customer whose PHI was in scope | 5 business days from discovery under the current BAAs. BAA terms vary in practice from 24 hours to 10 days. [FILL IN per customer] | Written notice to the contract notice address and a call from the account owner | Chief privacy officer, with Customer Success |
| HIPAA breach notice to covered entities | Each affected covered entity | Without unreasonable delay and no later than 60 calendar days after discovery. Identify each affected individual to the extent possible. Send what is known and supplement. | Written notice | Chief privacy officer |
| Individual, HHS and media notice | Patients, HHS, prominent media | The covered entity's duty: 60 days after discovery; HHS at the same time for 500 or more; media where more than 500 residents of a state are affected. A covered entity may delegate this to Quarrystone, and only one entity needs to notify. | Offer delegated notice in writing per customer | Chief privacy officer |
| Texas attorney general | Texas AG | As soon as practicable and no later than 30 days after determining a breach affecting 250 or more Texas residents, through the AG online form. Counsel confirms whether Quarrystone or the covered entity files. | Online form | General counsel |
| Other states | State AGs | Varies. Many states exempt or deem compliant entities that follow HIPAA notification. California requires a sample notice to the AG when more than 500 residents are notified (confirm with counsel). | Per state | Outside counsel |
| SEC Form 8-K | SEC, investors | Item 1.05 within four business days after the company determines the incident is material. The determination must be made without unreasonable delay. Item 8.01 for voluntary disclosure before a determination. | EDGAR filing | General counsel and CFO |
| FBI | Field office or IC3 | As early as possible. Prompt reporting is a significant mitigating factor in OFAC's view. | [FILL IN field office contact] | General counsel |
| CISA | CISA | Voluntary today. CIRCIA reporting is not yet in effect. The final rule went to OIRA on 2026-10-01 with proposed 72 hour and 24 hour clocks. Check status at the time. | CISA reporting portal | Security lead |

Law enforcement delay: under 164.412, notification may be delayed on a law enforcement statement that it would impede an investigation. Record the statement and its scope. It does not pause contract duties to customers unless the customer agrees.

Public customers: some customers are public companies. Their own 8-K decisions may depend on what Quarrystone tells them. Share filing timing with them through counsel.

## 12. Ransom and extortion decision procedure

1. Nobody replies to the attacker. The IC sends that instruction to everyone who received the message, in writing, within one hour.
2. Preserve the message, the sending account and its sign-in history (section 10).
3. Outside counsel runs an OFAC sanctions screen of the actor, wallet and any intermediaries. OFAC's 2021 advisory strongly discourages payment and says payment to a sanctioned person can violate sanctions on a strict liability basis. Financial institutions handling a payment also have FinCEN obligations.
4. Notify the FBI and record the contact. OFAC counts prompt reporting and cooperation as a significant mitigating factor.
5. Notify the insurer and get its consent terms. Most policies require written consent before payment and the use of a panel negotiator.
6. The IC and the Cloud and IT lead give a written recovery estimate without paying. Key Vault soft delete and backup soft delete may make a decryptor unnecessary.
7. Counsel and the executive sponsor present the options to the board: do not engage; engage through the panel negotiator to buy time or validate claims; pay. The board decides. [FILL IN who may approve a payment and the limit]
8. Record the decision, who made it, the facts it relied on, and the time.
9. Paying does not remove any notice duty, does not undo exfiltration, and does not guarantee deletion. Change Healthcare reportedly paid and still faced a second extortion claim.

## 13. Communications templates

Plain language. No speculation about the attacker, the method or the scope. Every external statement is cleared by Legal and Privacy.

**Internal holding note (staff)**

> Subject: Security incident affecting our Azure systems
>
> We are responding to a security incident that is affecting our analytics systems and customer dashboards. Our security team and outside experts are working on it now.
>
> What you need to do: do not discuss the incident outside the company or on social media. Send any questions from customers or reporters to [FILL IN contact]. Be careful with unexpected messages, including Teams messages from colleagues asking for links or credentials.
>
> We will update you by [time] today.

**Customer notice (covered entity), first notice under the BAA**

> Subject: Notice of security incident under our business associate agreement
>
> On [date] we discovered a security incident affecting the Azure environment where we process your data. An unauthorized party gained administrative access, deleted and encrypted data, and may have copied data before deleting it.
>
> What we know: [facts]. What we do not yet know: [open questions]. Based on what we know, your organization's protected health information was stored in the affected systems.
>
> What we are doing: [containment and recovery steps]. We have notified law enforcement.
>
> We will send an update by [date] and will identify affected individuals as our investigation allows. We can send notices to individuals, HHS and media on your behalf if you ask us to in writing. Your contact for this incident is [name, phone, email].

**Regulator note outline (OCR data request or state AG)**

- Who we are and our role as a business associate.
- Dates: incident start (best estimate), discovery, containment, notice to each covered entity.
- What happened, in plain terms, and the systems involved.
- Types of PHI and the number of individuals, confirmed and estimated.
- Containment, eradication and recovery steps.
- Security measures in place before the incident, our most recent risk analysis, and changes since.
- Contact for follow-up.

**Media holding statement**

> Quarrystone Health Analytics is responding to a cybersecurity incident that has disrupted some of our services. We took steps to contain it, engaged outside experts and notified law enforcement. We are working directly with our customers and will share more as our investigation allows.

## 14. Post-incident review

Within 30 days of return to service, the IC runs a blameless review with every role in section 3.

- Timeline from first attacker activity to recovery, with the evidence for each point.
- What detected it, what should have detected it earlier, and why it did not: the unmonitored Entra Connect server, the synced Global Administrator with no MFA method, missing purge protection, and data plane logs that were off are the usual findings in this pattern.
- Each decision point (D-A, C-A, C-B, the ransom decision and the materiality determination): what was decided, when, by whom, and whether the playbook helped.
- Notice timeliness against each clock in section 11.
- Corrective actions with owners and dates, tracked to closure and reported to the board.
- Update this playbook and the risk analysis. OCR's ransomware settlements usually turn on the risk analysis.

## 15. Known gaps and placeholders

- [FILL IN] break-glass account names, key storage and holders.
- [FILL IN] outside counsel, IR retainer and insurer numbers.
- [FILL IN] out-of-band bridge and chat group, and who maintains the roster.
- [FILL IN] emergency Conditional Access policy names.
- [FILL IN] BAA notice terms per customer and contract notice addresses.
- [FILL IN] payment approval authority and limit.
- Gap: storage data plane logging is not on for every PHI lake account. Until it is, exfiltration cannot be scoped from logs.
- Gap: the Activity Log is kept for 90 days unless exported. Confirm the diagnostic setting.

## Sources

- Microsoft Threat Intelligence, "Storm-0501's evolving techniques lead to cloud-based ransomware," 2025-08-27. https://www.microsoft.com/security/blog/2025/08/27/storm-0501s-evolving-techniques-lead-to-cloud-based-ransomware/
- Microsoft Threat Intelligence, "Storm-0501: Ransomware attacks expanding to hybrid cloud environments," 2024-09-26. https://www.microsoft.com/en-us/security/blog/2024/09/26/storm-0501-ransomware-attacks-expanding-to-hybrid-cloud-environments/
- The Hacker News, "Storm-0501 exploits Entra ID to exfiltrate and delete Azure data," 2025-08. https://thehackernews.com/2025/08/storm-0501-exploits-entra-id-to.html
- Dark Reading, "Storm-0501 hits enterprise with 'cloud-based ransomware' attack," 2025-08. https://www.darkreading.com/cloud-security/storm-0501-cloud-based-ransomware-attack
- Microsoft Learn, Entra ID data retention. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-reports-data-retention
- Microsoft Learn, Purview audit log retention policies. https://learn.microsoft.com/en-us/purview/audit-log-retention-policies
- Microsoft Learn, Azure Monitor activity log. https://learn.microsoft.com/en-us/azure/azure-monitor/platform/activity-log
- Microsoft Learn, Revoke user access in Entra ID. https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access
- Microsoft Learn, Manage emergency access accounts. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
- Microsoft Learn, Azure Backup secure by default. https://learn.microsoft.com/en-us/azure/backup/secure-by-default
- Microsoft Learn, Immutable vault for Azure Backup. https://learn.microsoft.com/en-us/azure/backup/backup-azure-immutable-vault-concept
- Microsoft Learn, Immutable storage for blobs (not re-verified). https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview
- Microsoft Learn, Lock resources (not re-verified). https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources
- Microsoft Learn, Key Vault soft delete (not re-verified). https://learn.microsoft.com/en-us/azure/key-vault/general/soft-delete-overview
- Microsoft Learn, Manage storage account access keys (not re-verified). https://learn.microsoft.com/en-us/azure/storage/common/storage-account-keys-manage
- HHS, Breach Notification Rule (not re-verified). https://www.hhs.gov/hipaa/for-professionals/breach-notification/index.html
- eCFR, 45 CFR Part 164 Subpart D (not re-verified). https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D
- HHS, Ransomware Fact Sheet (not re-verified). https://www.hhs.gov/sites/default/files/RansomwareFactSheet.pdf
- HHS OCR, Change Healthcare Cybersecurity Incident FAQ (not re-verified). https://www.hhs.gov/hipaa/for-professionals/special-topics/change-healthcare-cybersecurity-incident-frequently-asked-questions/index.html
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
- Greenberg Traurig, "SEC clarifies confusion concerning cybersecurity incident reporting," 2024-05. https://www.gtlaw.com/ar/insights/2024/5/sec-clarifies-confusion-concerning-cybersecurity-incident-reporting
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Covington Inside Privacy, CISA submits final CIRCIA rule for OMB review. https://www.insideprivacy.com/critical-infrastructure/cisa-submits-final-circia-rule-for-omb-review/
- Reed Smith, "Pressure points in cyber insurance policies revealed in litigation," 2023-06. https://www.reedsmith.com/de/perspectives/cyber-insurance-claims/2023/06/pressure-points-in-cyber-insurance-policies-revealed-in-litigation
