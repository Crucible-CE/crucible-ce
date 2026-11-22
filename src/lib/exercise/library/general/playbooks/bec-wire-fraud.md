# Business email compromise and wire fraud response

[FILL IN organization name]. Incident response playbook.

- Version: 1.0
- Date: 2026-10-26
- Owner: CFO and CISO jointly
- Approver: General counsel
- Review cycle: every 12 months, after every exercise that uses it, and when banks, payment platforms or the ERP change
- Status: library sample shipped with Crucible CE. Duplicate it, then replace every item marked [FILL IN] with your own details.

## 1. Purpose and scope

This playbook covers business email compromise (BEC): an attacker uses a compromised or spoofed mailbox to change where money goes. The common cases are a fake request from an executive, a change to a vendor's bank details, and an invoice from a real vendor whose own mailbox was compromised. It also covers the mailbox takeover that usually comes first: inbox rules that hide replies, forwarding, and OAuth apps that keep access after a password reset.

The FBI's Internet Crime Complaint Center (IC3) counted about $55.5 billion in exposed BEC losses worldwide from October 2013 to December 2023. Its guidance is short: time is of the essence. Call the bank, ask for a recall, and file with IC3 at once. In 2025 IC3's Recovery Asset Team froze about 61 percent of reported domestic losses in the cases it took. FinCEN's Rapid Response Program, which works with foreign financial intelligence units on international wires, has more success when the fraud is reported to law enforcement within 72 hours of the transfer.

The first hour after the fraud is found matters more than the rest of the response. Section 5 is written to be done in that hour.

Phases follow NIST SP 800-61r3 and the Respond and Recover functions of NIST CSF 2.0. Owners and time targets are starting points.

This playbook pairs with the Crisis Sim template Vendor payment fraud at a manufacturer, which uses the same roles, decision points and clocks.

In scope: Microsoft 365 or Google Workspace mailboxes, accounts payable and treasury processes, the ERP vendor master, bank portals, and communications with vendors and customers about payments.

## 2. Severity and declaration criteria

| Signal | Threshold | Severity |
|---|---|---|
| Payment sent to an account the payee did not own | Any amount | Sev 1 |
| Vendor says it was not paid, and the payment went to changed bank details | Any | Sev 1 |
| Request to change vendor bank details by email | Any not verified by call-back | Sev 2 |
| Inbox rule that forwards, deletes or moves mail to Notes, Junk Email or RSS Subscriptions | Any on finance, executive or AP mailboxes | Sev 2 |
| New OAuth app with mail read or send scopes on a finance mailbox | Any not matched to a change | Sev 2 |
| Lookalike domain of yours or a vendor's in mail to finance | Any | Sev 3, Sev 2 if a payment was requested |
| Request to buy gift cards or send an urgent confidential wire from an executive | Any | Sev 3, Sev 1 if paid |

Sev 1: finance lead and security lead on a call within 15 minutes; the bank called within 30 minutes of discovery.

## 3. Roles and RACI

| Role | Primary | Backup |
|---|---|---|
| Incident commander (IC) | CFO for payment fraud, CISO for mailbox takeover | Controller or director of security operations |
| Treasury lead | Treasurer | Assistant treasurer |
| Accounts payable lead | AP manager | Senior AP specialist |
| Security lead | Director of security operations | IT manager |
| Legal | General counsel | Outside counsel |
| Communications | Head of communications | [FILL IN] |
| Executive sponsor | CEO | COO |
| Procurement | Head of procurement | Category manager for the vendor |
| Bank relationship manager | [FILL IN bank, 24 hour fraud line] | [FILL IN] |
| Outside counsel | [FILL IN] | [FILL IN] |
| Insurer (crime or cyber policy) | [FILL IN policy number and claims line] | Broker [FILL IN] |

| Activity | IC | Treasury | AP | Security | Legal | Comms | Exec sponsor | Procurement | Bank | Insurer |
|---|---|---|---|---|---|---|---|---|---|---|
| Declare and set severity | A | R | R | R | I | I | I | I | I | I |
| Recall request to the bank | A | R | C | I | C | I | I | I | R | I |
| IC3 complaint and law enforcement | A | R | C | C | R | I | I | I | I | I |
| Payment hold on changed bank details | A | R | R | I | I | I | C | C | I | I |
| Mailbox containment | C | I | I | R | I | I | I | I | I | I |
| Vendor contact and verification | C | C | R | C | C | I | I | R | I | I |
| Insurer notice and proof of loss | C | R | C | C | A | I | I | I | I | R |
| Data exposure review and notices | C | I | I | R | A | C | I | I | I | I |
| Staff, vendor and customer messages | C | I | C | I | C | A | C | R | I | I |
| Control changes | R | R | R | R | C | I | A | R | I | I |
| Post-incident review | A | R | R | R | R | C | C | R | I | I |

