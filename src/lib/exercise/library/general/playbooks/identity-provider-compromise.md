# Identity provider compromise response

[FILL IN organization name]. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CISO
- Approver: General counsel and CIO
- Review cycle: every 12 months, after every exercise that uses it, and whenever the identity provider, the help desk provider or its scripts change
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers an attacker who takes control of the workforce identity provider (IdP), such as Okta or Microsoft Entra ID, or of an account with administrative rights in it. With the IdP, an attacker reaches every application behind single sign-on: email, file storage, HR, CRM, source code, cloud consoles and remote access.

Patterns this playbook is written against:

- **Help desk social engineering (Scattered Spider pattern).** CISA's advisory AA23-320A, updated 2025-07-29, puts new emphasis on calls to the help desk to reset a password and move MFA to an attacker device. Okta reported in 2023 a consistent pattern of calls to customers' IT service desks to reset MFA for highly privileged users, followed by abuse of Super Administrator accounts to add an inbound identity provider and impersonate any user. At MGM in 2023 the attacker claimed Okta super administrator and Azure Global Administrator after a help desk call. Scattered Spider was heavily disrupted by arrests in 2025 and 2026 but is not confirmed defunct, and other crews copy the playbook.
- **Hybrid identity pivot (Storm-0501 pattern).** Microsoft reported in 2025 that Storm-0501 used an Entra Connect sync server to reach the cloud, found a synced non-human identity with Global Administrator and no MFA method, reset its password on premises, registered its own MFA method, then added a malicious federated domain so it could sign in as almost any user.
- **OAuth application abuse (Midnight Blizzard pattern).** Midnight Blizzard password sprayed a legacy test tenant account without MFA, found a test OAuth app with elevated access to Microsoft's corporate tenant, granted mailbox access to apps it created, and read senior leadership mail. App permissions persist after the person who created them is gone.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0. Owners and time targets are starting points.

In scope:

- The IdP (Okta, Entra ID, or both), its admin roles, federation settings, MFA and recovery flows, and directory sync agents.
- Every path that can reset a password or MFA method: the help desk (in house or outsourced), self-service recovery, and admins.
- Applications behind single sign-on, and OAuth grants to third-party apps.

This playbook pairs with the Crisis Sim template Okta takeover at a mutual insurer, which uses the same roles, decision points and clocks.

Out of scope: ransomware deployed after the takeover (use Ransomware and extortion response for encryption), and bulk theft from a single SaaS app without IdP compromise (use SaaS data theft and extortion response).

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Employee reports a password or MFA change they did not request | Any | Sev 2, Sev 1 if the account has admin or sensitive data access |
| Help desk reset on an account with an admin role or eligible for one | Any not verified under the rule in section 7 | Sev 1 |
| New identity provider, federated domain or inbound federation added | Any not matched to a change | Sev 1 |
| Admin role granted (Okta Super Administrator, Org Administrator; Entra Global Administrator, Privileged Role Administrator, Privileged Authentication Administrator) | Any not matched to a change | Sev 1 |
| MFA factor reset or new factor followed by sign-in from a new network, proxy or unmanaged device | Any | Sev 2 |
| Admin consent to a third-party OAuth app with mail, file or directory write scopes | Any not matched to a change | Sev 2, Sev 1 if the app is unknown |
| Bulk download from an SSO app by one user | Over [FILL IN] files or records in an hour | Sev 2 |
| Unknown participant in an incident call or channel | Any | Sev 1 |

Sev 1: incident commander named within 15 minutes, executive sponsor within 30 minutes, counsel and IR retainer within 2 hours.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CISO | Director of security operations |
| Security lead | Director of security operations | Senior incident responder |
| Identity lead | Identity and access management lead | Identity engineer |
| IT and SaaS lead | CIO | Enterprise applications manager |
| Legal and Privacy | General counsel | Chief privacy officer |
| Communications | Head of communications | Internal communications manager |
| Executive sponsor | CEO | COO |
| Help desk | Service desk manager, or outsourced provider's delivery manager [FILL IN 24 hour contact] | [FILL IN] |
| Outside counsel | [FILL IN] | [FILL IN] |
| IR retainer | [FILL IN] | [FILL IN] |
| Cyber insurer | [FILL IN policy number and hotline] | Broker [FILL IN] |

