// Strategic TTX: Storm-0501 style hybrid cloud ransomware against the PHI
// data lake of a healthcare analytics business associate. Grounded in
// Microsoft Threat Intelligence's 2024 and 2025 Storm-0501 reports and the
// Azure IR facts in the October 2026 threat brief. Branches on how Security
// and IT handle the Entra Connect server and tenant containment. Matches
// playbooks/storm-0501-hybrid-cloud-ransomware.md.

import type { LibraryStrategicTemplate } from "../types";
import { CLOCKS, CUSTOMERS, DOMAIN, HEALTHCARE_COLLECTION_LABEL, ORG, ORG_PROFILE_MD, PEOPLE, STRATEGIC_TEAMS, VENDORS } from "./org";
import { active, kua, standby } from "./strategic-shared";

export const STORM_0501_TEMPLATE_ID = "lib-health-strategic-hybrid-cloud-ransomware";

const EXEC = "Executive";
const LEGAL = "Legal and Privacy";
const COMMS = "Communications";
const SEC = "Security";
const IT = "IT and Cloud Operations";
const CS = "Customer Success";

const SUB = "00000000-1111-2222-3333-444444444444";

export const HEALTHCARE_STRATEGIC_STORM_0501: LibraryStrategicTemplate = {
  id: STORM_0501_TEMPLATE_ID,
  collection: HEALTHCARE_COLLECTION_LABEL,
  title: "Hybrid cloud ransomware against a PHI data lake",
  summary:
    "An attacker who owns on-premises AD pivots through the Entra Connect server to Global Administrator, steals and deletes the Azure PHI lake and its backups, and demands a ransom over Teams. Six teams decide on tenant containment, recovery, customer notice as a business associate and the ransom. The path branches on how the Entra Connect server and the tenant are contained.",
  branching: "branched",
  config: {
    schemaVersion: 1,
    source: "template",
    scenario: {
      title: "Hybrid cloud ransomware against a PHI data lake",
      domain: "cyber",
      crisisType: "Ransomware / Extortion",
      threatActorKey: "storm-0501",
      replayKey: "storm-0501-2025",
      industryKey: "health-informatics",
      orgProfileMd: ORG_PROFILE_MD,
      complexity: "advanced",
      stakeholders: ["Covered entity customers", "HHS OCR", "Cyber insurer", "FBI", "Shareholders", "Media"],
    },
    winCondition: "none",
    teams: STRATEGIC_TEAMS,
    scenarioAnchor: { weekday: 0, time: "06:10" },
    targetDurationMin: 150,
    regulatoryClocks: [CLOCKS.insurer, CLOCKS.baa, CLOCKS.hipaa, CLOCKS.stateAg, CLOCKS.sec],
    executiveBriefMd: [
      ORG_PROFILE_MD,
      "",
      "It is early Sunday morning. You play the company's leadership and response teams: Executive, Legal and Privacy, Communications, Security, IT and Cloud Operations, and Customer Success.",
      "",
      "Answer as you would in a real event: decide, name who owns each decision, and say what you do not know yet. Five clocks can start: cyber insurer notice, the contractual BAA notice to customers (5 business days), HIPAA business associate notice (60 days), Texas attorney general notice and the SEC Form 8-K.",
      "",
      "The library playbook for this scenario is Hybrid cloud ransomware response.",
    ].join("\n"),
  },
  objectives: [
    { key: "command", text: "Establish incident command and a clean administrative path into the tenant within the first two hours.", capabilityKeys: ["RS.MA", "GV.RR"] },
    { key: "contain", text: "Contain the hybrid identity plane: the Entra Connect server, the synced Global Administrator and the rogue federated domain.", capabilityKeys: ["RS.MI", "PR.AA"] },
    { key: "recover", text: "Recover the PHI lake from soft deleted keys and backups with validated integrity before return to service.", capabilityKeys: ["RC.RP", "PR.DS"] },
    { key: "notify", text: "Meet insurer, BAA, HIPAA, state and SEC duties on time, with discovery time and basis recorded.", capabilityKeys: ["GV.OC", "RS.CO"] },
    { key: "ransom", text: "Make a documented ransom decision with OFAC screening, insurer consent and law enforcement input.", capabilityKeys: ["GV.RR", "GV.RM"] },
    { key: "customers", text: "Keep covered entity customers informed through named owners with consistent facts.", capabilityKeys: ["RS.CO", "RC.CO"] },
  ],
  injects: [
    {
      nodeId: "s1",
      title: "Storage accounts are disappearing",
      scenarioOffsetMin: 0,
      plannedDelayMin: 18,
      objectiveKeys: ["command", "contain"],
      phase: "opening",
      narrativeMd: [
        "Sunday 06:10. The on-call cloud engineer is paged by Defender for Cloud: **mass deletion in the analytics subscription**. Snapshots, VM restore point collections and two Recovery Services vault protection containers were deleted between 05:31 and 05:58. Two storage accounts in the PHI lake are gone. The others now return errors that point to an encryption scope with a key that no longer exists.",
        "",
        kua(
          [
            "The deletions were made by **svc-dataops-sync**, a synced account that holds Global Administrator.",
            "At 05:12 the same account ran `Microsoft.Authorization/elevateAccess/action` and then assigned itself Owner on every subscription.",
            "Customer dashboards are failing for every customer.",
          ],
          ["How the account was taken.", "Whether data left before it was deleted.", "Whether the attacker still has other access."],
          ["This is not a mistake by an engineer. Nobody on the team was working."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s1-activity",
          kind: "log_excerpt",
          title: "Azure Activity Log, analytics subscription",
          from: "IT and Cloud Operations",
          sentAt: "Sunday 06:22",
          content: [
            "```",
            `05:12:44  Directory Activity  operationName=Microsoft.Authorization/elevateAccess/action  caller=svc-dataops-sync@${DOMAIN}  callerIpAddress=203.0.113.17  status=Succeeded`,
            `05:14:02  operationName=Microsoft.Authorization/roleAssignments/write  scope=/subscriptions/${SUB}  role=Owner  caller=svc-dataops-sync@${DOMAIN}  status=Succeeded`,
            `05:19:37  operationName=Microsoft.Authorization/locks/delete  resource=qsphilake01  caller=svc-dataops-sync@${DOMAIN}  status=Succeeded`,
            `05:20:11  operationName=Microsoft.Storage/storageAccounts/blobServices/containers/immutabilityPolicies/delete  resource=qsphilake01/raw  status=Succeeded`,
            `05:31:50  operationName=Microsoft.Compute/snapshots/delete  count=212  status=Succeeded`,
            `05:36:08  operationName=Microsoft.RecoveryServices/Vaults/backupFabrics/protectionContainers/delete  vault=rsv-analytics-prod  status=Succeeded`,
            `05:44:19  operationName=Microsoft.Storage/storageAccounts/encryptionScopes/write  resource=qsphilake02  keyVault=kv-qs-ops7731  status=Succeeded`,
            `05:58:03  operationName=Microsoft.Storage/storageAccounts/delete  resource=qsphilake03  status=Succeeded`,
            "```",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(SEC, "Defender XDR shows no alerts on the Entra Connect server. Last week's asset review listed it as not onboarded to Defender for Endpoint.", [
          "What do you do with svc-dataops-sync and every other privileged account in the next 30 minutes?",
          "How do you get a clean administrative session into the tenant if Global Administrator itself may be compromised?",
        ]),
        active(IT, "Deletion is still possible while the attacker holds Owner. The PHI lake has seven storage accounts, two of them deleted.", [
          "What do you protect first: Key Vaults, backup vaults or the remaining storage accounts, and how?",
          "What evidence must be kept before anyone changes the subscription?",
        ]),
        active(EXEC, `The CIO, ${PEOPLE.cio}, calls the CEO at 06:30. No customer has called yet.`, [
          "Do you declare an incident now, and who commands it?",
          "Who do you bring in from outside today?",
        ]),
        standby(LEGAL, "Nobody has called Legal yet."),
        standby(COMMS, "Nothing is public."),
        standby(CS, "The Monday morning customer dashboards refresh at 05:00 tomorrow."),
      ],
      expectedActions: {
        [SEC]: [
          "Signs in with a cloud-only break-glass account and confirms it is not affected",
          "Disables svc-dataops-sync on premises and in Entra, resets it twice on premises and revokes its sessions",
          "Removes the attacker's Owner and User Access Administrator assignments at root and subscription scope",
          "Reviews every Global Administrator and PIM assignment created or activated in the last 30 days",
        ],
        [IT]: [
          "Checks Key Vault soft delete and purge protection and recovers the deleted key if it is soft deleted",
          "Checks Recovery Services vault soft delete state and stops any further backup deletion",
          "Exports the Azure Activity Log and Entra audit logs before they age out",
        ],
        [EXEC]: ["Declares an incident and names an incident commander", "Has counsel engage the IR retainer and notify the insurer"],
      },
      capabilityKeys: ["RS.MA", "RS.MI", "DE.AE"],
      mitreTags: ["T1098.003", "T1485", "T1490", "T1486", "T1531"],
      gradingNotes:
        "Effective answers get a clean admin path first (break-glass), then remove the attacker's role assignments, and protect Key Vault and backup vaults before forensic depth. Storm-0501's victim recovered the deleted key through Key Vault soft delete.",
      clockUpdates: [{ key: CLOCKS.insurer.key, action: "trigger" }],
    },
    {
      nodeId: "s2",
      title: "A message in Teams, and the Entra Connect server",
      scenarioOffsetMin: 120,
      plannedDelayMin: 22,
      objectiveKeys: ["contain", "notify", "ransom"],
      phase: "main",
      narrativeMd: [
        "Sunday 08:10. A finance analyst's Teams account messages the CEO, the CIO and the CISO with a ransom note. The analyst is on vacation and did not send it.",
        "",
        `${VENDORS.ir} has started. Their first read of on-premises logs: the attacker held domain admin for weeks, ran DCSync from a file server, and moved to the **Entra Connect server**, which was never onboarded to Defender for Endpoint. From there they used the Directory Synchronization Account to map the tenant, found svc-dataops-sync (a synced account with Global Administrator and **no MFA method registered**), reset its password on premises so the change synced, and registered their own MFA method.`,
        "",
        kua(
          [
            "Entra ID audit logs show a new federated domain, **qs-partner-sso.example**, added at 04:51 by svc-dataops-sync.",
            "Entra Connect is still running and still syncing every 30 minutes.",
            "The Key Vault that held the deleted customer managed key has soft delete on. The key can be recovered. Purge protection is off.",
          ],
          [
            "Whether data left before the deletions. Storage data plane logs were never turned on for the PHI lake.",
            "What other accounts or apps the attacker added.",
          ],
          ["The attacker can return through on-premises AD, the sync server or the federated domain."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s2-teams",
          kind: "chat",
          title: "Teams message to the CEO",
          from: "Erin Calloway (Finance)",
          sentAt: "Sunday 07:58",
          content: [
            "**Erin Calloway** 07:58",
            "",
            "Quarrystone. We copied your PHI lake before we deleted it. 4.6 TB, every customer.",
            "",
            "Your backups and snapshots are gone. Your remaining data is encrypted with a key only we can restore.",
            "",
            "Contact us at the address below within 48 hours. After that we sell the data and tell your hospitals ourselves.",
            "",
            "[contact address]",
          ].join("\n"),
        },
        {
          id: "s2-entra",
          kind: "log_excerpt",
          title: "Entra ID audit log and Entra Connect server events",
          from: VENDORS.ir,
          sentAt: "Sunday 08:05",
          content: [
            "```",
            `Fri 22:41  QS-ENTCON01  Security 4624  LogonType=3  TargetUserName=adm-fs02  IpAddress=198.51.100.140`,
            `Fri 22:43  QS-ENTCON01  Security 4688  NewProcessName=C:\\ProgramData\\upd\\svchelper.exe  SubjectUserName=adm-fs02`,
            `Sat 03:15  QS-DC01      Security 4662  SubjectUserName=adm-fs02  Properties={1131f6ad-9c07-11d1-f79f-00c04fc2dcd2}`,
            `Sun 04:37  AuditLogs  OperationName="Reset user password"  Target=svc-dataops-sync@${DOMAIN}  InitiatedBy=Sync_QS-ENTCON01`,
            `Sun 04:40  AuditLogs  OperationName="User registered security info"  Target=svc-dataops-sync@${DOMAIN}`,
            `Sun 04:51  AuditLogs  OperationName="Set domain authentication"  Target=qs-partner-sso.example  Authentication=Federated  InitiatedBy=svc-dataops-sync@${DOMAIN}`,
            `Sun 04:58  SigninLogs  UserPrincipalName=svc-dataops-sync@${DOMAIN}  IPAddress=203.0.113.17  DeviceDetail.trustType="Hybrid Azure AD joined"  ResultType=0`,
            "```",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(SEC, "Kestrel Point wants the Entra Connect server left running for a memory capture. Microsoft lists cloud-only Global Administrators and Conditional Access on the sync account as mitigations.", [
          "What do you do with the Entra Connect server, the Directory Synchronization Account and the federated domain, in what order?",
          "Do you reset every privileged credential at once or in stages, and why?",
        ]),
        active(IT, "Stopping sync stops joiners, leavers and password changes for 800 staff until it is rebuilt.", [
          "Do you stop Entra Connect sync now? What breaks, and how do you run identity without it?",
          "How do you recover the deleted key, and what do you change on the Key Vaults today?",
        ]),
        active(LEGAL, "The attacker claims 4.6 TB of PHI. Encryption hit storage that holds ePHI.", [
          "When is discovery for HIPAA and the BAAs, and what is the basis?",
          "What do you need before anyone answers the Teams message?",
        ]),
        active(EXEC, "The CEO received the message directly. The board chair is unaware.", [
          "Who may answer the attacker, and what is the instruction to everyone who received the message?",
          "When and how do you brief the board?",
        ]),
        standby(COMMS, "Nothing is public. Staff are starting to see failed dashboards in their own reports."),
        standby(CS, "Two customer data teams have opened tickets about missing Sunday extracts."),
      ],
      expectedActions: {
        [SEC]: [
          "Isolates the Entra Connect server from the network after or alongside a memory capture, and does not rebuild it in place",
          "Removes the rogue federated domain and checks federation settings with Get-MgDomain",
          "Resets privileged credentials in one coordinated window after the sync path and federation are closed",
          "Restricts the Directory Synchronization Account with Conditional Access to the sync server's IP",
        ],
        [IT]: [
          "Stops sync deliberately with a plan for manual joiners and leavers",
          "Recovers the soft deleted key and turns on purge protection on every Key Vault",
          "Locks the backup vault as immutable and confirms soft delete retention",
        ],
        [LEGAL]: [
          "Records discovery as Sunday 06:10 at the latest and notes the case that it was earlier",
          "Applies OCR's ransomware presumption of breach",
          "Requires an OFAC sanctions check and insurer consent before any contact with the attacker",
        ],
        [EXEC]: ["Orders that nobody replies to the Teams message", "Briefs the board chair today"],
      },
      capabilityKeys: ["RS.MI", "PR.AA", "GV.OC"],
      mitreTags: ["T1003.006", "T1556.007", "T1098", "T1556.006", "T1484.002", "T1606.002"],
      gradingNotes:
        "Mark IT and Cloud Operations or Security not effective if they keep Entra Connect syncing unmanaged, leave the federated domain in place, or reset privileged credentials before closing the sync and federation paths. Those answers send the run to the reentry branch.",
      clockUpdates: [
        { key: CLOCKS.baa.key, action: "trigger" },
        { key: CLOCKS.hipaa.key, action: "trigger" },
      ],
    },
    {
      nodeId: "s3a",
      title: "A clean admin path and a recovery plan",
      scenarioOffsetMin: 360,
      plannedDelayMin: 20,
      objectiveKeys: ["recover", "notify"],
      phase: "main",
      narrativeMd: [
        "Sunday 12:10. The tenant is under control. Sync is stopped, the federated domain is gone, the attacker's role assignments are removed, and break-glass accounts are the only standing Global Administrators. The deleted key was recovered from Key Vault soft delete, and two of the five remaining storage accounts are readable again.",
        "",
        kua(
          [
            "Recovery Services vault soft delete kept the deleted VM backups for 14 days. The vault was not locked as immutable.",
            "Storage account keys were listed by the attacker on Saturday at 23:40. AzCopy traffic from the lake to 203.0.113.0/24 ran from 23:52 to 03:30.",
          ],
          ["Exactly which containers and files were copied. Data plane logs were off, so the exfiltration cannot be scoped from logs."],
          ["Every customer's PHI in the lake may have been copied."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s3a-ir",
          kind: "document",
          title: "IR firm interim note",
          from: VENDORS.ir,
          sentAt: "Sunday 11:50",
          content: [
            "**Interim note, privileged and confidential, prepared at the direction of counsel**",
            "",
            "1. Exfiltration: network flow logs show about 4.4 TB to 203.0.113.0/24 between 23:52 and 03:30. Storage data plane logging was not enabled, so file level scope is not available.",
            "2. Recovery: the customer managed key is recovered. Two storage accounts are readable. VM backups are recoverable from soft delete until day 14.",
            "3. Persistence: no remaining attacker access found in Entra ID. On-premises AD is not yet cleared.",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(IT, "Restoring the lake means rebuilding pipelines that ran under the compromised identity.", [
          "What is your restore order, and what has to be true before each step?",
          "How do you make sure this cannot be deleted again during recovery?",
        ]),
        active(SEC, "On-premises AD is still not cleared. The attacker held domain admin for weeks.", [
          "How do you scope exfiltration when the data plane logs were never on?",
          "What do you do about on-premises AD before sync comes back?",
        ]),
        active(LEGAL, "You may have to treat every customer as affected.", [
          "Do you notify all 46 customers under the BAAs, or wait for scope? What goes in the notice?",
          "Is there an argument that discovery was Saturday night, when the exfiltration ran?",
        ]),
        active(CS, "Customers expect the Monday 05:00 refresh.", ["What do you tell customers before Monday morning, and who tells them?"]),
        standby(EXEC, "The executive team is waiting for the recovery plan."),
        standby(COMMS, "Nothing is public yet."),
      ],
      expectedActions: {
        [IT]: [
          "Sets a restore order by customer need with integrity checks at each step",
          "Locks the backup vault as immutable and applies locked time-based retention on restored containers",
          "Rebuilds pipelines under new identities, not the old service principals",
        ],
        [SEC]: [
          "States in writing that exfiltration scope cannot be proven from logs and why",
          "Plans a two-step krbtgt reset and Tier 0 rebuild before sync resumes",
        ],
        [LEGAL]: ["Sends BAA notices to every customer whose data was in the lake", "Writes down the analysis of the Saturday night should have known question"],
        [CS]: ["Calls every customer through a named owner before the Monday refresh", "Uses the same agreed facts on every call"],
      },
      capabilityKeys: ["RC.RP", "RS.AN", "GV.OC"],
      mitreTags: ["T1552", "T1537", "T1567"],
    },
    {
      nodeId: "s3b",
      title: "They are back in",
      scenarioOffsetMin: 360,
      plannedDelayMin: 20,
      objectiveKeys: ["contain", "recover"],
      phase: "main",
      narrativeMd: [
        "Sunday 12:10. At 10:40 every Global Administrator password was reset. At 11:25 a new session for a Global Administrator signed in through **qs-partner-sso.example** with a forged SAML token. Minutes later the Entra Connect server synced a new password for svc-dataops-sync from on-premises AD.",
        "",
        "The attacker then tried to purge the soft deleted key. The purge succeeded for the archive vault, which had no purge protection. Five years of archived customer extracts in that storage account are now permanently unreadable.",
        "",
        kua(
          [
            "The rogue federated domain was still in place. The sync server was still running.",
            "The main lake key is safe because its vault had purge protection on.",
          ],
          ["What else the attacker changed in the last 90 minutes."],
          ["Any credential reset while sync and federation stay open will be undone."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s3b-signin",
          kind: "log_excerpt",
          title: "Entra sign-in and Key Vault events",
          from: SEC,
          sentAt: "Sunday 11:58",
          content: [
            "```",
            `11:25:09  SigninLogs  UserPrincipalName=t.okafor@${DOMAIN}  IPAddress=203.0.113.24  AuthenticationProtocol=SAML  FederatedIdp=qs-partner-sso.example  ResultType=0`,
            `11:31:46  AuditLogs  OperationName="Reset user password"  Target=svc-dataops-sync@${DOMAIN}  InitiatedBy=Sync_QS-ENTCON01`,
            `11:39:12  Activity  operationName=Microsoft.KeyVault/locations/deletedVaults/purge/action  vault=kv-qs-archive  status=Succeeded`,
            `11:39:40  Activity  operationName=Microsoft.KeyVault/locations/deletedVaults/purge/action  vault=kv-qs-ops7731  status=Failed  reason=PurgeProtectionEnabled`,
            "```",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(SEC, "The attacker can sign in as nearly anyone through the federated domain.", [
          "Do you now treat the tenant as lost? What does a clean admin path look like from here?",
          "What is the order of operations this time, and who signs off each step?",
        ]),
        active(IT, "You can disconnect the Entra Connect server physically, but that ends sync for everyone.", [
          "What do you shut down, in what order, and what do staff do on Monday morning without it?",
          "How do you protect the remaining Key Vaults and backup vaults right now?",
        ]),
        active(EXEC, "The CIO tells you the first containment failed and archived data is lost for good.", [
          "Do you change who commands the response or bring in more outside help?",
          "What do you tell the board chair today?",
        ]),
        standby(LEGAL, "Legal is preparing the BAA notices."),
        standby(COMMS, "Nothing is public yet."),
        standby(CS, "Customers expect the Monday 05:00 refresh."),
      ],
      expectedActions: {
        [SEC]: [
          "Removes the federated domain and blocks sign-in for every privileged account except break-glass in one window",
          "Physically isolates the Entra Connect server and plans a clean rebuild",
          "Calls Microsoft support for tenant recovery help",
        ],
        [IT]: [
          "Stops sync, with a manual process for urgent joiners and leavers",
          "Enables purge protection on every remaining Key Vault and locks the backup vault",
        ],
        [EXEC]: ["Confirms one incident commander and adds outside support", "Gives the board chair a written update with the data loss"],
      },
      capabilityKeys: ["RS.MI", "PR.AA", "RC.RP"],
      mitreTags: ["T1606.002", "T1484.002", "T1485"],
      gradingNotes: "This branch shows why Microsoft lists cloud-only Global Administrators, federation checks and purge protection as Storm-0501 mitigations.",
    },
    {
      nodeId: "s4",
      title: "Customers ask whether their PHI is in the lake",
      scenarioOffsetMin: 1440,
      plannedDelayMin: 22,
      objectiveKeys: ["notify", "customers"],
      phase: "main",
      narrativeMd: [
        "Monday 06:10. Customer dashboards did not refresh at 05:00. By 06:00 eleven customers have opened tickets. A health system CISO has emailed the CEO. A reporter at a health trade publication has heard that Quarrystone was hit by ransomware.",
        "",
        `The insurer's panel counsel insists that the IR firm report only to counsel and that nothing about scope goes to customers in writing until counsel approves it.`,
        "",
        kua(
          ["Every customer's PHI was in the lake. Recovery of the lake is under way.", "About 3.1 million Texas residents appear in the lake across 6 customers."],
          ["Which customers' files were in the 4.4 TB that left."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s4-ciso",
          kind: "email",
          title: "Customer CISO email",
          from: `CISO, ${CUSTOMERS.hospital}`,
          sentAt: "Monday 05:47",
          content: [
            `**From:** Raymond Achebe <rachebe@saintaldric.example>`,
            `**To:** ${PEOPLE.ceo} <dana.whitlock@${DOMAIN}>`,
            "**Subject:** Is our data involved?",
            "",
            "Dana, our analytics feed failed overnight and a peer at another system tells me you have had a ransomware incident. Under our BAA I need to know today whether our patients' data is involved, the indicators of compromise, and whether we should cut our connection to you.",
            "",
            "If I do not have a written answer by 17:00, I will recommend that we suspend the feed and review the contract.",
          ].join("\n"),
        },
        {
          id: "s4-reporter",
          kind: "email",
          title: "Reporter asks for comment",
          from: "Health Systems Ledger",
          sentAt: "Monday 06:02",
          content: [
            "**From:** Jonah Reyes <jreyes@healthsystemsledger.example>",
            "**Subject:** Ransomware at Quarrystone",
            "",
            "Two hospital IT staff tell me Quarrystone suffered ransomware over the weekend and that patient data may be involved. Can you confirm, and say how many hospitals are affected? I plan to publish at 12:00.",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(CS, "Eleven customers have tickets open. All 46 will notice by noon.", [
          "Who calls which customers this morning, with what script?",
          "What do you say to a customer who asks whether to cut the connection?",
        ]),
        active(COMMS, "The reporter publishes at 12:00.", [
          "What do you tell staff, customers and the reporter this morning, and in what order?",
          "Draft the first two sentences of the holding statement.",
        ]),
        active(LEGAL, "Panel counsel wants nothing in writing to customers without approval. The BAA window runs from Sunday.", [
          "How do you meet the BAA notice duty while protecting privilege?",
          "What do you send to Saint Aldric by 17:00?",
        ]),
        active(EXEC, "Saint Aldric is your third largest customer.", ["Do you call the Saint Aldric CISO yourself, and what do you commit to?"]),
        standby(SEC, "Security is preparing an indicator package for customers."),
        standby(IT, "Restores are under way."),
      ],
      expectedActions: {
        [CS]: [
          "Assigns a named owner per customer with a script cleared by counsel",
          "Offers indicators and a time for the next written update",
          "Gives customers a reasoned view on keeping or pausing their connection",
        ],
        [COMMS]: [
          "Briefs staff before the story publishes",
          "Gives the reporter a short statement that confirms an incident without speculating on scope",
          "Keeps the customer and media messages on the same facts",
        ],
        [LEGAL]: [
          "Sends BAA notices with known facts and open questions, reviewed by counsel",
          "Keeps the forensic report privileged while sharing facts customers need",
        ],
        [EXEC]: ["Calls the Saint Aldric CISO directly and commits to a written answer by 17:00", "Agrees with counsel what can be put in writing today"],
      },
      capabilityKeys: ["RS.CO", "RC.CO", "GV.OC"],
      clockUpdates: [{ key: CLOCKS.stateAg.key, action: "trigger" }],
    },
    {
      nodeId: "s5",
      title: "Ransom deadline and the disclosure committee",
      scenarioOffsetMin: 2880,
      plannedDelayMin: 22,
      objectiveKeys: ["ransom", "notify"],
      phase: "main",
      narrativeMd: [
        "Tuesday 06:10. The attacker's 48 hours have passed. A second Teams message, from another dormant account, sets a price of **$9 million** and a new 72 hour deadline, and attaches a file listing from the lake.",
        "",
        "The disclosure committee meets at 09:00. Finance estimates $25 million to $40 million in costs and credits, plus contract risk with three customers.",
        "",
        kua(
          ["The file listing matches real paths in the deleted storage account.", "The FBI field office has the indicators and has asked for a call.", "Counsel's OFAC screen of the wallet found no match."],
          ["Who controls the wallet.", "Whether paying would stop a sale of the data."],
          ["The lake can be rebuilt from customer resubmissions and soft deleted backups without paying, in about three weeks."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s5-teams",
          kind: "chat",
          title: "Second Teams message",
          from: "Marta Ilves (Data Engineering)",
          sentAt: "Tuesday 05:40",
          content: "**Marta Ilves** 05:40\n\nYou ignored us. Price is now 9,000,000 USD. 72 hours. File list attached so you know we have it.\n\nPay and the data is deleted. Do not pay and we sell it to whoever wants hospital records.",
        },
      ],
      teamVariants: [
        active(EXEC, "The board meets at 13:00. The insurer's policy requires its written consent before any payment.", [
          "What is your recommendation to the board on payment, and what must be true before any payment could be considered?",
          "Who has authority to approve a payment, and is that written down?",
        ]),
        active(LEGAL, "The committee must decide materiality under Item 1.05.", [
          "Is the incident material today? Record the basis.",
          "If not yet material, do you file a voluntary Item 8.01 report?",
        ]),
        active(SEC, "The attacker used another dormant internal account to send the message.", [
          "How was a second internal account used, and what does that say about containment?",
          "What do you share with the FBI, and who approves it?",
        ]),
        active(COMMS, "Staff are asking whether the company will pay.", ["What do you tell staff about the ransom, if anything?"]),
        standby(IT, "Restores are progressing."),
        standby(CS, "Customers are waiting for the next update at 17:00."),
      ],
      expectedActions: {
        [EXEC]: [
          "Gets OFAC screening, insurer consent terms and FBI input before any payment recommendation",
          "Records the payment decision and who made it",
          "Weighs that payment does not undo the theft or the notices",
        ],
        [LEGAL]: [
          "Records the materiality determination with its basis and time",
          "Starts the four business day Item 1.05 clock or files a voluntary Item 8.01 report",
        ],
        [SEC]: ["Disables dormant accounts and reviews all sign-ins since Sunday", "Shares indicators with the FBI through counsel"],
        [COMMS]: ["Tells staff the company will not discuss ransom publicly", "Gives staff one channel for questions and a reminder not to talk to the press"],
      },
      capabilityKeys: ["GV.RR", "GV.OC", "RS.MA"],
      clockUpdates: [{ key: CLOCKS.sec.key, action: "trigger" }],
    },
    {
      nodeId: "s6",
      title: "Return to service",
      scenarioOffsetMin: 4320,
      plannedDelayMin: 18,
      objectiveKeys: ["recover", "customers"],
      phase: "main",
      narrativeMd: [
        "Wednesday 06:10. Four of the seven storage accounts are restored and the VM backups are back. Sync is still off. Customers want dashboards back this week.",
        "",
        kua(
          ["On-premises AD has had krbtgt reset twice. The Entra Connect server is being rebuilt with TPM and Defender for Endpoint.", "Restored data passed integrity checks for 31 customers."],
          ["Whether the rebuilt pipelines carry anything the attacker left."],
        ),
      ].join("\n"),
      artifacts: [],
      teamVariants: [
        active(IT, "The engineering team wants to turn sync back on today.", [
          "What are your criteria for turning sync and customer feeds back on, and who signs them?",
          "What changes before sync returns?",
        ]),
        active(SEC, "Microsoft's Storm-0501 guidance lists specific hardening for the sync server and admin accounts.", [
          "Which controls must be in place before return to service?",
        ]),
        active(CS, "Customers want a date.", ["What date do you give, and what evidence do you share with customers before reconnecting?"]),
        active(EXEC, "The board wants a recovery date and a cost.", ["What do you commit to publicly, and what do you hold back?"]),
        standby(LEGAL, "Notices are out to every customer."),
        standby(COMMS, "The story ran on Monday."),
      ],
      expectedActions: {
        [IT]: [
          "Requires integrity checks, clean identities and forensic sign off before each customer reconnects",
          "Turns sync back on only after the rebuilt server is onboarded to Defender for Endpoint",
        ],
        [SEC]: [
          "Confirms cloud-only Global Administrators with phishing-resistant MFA",
          "Applies Conditional Access to the Directory Synchronization Account and federatedIdpMfaBehavior set to rejectMfaByFederatedIdp",
          "Turns on purge protection, locked immutable backup vaults and data plane logging",
        ],
        [CS]: ["Gives each customer a reconnection checklist and a date tied to it", "Shares the evidence summary under NDA"],
        [EXEC]: ["Commits to a date range rather than a single date", "Keeps cost estimates out of public statements until filed"],
      },
      capabilityKeys: ["RC.RP", "PR.PS", "PR.AA"],
    },
    {
      nodeId: "s7",
      title: "A customer leaves, and the review",
      scenarioOffsetMin: 21600,
      plannedDelayMin: 15,
      objectiveKeys: ["customers", "notify"],
      phase: "resolution",
      narrativeMd: [
        "Monday 06:10, day 15. Service is back for every customer. Northvale Regional Medical Center gives notice to end its contract. HHS OCR has sent a data request about the incident and your risk analysis. The board wants a post-incident review in 30 days.",
        "",
        kua(
          ["Scope could never be narrowed below the full lake. Every customer received a BAA notice.", "The cost estimate is now $32 million."],
          ["Whether more customers will leave at renewal."],
        ),
      ].join("\n"),
      artifacts: [
        {
          id: "s7-ocr",
          kind: "regulator_letter",
          title: "HHS OCR data request",
          from: "HHS Office for Civil Rights",
          sentAt: "Day 14",
          content: [
            "**U.S. Department of Health and Human Services, Office for Civil Rights**",
            "",
            `Re: ${ORG}, reported security incident`,
            "",
            "OCR has opened a review of the incident reported by covered entities that use your services. Within 30 days, please provide: your most recent risk analysis and risk management plan; a description of the incident and its timeline; your policies on access control, audit logging and backup; and the business associate agreements in effect with affected covered entities.",
          ].join("\n"),
        },
      ],
      teamVariants: [
        active(LEGAL, "OCR's ransomware settlements usually turn on the risk analysis.", ["How do you respond to OCR, and what do you fix first because of it?"]),
        active(EXEC, "The board wants an honest account.", [
          "What are the three control failures you report to the board, with owners and dates?",
          "What do you do about Northvale?",
        ]),
        active(SEC, "The review must cover detection as well as response.", ["Why did nobody see the on-premises phase, and what would see it next time?"]),
        active(IT, "Retention matters for the next one.", ["Which logs and retention settings change, and by when?"]),
        active(CS, "Renewals for eight customers are due this quarter.", ["What do you offer customers to rebuild trust?"]),
        active(COMMS, "Staff morale is low after two weeks of outage.", ["What do you tell staff about what happened and what changes?"]),
      ],
      expectedActions: {
        [LEGAL]: ["Assembles the OCR response through counsel with a current risk analysis", "Tracks corrective actions OCR is likely to expect"],
        [EXEC]: [
          "Names the unmonitored Entra Connect server, the synced Global Administrator without MFA and missing purge protection as failures",
          "Assigns owners and dates to each fix",
        ],
        [SEC]: ["Puts Defender for Endpoint on every Tier 0 server and alerts on elevateAccess and new federated domains", "Routes Entra and Activity logs to long-term storage"],
        [IT]: ["Exports the Activity Log beyond 90 days and turns on storage and Key Vault diagnostic logs", "Tests restores from the locked vault quarterly"],
        [CS]: ["Offers an independent assessment summary and a remediation timeline", "Meets each renewal customer with the CISO"],
        [COMMS]: ["Gives staff a plain account and the list of changes", "Thanks the teams that worked the outage"],
      },
      capabilityKeys: ["GV.OV", "ID.IM", "RC.CO"],
    },
  ],
  branches: [
    { from: "s1", to: "s2", condition: { type: "default" }, priority: 0 },
    { from: "s2", to: "s3b", condition: { type: "team_outcome", team: IT, outcome: "ineffective" }, priority: 0 },
    { from: "s2", to: "s3b", condition: { type: "team_outcome", team: SEC, outcome: "ineffective" }, priority: 1 },
    { from: "s2", to: "s3a", condition: { type: "default" }, priority: 2 },
    { from: "s3a", to: "s4", condition: { type: "default" }, priority: 0 },
    { from: "s3b", to: "s4", condition: { type: "default" }, priority: 0 },
    { from: "s4", to: "s5", condition: { type: "default" }, priority: 0 },
    { from: "s5", to: "s6", condition: { type: "default" }, priority: 0 },
    { from: "s6", to: "s7", condition: { type: "default" }, priority: 0 },
  ],
};