## 4. Before an incident

- Bank details change only after a call-back to a number already on file, never a number in the request. Two people approve the change in the ERP. A new or changed account has a hold period before first payment. [FILL IN hold period]
- Wires above [FILL IN threshold] need two approvers and a call-back to the payee on file.
- The bank's fraud line and the relationship manager's mobile number are on a printed card in treasury and AP. [FILL IN]
- Treasury knows how to request a recall in each bank portal and what each bank needs: amount, date, time, beneficiary bank and account, reference, and a hold harmless or indemnity letter if the bank asks.
- Mailbox auditing on, Unified Audit Log retained, and alerts on new inbox rules, external forwarding and OAuth consents for finance and executive mailboxes. External auto-forwarding blocked by default.
- Phishing-resistant MFA for finance, executive and AP users.
- Lookalike domain monitoring for your domains and your top vendors. [FILL IN service]
- DMARC at enforcement on your domains.
- Insurance: know whether the loss falls under a crime policy (social engineering or funds transfer fraud coverage, often with a sublimit) or a cyber policy, and the notice terms of each. [FILL IN]

## 5. Detect: the first hour

**W1. Call the sending bank.** Use the fraud line, not email. Ask for a recall of the payment and for the bank to send a recall or fraud message to the beneficiary bank. Give amount, value date, time, beneficiary bank, account, and reference. Write down the time, the person and the case number. Owner: Treasury lead. Target: 30 minutes from discovery.

**W2. File with IC3.** File a complaint at ic3.gov with every banking field filled in: originating bank and account, beneficiary bank, account, routing or SWIFT code, amount and date. IC3's Recovery Asset Team works with the beneficiary bank to freeze funds when its criteria are met. For international wires, law enforcement passes cases to FinCEN's Rapid Response Program, which has more success when reported within 72 hours of the transfer. Call the local FBI field office as well. Owner: Treasury lead with Legal. Target: 1 hour.

**W3. Stop the next payment.** Hold every pending payment to the changed account and every payment to any vendor whose bank details changed in the last 90 days, until each is verified by call-back. Owner: AP lead. Target: 1 hour.

**Decision point W-A: hold all vendor payments?** If you do not yet know which mailbox was compromised, yours or the vendor's, consider a short hold on all payments with recent bank changes, not all payments. A full payment stop hurts vendors who did nothing wrong. The IC decides and records the scope and end time.

**W4. Preserve the email trail.** Keep the fraudulent emails with full headers, the invoice, and the bank change request. Do not delete or forward them outside security. Owner: AP lead. Target: 1 hour.

**Decision point D-A: declare.** A completed fraudulent payment is Sev 1. The IC records the discovery time, the time of the bank call and the IC3 complaint number.

## 6. Analyze

**A1. Whose mailbox?** Read the headers. Did the fraudulent mail come from your tenant, the vendor's real domain, or a lookalike domain? Owner: Security lead. Target: 2 hours.

**A2. Your mailboxes.** For every finance and executive mailbox involved, check sign-ins, inbox rules (including hidden ones), forwarding, delegates and OAuth consents. Owner: Security lead. Target: 4 hours.

```
Get-InboxRule -Mailbox <upn> -IncludeHidden | Format-List Name,Enabled,RedirectTo,Forward*,MoveToFolder,DeleteMessage,Identity
Get-Mailbox -Identity <upn> | Format-List Forwarding*Address,DeliverTo*
Get-MailboxPermission -Identity <upn> | Where-Object { $_.User -notlike "NT AUTHORITY*" }
Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-30) -EndDate (Get-Date) -UserIds <upn> -Operations New-InboxRule,Set-InboxRule,UpdateInboxRules,Consent
```

In Google Workspace, check the user's mail filters and forwarding in the Admin console and the token audit log for third-party apps.

**A3. What the attacker read.** Use MailItemsAccessed where available, and message trace for mail sent from the account. Look for other payment threads the attacker could reuse. Owner: Security lead. Target: 24 hours.

**A4. Personal data.** Did the mailbox hold employee or customer personal data, such as W-2 forms, payroll files or customer records? That can start breach notice duties (section 11). Owner: Legal. Target: 48 hours.

