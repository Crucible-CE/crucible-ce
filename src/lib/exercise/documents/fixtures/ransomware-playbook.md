# Ransomware Response Playbook

Cobalt Ridge Logistics (fictional organization for exercises). Version 2.1. Owner: Chief Information Security Officer.

## 1. Purpose and Scope

This playbook describes how Cobalt Ridge Logistics detects, contains, and recovers from a ransomware incident. It applies to all corporate systems, the warehouse management system (WMS), and the fleet dispatch platform. It does not replace the Business Continuity Plan, which governs manual warehouse operations during an outage.

## 2. Roles and Responsibilities

The Incident Commander (IC) is the on-call Security Operations Manager. The IC owns the response until the CISO takes command.

The CISO decides whether to escalate to the Crisis Management Team (CMT) and approves any contact with the threat actor.

The IT Infrastructure Lead executes network isolation and owns restoration from backups.

The General Counsel decides on regulatory and customer notifications and engages outside counsel and the cyber insurance carrier.

The Communications Director drafts all internal and external statements. No employee may speak to the media about an incident without approval from the Communications Director and the General Counsel.

## 3. Detection and Declaration

3.1 Triggers

Any of the following is treated as suspected ransomware: an EDR alert for mass file encryption, a ransom note on any host, more than 50 file renames per minute on a file server, or a report from a user who cannot open files with changed extensions.

3.2 Declaring an Incident

The SOC analyst on shift validates the alert within 15 minutes and pages the IC. The IC declares a Severity 1 incident when encryption is confirmed on more than one host or on any server. The IC opens the incident bridge and records the declaration time in the incident log.

3.3 Severity Levels

Severity 1 means business critical systems are affected or more than one site is affected. Severity 2 means a single non-critical system is affected. Severity 1 incidents require CISO notification within 30 minutes of declaration.

## 4. Containment

4.1 Immediate Actions

The IT Infrastructure Lead isolates affected hosts using the EDR network containment feature. If more than 10 hosts are affected, the IT Infrastructure Lead disables the site-to-site VPN tunnels for the affected sites. Do not power off encrypted hosts, because memory evidence may be lost.

4.2 Identity Protection

The IC directs the identity team to reset passwords for all privileged accounts and to revoke active sessions for any account seen on an affected host. Service account credentials stored on affected hosts are treated as compromised.

If a domain administrator account is compromised, the identity team resets the krbtgt account password twice, with at least 10 hours between the two resets, and hunts for accounts, group policy objects and scheduled tasks created during the incident. In the cloud identity provider, the identity team revokes sessions and refresh tokens for affected accounts and reviews newly registered MFA methods. A password reset alone does not end existing sessions.

When email or chat may be monitored by the attacker, the response team moves to the out-of-band bridge and contact list kept in the printed incident binder.

4.3 Evidence Preservation

Before any host is reimaged, the forensic retainer firm collects memory and disk images. The IC requests the retainer through the insurance carrier hotline so that costs are covered under the policy.

## 5. Escalation and Decision Making

5.1 Crisis Management Team

The CISO convenes the CMT within one hour when a Severity 1 incident affects the WMS or fleet dispatch platform, or when data exfiltration is suspected. The CMT includes the CEO, COO, General Counsel, CFO, and Communications Director.

5.2 Ransom Payment

Cobalt Ridge Logistics does not pay ransom as a default position. Any exception requires a decision by the CEO after advice from the General Counsel, outside counsel, and law enforcement, and a sanctions check on the threat actor. No one engages the threat actor without written approval from the CISO.

## 6. Notification

6.1 Law Enforcement

The General Counsel notifies the FBI field office within 24 hours of a Severity 1 declaration.

6.2 Regulators and Customers

If personal data may have been accessed, the General Counsel starts the breach assessment immediately. State breach notification deadlines are tracked by the legal team. Customer notifications for shipment delays are sent by the Communications Director when any delivery commitment will be missed by more than 24 hours.

6.3 Cyber Insurance

The General Counsel notifies the cyber insurance carrier within 48 hours of declaration, as required by the policy.

## 7. Recovery

7.1 Restoration Order

Systems are restored in this order: identity services, the WMS, fleet dispatch, finance systems, then email and collaboration tools.

7.2 Backup Validation

Before restoring, the IT Infrastructure Lead confirms that the immutable backup copies are older than the earliest known attacker activity and scans them for malware. Restored systems stay on an isolated network segment until the IC approves reconnection.

7.3 Return to Normal Operations

The IC declares recovery complete when the WMS and fleet dispatch have run for 24 hours without new indicators of compromise.

## 8. After Action

The CISO holds a hotwash within 72 hours of recovery and publishes an after-action report with an improvement plan within 30 days.