| Activity | IC | Security | Identity | IT and SaaS | Legal and Privacy | Comms | Exec sponsor | Help desk | Outside counsel | IR retainer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | C | C | I | I | I | I | I | I |
| Account and session containment | A | C | R | C | I | I | I | I | I | C |
| Reset freeze and verification rule | C | C | R | I | I | I | A | R | I | C |
| Admin plane and federation cleanup | A | C | R | C | I | I | I | I | I | C |
| Org-wide session revocation | C | C | R | R | I | C | A | C | I | C |
| OAuth app and SaaS review | A | R | C | R | I | I | I | I | I | C |
| Out-of-band coordination | A | R | C | I | I | R | I | I | I | I |
| Scope of data accessed | A | R | C | C | C | I | I | I | C | R |
| Notices | C | C | I | I | A | C | I | I | R | I |
| Staff and media messages | C | I | I | I | C | A | C | C | C | I |
| Ransom or extortion decision | C | C | I | I | R | I | A | I | R | C |
| Post-incident review | A | R | R | R | R | R | C | R | C | C |

## 4. Before an incident

- A written help desk verification rule that does not rely on knowledge questions (employee ID, Social Security number digits, manager's name). A caller who researched the target has them. Video with photo ID and a manager on the line, or in person, for any MFA reset. Tested by unannounced calls every quarter. [FILL IN test owner]
- Phishing-resistant MFA (FIDO2 security keys, passkeys, Okta FastPass, certificates) for every admin, which a help desk cannot reset by phone.
- Okta: re-authentication required for the Admin Console; self-service recovery limited to trusted networks or turned off for admins; alerts on identity provider creation, admin role grants and MFA factor resets for admins.
- Entra ID: admin roles eligible in PIM with approval on activation; Global Administrator accounts cloud only; Conditional Access requiring phishing-resistant MFA for admins; the directory sync account limited to the sync server's IP addresses; `federatedIdpMfaBehavior` set to reject MFA claims from federated IdPs where not needed.
- Break-glass: two emergency accounts per IdP, with credentials stored offline and a method different from normal admin sign-in, excluded from blocking policies, alert on every use, tested every 90 days. [FILL IN holders]
- Logs routed to long-term storage: Okta System Log, Entra sign-in and audit logs (30 days on P1 and P2 unless routed), Microsoft 365 Unified Audit Log, and audit logs of the major SSO apps. [FILL IN SIEM]
- An inventory of SSO apps with owners, and which apps keep their own sessions or tokens after IdP sign-out. [FILL IN]
- Out-of-band bridge and chat outside the corporate tenant, with an offline roster.

## 5. Detect

**D1.** Treat a user report of an unrequested reset as an incident until proven otherwise. The person who takes the report calls the security on-call line, not the help desk. Owner: whoever takes the report. Target: immediately.

**D2.** Pull the IdP trail for the account: resets, factor changes, sign-ins with IP, device and app, and admin actions. Owner: Identity lead. Target: 15 minutes.

```
Okta System Log (Admin Console > Reports > System Log, or API):
  eventType eq "user.mfa.factor.reset_all" or eventType eq "user.mfa.factor.deactivate"
  eventType eq "user.account.reset_password"
  eventType eq "system.idp.lifecycle.create" or eventType eq "system.idp.lifecycle.update"
  eventType eq "user.account.privilege.grant"

Entra ID (KQL):
AuditLogs
| where TimeGenerated > ago(3d)
| where OperationName in ("Reset password (by admin)", "Admin deleted security info",
    "User registered security info", "Add member to role", "Set domain authentication",
    "Set federation settings on domain", "Consent to application")
| project TimeGenerated, OperationName, InitiatedBy, TargetResources
```

**D3.** Get the help desk record for each reset: caller number, verification done, agent, ticket notes and recording. Ask the provider in writing to preserve every recording and ticket for the last 30 days. Owner: Security lead with help desk. Target: 1 hour.

**D4.** Look for follow-on calls on other accounts, especially IT staff, admins and executives. Attackers often research a second, more privileged target from runbooks or org charts. Owner: Security lead. Target: 1 hour.

**Decision point D-A: declare Sev 1?** Yes if an admin role was used or granted, federation or an identity provider changed, a second reset was attempted, or the account reached sensitive data. The IC records the time. Legal and Privacy records the earliest time anyone knew, which may start notice clocks.

## 6. Analyze

**A1.** List everything an admin could have changed since the first reset: users, factors, admin roles, groups, policies (sign-on, MFA, password, network zones), identity providers and federated domains, API tokens, OAuth apps and service principal credentials, and app assignments. Owner: Identity lead. Target: 4 hours.

**A2.** List what survives a password reset: app sessions issued by each SSO app, OAuth refresh tokens, personal access tokens (GitHub, Databricks, Snowflake), app passwords, API tokens created in the IdP, and SSH keys. Okta's session clear does not end sessions created inside apps; Entra does not revoke cookies issued by the apps themselves. Owner: Identity lead with IT and SaaS lead. Target: 4 hours.

**A3.** Map data access per app: mail (MailItemsAccessed), file downloads, CRM exports, code repository clones, cloud console activity. Owner: Security lead. Target: 24 hours, then daily.

**A4.** Check whether the attacker can see the response: membership of incident channels and calls, mailbox rules on responders' mailboxes, delegated access. Owner: Security lead. Target: 1 hour.

**A5.** Check the hybrid side. If on-premises AD syncs to the IdP, check whether the sync server or a synced account with admin rights was used, as in the Storm-0501 case. Owner: Identity lead. Target: 8 hours.

## 7. Contain

**C1. Contain the account.** Disable in AD if synced, reset the password twice, suspend or disable in the IdP, clear sessions and revoke tokens, remove the attacker's factors, and revoke app tokens the account created. Owner: Identity lead. Target: 15 minutes from confirmation.

```
# Okta: clear IdP sessions and revoke OAuth tokens for a user
DELETE /api/v1/users/{userId}/sessions?oauthTokens=true
# Okta: suspend the user
POST /api/v1/users/{userId}/lifecycle/suspend

# Entra ID
Update-MgUser -UserId <upn> -AccountEnabled:$false
Revoke-MgUserSignInSession -UserId <upn>
Get-MgUserAuthenticationMethod -UserId <upn>
```

Where apps support it, use Okta Universal Logout (Global Token Revocation) to end app sessions too. For apps that do not, end sessions in each app's admin console.

**C2. Freeze resets.** Tell the help desk in writing to stop every password and MFA reset for admins and IT staff until the IC lifts the freeze. Turn off self-service recovery for admins. Owner: Identity lead. Target: 30 minutes.

**Decision point C-A: the verification rule.** From declaration until the post-incident review, every MFA reset needs a video call with photo ID and the employee's manager on the line, with no exception for executives. If video is not possible, the reset waits or happens in person. The executive sponsor approves and the help desk provider confirms in writing.

**C3. Clean the admin plane.** Sign in with a break-glass account. Remove identity providers, federated domains and inbound federation you did not create; remove admin role grants, API tokens and new users; restore changed policies. Owner: Identity lead. Target: 1 hour.

```
# Entra ID: domains and federation
Get-MgDomain | Select Id, AuthenticationType
Get-MgDomainFederationConfiguration -DomainId <domain>
# Okta: identity providers
GET /api/v1/idps
GET /api/v1/api-tokens
```

**Decision point C-B: revoke sessions for everyone?** If an attacker had admin rights or could forge sign-ins (rogue identity provider, federated domain, stolen signing key), revoke sessions for every user and every admin, and force re-authentication with MFA. Staff lose a morning, and apps that keep their own sessions need separate action. The executive sponsor approves, Communications warns staff first, and the IC records the time.

**Decision point C-C: shut down directory sync?** Do not shut down sync agents (Okta AD agent, Entra Connect) by reflex. MGM shut down Okta sync servers in 2023 and the outage worsened. Stop sync only if the on-premises side is compromised or a synced account is being used to regain access. Cloud admin roles are not removed by stopping sync. The IC records the reason either way.

**C4. OAuth apps.** Review third-party apps with consent to mail, files or directory, especially those consented in the incident window. Revoke grants and disable service principals you do not recognize. A password reset does not stop an app that already has consent. Owner: IT and SaaS lead. Target: 4 hours.

```
# Entra ID
Get-MgOauth2PermissionGrant -All | Where-Object { $_.ConsentType -eq "AllPrincipals" }
Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId <id>
Update-MgServicePrincipal -ServicePrincipalId <id> -AccountEnabled:$false
```

**C5. Cloud consoles.** For AWS, Google Cloud or Azure reached through SSO, review IAM changes since the first reset: new users, access keys, roles, trust policies and federation. Remove what the attacker created and rotate keys they could have read. Owner: Security lead. Target: 8 hours.

**C6. Move the response out of band** and verify each person by calling back on a number from the offline roster. Owner: Communications with Security lead. Target: 1 hour.

**C7. Warn staff.** IT and the help desk never ask you to read out a code, approve a prompt you did not start, or install remote access software. Report such calls to [FILL IN]. Owner: Communications. Target: same day.

## 8. Eradicate

**E1.** Remove every item in the A1 list and verify removal in the logs. Owner: Identity lead.

**E2.** Rotate secrets the attacker could have read in wikis, runbooks, shared drives, code repositories and pipelines. Owner: IT and SaaS lead.

**E3.** Re-enroll admins with phishing-resistant MFA in person or by verified video. Owner: Identity lead.

**E4.** If the IdP signing certificate or a federation trust may be exposed, rotate the signing certificate and re-establish federation with each app. Owner: Identity lead.

## 9. Recover

**R1.** Restore accounts through the verified process. Each restored user registers a phishing-resistant method where possible. Owner: Identity lead.

**Decision point R-A: restore admin access.** Admin roles come back one person at a time, each with phishing-resistant MFA and an approval on the record. The executive sponsor approves the list.

**R2.** Lift the reset freeze only when the verification rule is in the help desk script and has passed one unannounced test call. Owner: Identity lead.

**Return to service criteria.** Normal operations resume when the Security lead and Identity lead sign that:

- Every item in the A1 and A2 lists is removed or rotated.
- No attacker sign-in or token use in 72 hours of monitoring.
- The verification rule is in force and tested.
- Admins use phishing-resistant MFA.
- Data access scoping for each app is written down, including what the logs cannot prove.

## 10. Evidence preservation and chain of custody

- Help desk call recordings, tickets and agent notes, preserved by the provider under a written hold.
- Okta System Log or Entra audit and sign-in logs, Unified Audit Log, and audit logs of every SSO app in scope, exported to storage the attacker never had access to. Okta System Log and Entra logs have limited retention unless routed.
- A snapshot of IdP configuration before cleanup: identity providers, federation, policies, admin assignments, API tokens and OAuth grants.
- Any extortion message with full headers, kept and exported. Never delete it.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location and transfers. [FILL IN location]
- The IR retainer works at the direction of outside counsel.

## 11. Regulatory and contractual notification matrix

| Notice | To | Trigger and deadline | Owner |
|---|---|---|---|
| Cyber insurer | Insurer hotline | As soon as practicable. Policy: [FILL IN, assumed 48 hours]. Panel vendors or written consent. | General counsel |
| NYDFS (if covered) | Superintendent | No later than 72 hours after determining a cybersecurity incident occurred at the entity, an affiliate or a third-party service provider (500.17(a)). Extortion payment: 24 hours, then written explanation within 30 days (500.17(c)). | General counsel |
| SEC Form 8-K (if listed) | SEC | Item 1.05 within four business days of a materiality determination. Item 8.01 for voluntary disclosure before one. | General counsel and CFO |
| US state breach laws | Residents and attorneys general | If personal information was acquired. Varies; example: Texas AG within 30 days of determining a breach of 250 or more Texas residents. | Outside counsel |
| GDPR (if EU or UK personal data) | Lead supervisory authority | Within 72 hours of awareness where feasible. | Chief privacy officer |
| FBI | Field office or IC3 | Early. | General counsel |
| Customers and partners | Per contract | [FILL IN] | Legal and Privacy |
| IdP vendor | Okta or Microsoft support | Open a security case early; the vendor can see signals you cannot. | Identity lead |

Clocks run from the start event each rule defines, not from the end of scoping. Send what is known and supplement.

## 12. Ransom and extortion decision procedure

Identity takeovers often end in data theft and an extortion demand, sometimes with encryption of ESXi or cloud workloads.

1. Nobody replies to the attacker. Staff forward messages to the IC through the out-of-band channel.
2. Security preserves the message with headers and matches any sample to source apps.
3. Outside counsel runs an OFAC sanctions screen. Payment to a sanctioned person can violate sanctions on a strict liability basis.
4. Counsel reports to the FBI and shares indicators.
5. The insurer confirms consent terms and its panel negotiator.
6. The executive sponsor presents options to the board; the board decides. [FILL IN approval authority]
7. Record the decision, who made it, the basis and the time. If a NYDFS covered entity pays, the 24 hour report applies.

Reference cases from September 2023: Caesars reportedly paid about $15 million of a $30 million demand after a social engineering attack on its outsourced IT support vendor; MGM reportedly did not pay and reported about a $100 million hit to adjusted property EBITDAR for the quarter. Neither is a rule.

## 13. Communications templates

**Internal note (before org-wide session revocation)**

> Subject: Action needed: sign in again today
>
> As part of a security response, we are ending every sign-in session at [time]. You will need to sign in again with your security key or authenticator. If you cannot sign in, call [FILL IN] from a phone, not by email.
>
> IT will never ask you to read out a code or approve a prompt you did not start. Report any such call to [FILL IN].

**Help desk provider instruction**

> Effective immediately and until written notice from [IC name], do not reset a password or MFA method for any user without a video call, photo ID matched to HR records, and the user's manager on the call. No exceptions for executives. Log every request, including refused ones, and send the log to [FILL IN] daily.

**Regulator note outline**

- Who we are and why this regulator is notified.
- Dates of the first reset, discovery, containment and this notice.
- How access was obtained, in plain terms, and which systems were reached.
- Data types and number of individuals, confirmed and estimated.
- Changes to help desk verification and admin MFA.
- Contact for follow-up and the next update date.

**Media holding statement**

> [Organization] is investigating a cybersecurity incident involving unauthorized access to some employee accounts. We contained the access, engaged outside experts and notified law enforcement. We will contact anyone whose information was affected.

## 14. Post-incident review

Within 30 days of return to service:

- Timeline from the first call to recovery.
- Why the help desk accepted the caller, and whether the verification rule would have stopped it.
- Each decision point (D-A, C-A, C-B, C-C, R-A and any extortion decision): what was decided, when, by whom.
- Which apps kept attacker sessions after IdP revocation, and how long it took to end them.
- Whether the attacker saw the response.
- Notice timeliness against each clock.
- Corrective actions with owners and dates, reported to the board. Make the verification rule permanent in the help desk contract.

## 15. Known gaps and placeholders

- [FILL IN] help desk 24 hour contact and contract clause for the verification rule.
- [FILL IN] admin account list and break-glass holders.
- [FILL IN] SSO app inventory with session behavior.
- [FILL IN] out-of-band bridge and offline roster.
- [FILL IN] counsel, IR retainer and insurer numbers.
- Gap: app-level sessions are not ended by IdP revocation for apps without Universal Logout or equivalent.

## Sources

- NIST SP 800-61r3, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- CISA, AA23-320A Scattered Spider (rev. 2025-07-29). https://www.cisa.gov/news-events/cybersecurity-advisories/aa23-320a
- Okta Security, "Cross-Tenant Impersonation: Prevention and Detection," 2023-08. https://sec.okta.com/articles/2023/08/cross-tenant-impersonation-prevention-and-detection
- Okta Developer, User Sessions API. https://developer.okta.com/docs/api/openapi/okta-management/management/tags/usersessions
- Okta Developer, Global Token Revocation. https://developer.okta.com/docs/api/openapi/okta-oauth/oauth/globaltokenrevocation
- Okta Help, Revoke all user sessions. https://help.okta.com/en-us/content/topics/security/slo/session-revoke.htm
- Microsoft Threat Intelligence, "Storm-0501's evolving techniques lead to cloud-based ransomware," 2025-08-27. https://www.microsoft.com/security/blog/2025/08/27/storm-0501s-evolving-techniques-lead-to-cloud-based-ransomware/
- MSRC, "Microsoft actions following attack by nation state actor Midnight Blizzard," 2024-01-19. https://msrc.microsoft.com/blog/2024/01/microsoft-actions-following-attack-by-nation-state-actor-midnight-blizzard/
- Microsoft Security, "Midnight Blizzard: Guidance for responders on nation-state attack," 2024-01-25. https://www.microsoft.com/en-us/security/blog/2024/01/25/midnight-blizzard-guidance-for-responders-on-nation-state-attack/
- Microsoft Learn, Revoke user access in Entra ID. https://learn.microsoft.com/en-us/entra/identity/users/users-revoke-access
- Microsoft Learn, Manage emergency access accounts. https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
- Microsoft Learn, Detect and remediate illicit consent grants. https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants
- Microsoft Learn, Entra ID data retention. https://learn.microsoft.com/en-us/entra/identity/monitoring-health/reference-reports-data-retention
- MGM Resorts Form 8-K, 2023-10-05. https://www.sec.gov/Archives/edgar/data/789570/000119312523251667/d461062d8k.htm
- Caesars Entertainment Form 8-K, 2023-09-14. https://www.sec.gov/Archives/edgar/data/1590895/000119312523235015/d537840d8k.htm
- Kolide/1Password, "What everyone got wrong about the MGM hack." https://www.kolide.com/blog/what-everyone-got-wrong-about-the-mgm-hack
- 23 NYCRR 500.17. https://www.law.cornell.edu/regulations/new-york/23-NYCRR-500.17
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