**A5. Finance controls.** Walk the payment through every control it passed: who received the change request, whether a call-back was made and to which number, who approved the vendor master change, who released the wire, and whether the bank's own alerts fired. The answer feeds the post-incident review and the insurance claim, which often asks which controls were in place. Owner: Controller. Target: 72 hours.

**A6. Other victims.** If the vendor's mailbox was compromised, other customers of that vendor may be targeted. If yours was, your customers may receive fake invoices from your domain. Owner: Procurement and Security lead. Target: same day.

## 7. Contain

**C1. Contain the mailbox.** Disable the account, reset the password (twice in AD if synced), revoke sessions, remove unknown MFA methods, remove the attacker's inbox rules, forwarding and delegates, and revoke OAuth apps the attacker consented to. A password reset does not stop an app that already has consent, and app passwords are not revoked by a reset. Owner: Security lead. Target: 1 hour.

```
Update-MgUser -UserId <upn> -AccountEnabled:$false
Revoke-MgUserSignInSession -UserId <upn>
Remove-InboxRule -Mailbox <upn> -Identity "<rule identity>"
Set-Mailbox -Identity <upn> -ForwardingSmtpAddress $null -DeliverToMailboxAndForward $false
Remove-MgOauth2PermissionGrant -OAuth2PermissionGrantId <id>
```

**C2. Block** the lookalike domains and sender addresses at the mail gateway, and report the domains to the registrar. Owner: Security lead. Target: 4 hours.

**C3. Tell the vendor** by phone at a number on file, not one in the emails. If their mailbox was compromised, they need to know now. Owner: Procurement. Target: same day.

**Decision point V-A: pay the vendor again?** The vendor is still owed. Whether you pay again before recovery depends on the contract, the relationship, and whether your process or theirs failed. Counsel advises; the CFO decides and records the basis. Do not pay again to bank details that came by email.

## 8. Eradicate

**E1.** Remove every rule, forward, delegate, app and session found in A2. Search the tenant for the same rule names and apps on other mailboxes. Owner: Security lead.

**E2.** Correct the vendor master: restore the verified bank details, flag the record, and review every vendor bank change in the last 12 months by call-back. Owner: AP lead.

## 9. Recover

**R1.** Track the recall daily with the bank and the FBI. Keep a log of every contact. Owner: Treasury lead.

**R2.** File the insurance claim with the proof of loss the policy requires, by its deadline. Owner: Legal with Treasury.

**R3.** Restore payments to vendors in verified order. Owner: AP lead.

**R4.** Book the loss and any recovery correctly; tell the auditors. Owner: Controller.

**Return to service criteria.** Normal payment operations resume when the IC signs that:

- Every compromised mailbox is clean and monitored for 14 days.
- Every pending payment to changed bank details is verified by call-back.
- The vendor master changes in the last 12 months are reviewed.
- The call-back and dual approval controls are in force and tested once.

## 10. Evidence preservation and chain of custody

- Fraudulent emails with full headers, attachments and invoice files, exported as .eml or .msg.
- Unified Audit Log and sign-in logs for affected mailboxes, exported for at least 90 days before the fraud.
- Bank confirmations, recall requests, case numbers and call notes.
- IC3 complaint number and a copy of the submission.
- ERP change history for the vendor record.
- Evidence log: item, source, collector, UTC time, SHA-256 hash, location. [FILL IN location]

## 11. Regulatory and contractual notification matrix

| Notice | To | Trigger and deadline | Owner |
|---|---|---|---|
| Sending bank | Fraud line | Immediately. Ask for a recall and a message to the beneficiary bank. | Treasury lead |
| IC3 and FBI | ic3.gov, field office | Immediately, regardless of amount. | Treasury lead |
| FinCEN Rapid Response Program | Through law enforcement (IC3 or US Secret Service) | Best within 72 hours of the transfer for international wires. Victims do not apply to FinCEN directly. | Treasury lead |
| Insurer | Crime or cyber policy | Per policy: [FILL IN notice and proof of loss terms]. Many crime policies require notice soon after discovery. | Legal |
| Auditors and audit committee | External auditor, audit committee chair | Promptly for a material loss or a control failure. | CFO |
| US state breach laws | Residents and attorneys general | Only if personal information in the mailbox was acquired. Example: Texas AG within 30 days of determining a breach of 250 or more Texas residents. | Legal |
| Customers | Customers who may receive fake invoices from your domain | Same day if your mailbox was used. | Communications |
| SEC (if listed) | SEC | A large loss may need disclosure; a mailbox compromise may be a cybersecurity incident for Item 1.05 if material. | General counsel |

