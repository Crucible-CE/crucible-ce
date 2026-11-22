import { z } from "zod";

// Pressure artifact kit for Crisis Sim and Strategic TTX. Each template is
// markdown with {{placeholders}}. Required: {{orgName}}, {{incidentSummary}},
// {{time}}. Any other {{name}} can be filled from extra vars; unfilled ones
// are left as-is so the author can see them. All people and outlets named
// here are fictional.

export const ARTIFACT_KINDS = [
  "email",
  "social_post",
  "news",
  "ransom_note",
  "regulator_letter",
  "chat",
  "voicemail",
  "document",
  "log_excerpt",
] as const;

export const pressureArtifactTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().min(1),
  /** Short note for the author on when to use it. */
  useWhen: z.string().min(1),
  /** Default sender line shown with the artifact. */
  from: z.string().optional(),
  template: z.string().min(1),
});

export type PressureArtifactTemplate = z.infer<typeof pressureArtifactTemplateSchema>;

export const PRESSURE_ARTIFACTS: readonly PressureArtifactTemplate[] = [
  {
    key: "reporter-email",
    kind: "email",
    title: "Reporter asks for comment",
    useWhen: "Use when the story is about to go public before the organization is ready.",
    from: "Dana Whitlock, The Harbor Ledger",
    template: `**From:** Dana Whitlock <dwhitlock@harborledger.example>
**To:** press@{{orgDomain}}
**Sent:** {{time}}
**Subject:** Request for comment: {{orgName}} systems incident

Hello,

I am a reporter at The Harbor Ledger. Two sources tell me that {{orgName}} is dealing with {{incidentSummary}}. One source says customer data may be involved.

I plan to publish this afternoon. Can you confirm:

1. Whether {{orgName}} has had a security incident and when it was found.
2. Whether customer or employee data was accessed.
3. Whether you have contacted law enforcement.
4. Whether operations are affected and when they will be back.

My deadline is two hours from this email. If I do not hear back I will note that {{orgName}} did not respond.

Dana Whitlock
Technology Reporter, The Harbor Ledger`,
  },
  {
    key: "social-post",
    kind: "social_post",
    title: "Viral social media post",
    useWhen: "Use to show public speculation spreading faster than official updates.",
    from: "@realtalk_rae",
    template: `**@realtalk_rae** · {{time}}

Anyone else unable to reach {{orgName}}?? App down all morning, phone line just rings. My friend who works there says it is a hack and they have been told not to say anything 👀

Heard it is {{incidentSummary}}. If my data got leaked I want to know NOW.

💬 412  🔁 2.3K  ❤️ 5.8K`,
  },
  {
    key: "news-article",
    kind: "news",
    title: "News article published",
    useWhen: "Use after a reporter deadline passes or to raise public pressure.",
    from: "The Harbor Ledger",
    template: `# {{orgName}} hit by cyberattack, sources say

*The Harbor Ledger · {{time}}*

{{orgName}} is responding to {{incidentSummary}}, according to two people familiar with the matter who asked not to be named.

Customers reported outages throughout the day. One person said employees were told to stop using company email.

{{orgName}} did not answer questions about whether personal data was taken. A spokesperson said the company was "investigating a network issue."

Security researchers said attacks of this kind often involve data theft before systems are locked.

This is a developing story.`,
  },
  {
    key: "ransom-note",
    kind: "ransom_note",
    title: "Ransom note",
    useWhen: "Use when the extortion demand first appears.",
    from: "Unknown",
    template: `--- README_RESTORE.txt ---

Hello {{orgName}}.

Your network was compromised and your files are encrypted. Found at {{time}}.

We also downloaded your data. Sample file list is on our page. If you do not contact us, the data will be published and sent to your customers, partners, and regulators.

Do not:
- rename or modify encrypted files
- use third-party recovery tools
- contact police or recovery companies, it will only cost you more

What you get when you pay:
- decryption tool for all systems
- deletion of your data and a log as proof
- a report on how we got in

You have 72 hours to contact us before the price doubles.

Contact: [private chat portal link]
Your ID: {{victimId}}`,
  },
  {
    key: "regulator-letter",
    kind: "regulator_letter",
    title: "Regulator inquiry letter",
    useWhen: "Use when a regulator learns of the incident from the press or another source.",
    from: "Office of the State Attorney General, Consumer Protection Division",
    template: `**Office of the State Attorney General**
Consumer Protection Division, Privacy Unit

{{time}}

General Counsel
{{orgName}}

**Re: Reported security incident**

Our office is aware of public reports that {{orgName}} has experienced {{incidentSummary}}. Under state law, we request the following within 10 business days:

1. A description of the incident, including when it began and when it was discovered.
2. The categories of personal information involved and the number of state residents affected.
3. A timeline of notifications made or planned to residents, regulators, and law enforcement.
4. Steps taken to contain the incident and prevent recurrence.
5. A copy of any notice sent to residents.

Please preserve all documents and data related to this matter.

Sincerely,
Assistant Attorney General
Privacy Unit`,
  },
  {
    key: "board-chair-text",
    kind: "chat",
    title: "Board chair text message",
    useWhen: "Use to add governance pressure and test board escalation.",
    from: "Board Chair",
    template: `**Board Chair** · {{time}}

Just saw something online about {{orgName}} and a cyberattack. Is this true?? Why am I hearing about it from the internet.

Need a call in 30 min. What do we know, are customers affected, are we paying anyone, and do we need to tell the SEC. Audit committee chair is asking too.`,
  },
  {
    key: "breach-coach-notes",
    kind: "document",
    title: "Breach coach call notes",
    useWhen: "Use after outside counsel is engaged to frame privilege and notification decisions.",
    from: "Outside counsel",
    template: `# Call notes: outside counsel (breach coach)

**Privileged and confidential. Prepared at the direction of counsel.**
**Time:** {{time}}
**Matter:** {{orgName}}, {{incidentSummary}}

## Advice
- Route the forensic firm through counsel so its work stays privileged. Sign the engagement before the firm starts.
- Do not write conclusions about cause or data access in email or chat. Facts only, and only to the response team.
- Preserve logs, images, and the ransom note. Suspend routine deletion.
- Notify the cyber insurer today. Use the panel vendors or get written approval first.

## Notification
- State breach laws may apply if personal data was accessed. Clocks run from discovery or determination depending on the state.
- If the company is public, start the materiality assessment now and record when and how it is made.

## Open questions for the team
- What data sets were on affected systems?
- Has anyone engaged with the threat actor?
- Who is authorized to speak externally?`,
  },
  {
    key: "fbi-voicemail",
    kind: "voicemail",
    title: "FBI field office voicemail",
    useWhen: "Use to prompt the law enforcement engagement decision.",
    from: "FBI field office, cyber squad",
    template: `**Voicemail** · {{time}} · 0:47

"Hi, this message is for the security lead at {{orgName}}. This is Special Agent Morgan Reyes with the cyber squad at the FBI field office. We have information that may relate to activity on your network, possibly connected to {{incidentSummary}}. We have seen similar activity at other organizations and may have indicators that can help. Please call me back at the field office main line and ask for the cyber squad duty agent. Thanks."`,
  },
  {
    key: "customer-complaint",
    kind: "email",
    title: "Customer complaint",
    useWhen: "Use to show customer impact and test customer communication.",
    from: "Key account customer",
    template: `**From:** Priya Natarajan, Director of Operations, Fernhollow Supply Co.
**To:** account-team@{{orgDomain}}
**Sent:** {{time}}
**Subject:** Service outage and our data

We have not been able to use your service since this morning and nobody on your support line can tell us anything. Our own customers are calling us.

We are also hearing that {{orgName}} had {{incidentSummary}}. Our contract requires you to notify us of any security incident affecting our data within 24 hours.

Please confirm today:
- whether our data was affected,
- when service will be restored,
- who our point of contact is.

If we do not hear back we will escalate to our legal team.

Priya Natarajan`,
  },
  {
    key: "employee-chat-leak",
    kind: "chat",
    title: "Employee chat leak",
    useWhen: "Use to show internal information spreading and test internal communications.",
    from: "#general",
    template: `**#general** · {{time}}

**jmartinez:** is anyone else locked out? my laptop says files are encrypted
**k.osei:** same. IT just told our team it is ransomware
**jmartinez:** wait is our payroll data ok?? direct deposit is friday
**tbrennan:** someone posted a screenshot of the ransom note on social media already lol
**k.osei:** should we be saying this here, isnt this channel monitored by them now
**jmartinez:** nobody has told us anything official`,
  },
  {
    key: "vendor-notice",
    kind: "email",
    title: "Vendor security notice",
    useWhen: "Use to introduce a third-party exposure or a supply chain angle.",
    from: "Key vendor security team",
    template: `**From:** Security Team <security-notice@vendor.example>
**To:** Vendor contacts at {{orgName}}
**Sent:** {{time}}
**Subject:** Security incident notification

We are writing to tell you about a security incident affecting systems we use to deliver services to {{orgName}}.

On discovery we took affected systems offline and engaged an outside forensic firm. Our investigation is ongoing. At this time we believe an unauthorized party accessed credentials used for connections to some customer environments.

As a precaution we recommend that you:
1. Rotate any credentials or API keys shared with us.
2. Review access from our IP ranges since the start of the month.
3. Disable our remote support connection until further notice.

We will share indicators of compromise as soon as they are available. This may relate to {{incidentSummary}}.

Vendor Security Team`,
  },
  {
    key: "entra-signin-log",
    kind: "log_excerpt",
    title: "Entra ID sign-in log",
    useWhen: "Use when an account in the cloud identity provider signs in from an unexpected place or registers a new MFA method.",
    from: "Identity team",
    template: `Entra ID sign-in and audit log, tenant {{orgDomain}} (exported {{time}})

02:11:07Z SignIn user=j.ortega@{{orgDomain}} app="Microsoft Azure Portal" ip=203.0.113.24 location=Unknown result=Success mfa=satisfied by claim in token
02:13:52Z Audit "User registered security info" user=j.ortega@{{orgDomain}} method="Authenticator app" ip=203.0.113.24
02:19:30Z Audit "Add member to role" role="Global Administrator" target=svc-sync@{{orgDomain}} initiatedBy=j.ortega@{{orgDomain}}
02:24:05Z Audit "Set domain authentication" domain=partners.{{orgDomain}} authentication=Federated initiatedBy=svc-sync@{{orgDomain}}

Related to {{incidentSummary}}. Sign-in logs on this tenant are kept 30 days.`,
  },
  {
    key: "okta-system-log",
    kind: "log_excerpt",
    title: "Okta System Log",
    useWhen: "Use when a help desk reset or MFA change in Okta is the first sign of account takeover.",
    from: "Identity team",
    template: `Okta System Log, org {{orgDomain}} (exported {{time}})

09:41:12 user.account.reset_password actor=helpdesk.agent3@{{orgDomain}} target=m.chen@{{orgDomain}} client.ip=198.51.100.7 outcome=SUCCESS
09:42:40 user.mfa.factor.reset_all actor=helpdesk.agent3@{{orgDomain}} target=m.chen@{{orgDomain}} outcome=SUCCESS
09:47:03 user.session.start actor=m.chen@{{orgDomain}} client.ip=203.0.113.88 client.geo=Unknown outcome=SUCCESS
09:49:21 user.mfa.factor.activate actor=m.chen@{{orgDomain}} factor=push device="new device" client.ip=203.0.113.88
09:55:10 system.idp.lifecycle.create actor=m.chen@{{orgDomain}} idp="Partner SSO" type=SAML2 outcome=SUCCESS

Related to {{incidentSummary}}. The System Log is kept 90 days.`,
  },
  {
    key: "edr-alert",
    kind: "log_excerpt",
    title: "EDR alert",
    useWhen: "Use when endpoint detection shows credential theft or tampering on a server.",
    from: "Security operations",
    template: `EDR alert, severity High, {{time}}

Host: FS-APP-07.corp.{{orgDomain}}
Detection: Credential dumping from LSASS memory
Process: C:\\ProgramData\\svc\\rundll32.exe comsvcs.dll MiniDump 712 C:\\ProgramData\\svc\\d.bin full
Parent: C:\\Windows\\System32\\cmd.exe (user CORP\\adm-backup)
Network: outbound 443 to 192.0.2.61
Related Windows events on host: 4624 logon type 10 from 10.20.4.15, 4672 special privileges for CORP\\adm-backup, 7045 service installed "UpdateSvc"
Action taken: Detect only. Prevention policy is not enabled on this server group.

Analyst note: may relate to {{incidentSummary}}.`,
  },
  {
    key: "vcenter-event",
    kind: "log_excerpt",
    title: "vCenter events",
    useWhen: "Use when the attacker reaches the hypervisor layer before encryption.",
    from: "Infrastructure team",
    template: `vCenter events, vcsa01.corp.{{orgDomain}} (exported {{time}})

01:58:14 User CORP\\adm-backup@192.0.2.33 logged in as VMware vsphere Client
02:03:47 Permission on root folder: CORP\\esx-admins granted Administrator role by CORP\\adm-backup
02:06:22 SSH for host esx-prod-04 enabled by CORP\\adm-backup
02:09:51 Task: Delete snapshot on VM BKP-PROXY-01 by CORP\\adm-backup
02:12:30 Task: Power off virtual machine BKP-PROXY-01 by CORP\\adm-backup

Related to {{incidentSummary}}.`,
  },
];

const BY_KEY: ReadonlyMap<string, PressureArtifactTemplate> = new Map(PRESSURE_ARTIFACTS.map((a) => [a.key, a]));

export function getPressureArtifact(key: string): PressureArtifactTemplate | undefined {
  return BY_KEY.get(key);
}

export type PressureArtifactVars = {
  orgName: string;
  incidentSummary: string;
  time: string;
} & Record<string, string>;

/**
 * Fills {{name}} placeholders. orgDomain defaults to a slug of orgName plus
 * ".example". Unknown placeholders are left in place.
 */
export function renderPressureArtifact(template: string, vars: PressureArtifactVars): string {
  const all: Record<string, string> = {
    orgDomain: `${vars.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`,
    victimId: "7F3A-91C2-4D0E",
    ...vars,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(all, name) ? all[name] : match,
  );
}

/** Placeholder names used in a template. */
export function listPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
}