## 12. Ransom, extortion and payment demands

BEC is usually theft, not extortion, but three variants happen:

1. **Extortion with mailbox data.** The attacker threatens to publish mail it read. Treat it as data extortion: do not reply, preserve the message, run an OFAC screen, tell the FBI and the insurer, and follow the decision steps in Ransomware and extortion response, section 12.
2. **Recovery scams.** After a loss, someone offers to recover the funds for a fee. Recovery comes through the banks and law enforcement, not through a paid intermediary who calls you.
3. **Repeat requests.** The attacker, still in a mailbox, sends a second invoice saying the first payment failed. The payment hold in W3 stops this.

No payment is made to anyone claiming to hold or return funds without counsel's approval.

## 13. Communications templates

**Bank recall request (follow-up in writing after the call)**

> Subject: Fraud recall request, [reference]
>
> We request an immediate recall of the following payment, which was sent as a result of fraud: amount [amount], value date [date], time [time], beneficiary bank [bank, SWIFT or routing], beneficiary account [number], beneficiary name [name], our reference [reference]. We have filed IC3 complaint [number]. Please send a recall and fraud notice to the beneficiary bank and confirm by reply. We will provide an indemnity letter if required. Contact [name, phone].

**Vendor notice**

> We have found fraudulent emails that appear to come from [your company or our company] about a change of bank details. Please do not act on any payment instruction by email until we confirm it by phone. We will call you from [number] to confirm your bank details. If your email account may be compromised, please check it today.

**Customer notice (our domain used)**

> You may receive emails that appear to come from us asking you to pay to new bank details. Our bank details have not changed. Do not pay to any new account without calling us at [number on your contract].

**Staff note**

> Finance will never change bank details or send an urgent wire on email alone. If you get a request like this, call the sender on a number you already have and tell [FILL IN].

## 14. Post-incident review

Within 30 days:

- Timeline from mailbox compromise to discovery, recall and recovery.
- How long from discovery to the bank call and to the IC3 complaint.
- Each decision point (D-A, W-A, V-A): what was decided, when, by whom.
- Which control failed: call-back, dual approval, hold period, mailbox alerts, DMARC.
- Amount recovered and lost; insurance outcome.
- Corrective actions with owners and dates, reported to the audit committee.

## 15. Known gaps and placeholders

- [FILL IN] bank fraud lines and relationship managers.
- [FILL IN] payment thresholds, hold periods and approvers.
- [FILL IN] insurance policies and notice terms.
- [FILL IN] lookalike domain monitoring service.
- Gap: IC3 does not publish the Recovery Asset Team's eligibility criteria in its brochure. Do not wait to find out: file at once.

## Sources

- NIST SP 800-61r3, 2025. https://csrc.nist.gov/pubs/sp/800/61/r3/final
- FBI IC3, PSA I-091124-PSA, "Business Email Compromise: The $55 Billion Scam," 2024-09-11. https://www.ic3.gov/PSA/2024/PSA240911
- FBI IC3, Domestic Financial Fraud Kill Chain process (Recovery Asset Team). https://www.ic3.gov/Outreach/Brochures/IC3-FFKC_Domestic.pdf
- FBI IC3, 2025 Internet Crime Report. https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf
- FinCEN, Rapid Response Program fact sheet, 2026-04. https://www.fincen.gov/system/files/2026-04/RRPFactSheet.pdf
- FinCEN, "FinCEN's Rapid Response Program interdicts nearly $2 billion on behalf of U.S. cyber-enabled fraud victims." https://www.fincen.gov/news/news-releases/fincens-rapid-response-program-interdicts-nearly-2-billion-behalf-us-cyber
- Microsoft Learn, Respond to a compromised email account in Microsoft 365. https://learn.microsoft.com/en-us/defender-office-365/responding-to-a-compromised-email-account
- Microsoft Learn, Detect and remediate illicit consent grants. https://learn.microsoft.com/en-us/defender-office-365/detect-and-remediate-illicit-consent-grants
- Sullivan and Cromwell, OFAC updated ransomware advisory, 2021-09. https://www.sullcrom.com/insights/memo/2021/September/OFAC-Updates-Ransomware-Advisory
- Texas SB 768. https://capitol.texas.gov/tlodocs/88R/billtext/html/SB00768F.htm
