# Guests, status pages, messaging, playbooks and training incidents

Five incident features: guest links, public status pages, broadcast messaging, the Playbooks tab and training incidents.

## Guest links

Invite an outside party, such as outside counsel, an IR firm or an insurer, to one incident.

- **Invite.** Open the incident, then **Invite guest** on the Access card. Enter the email, and optionally a name, a company and how many days the link works (1 to 90, default 7). Clear **Can upload evidence** to make the link read only for evidence.
- **Who can invite.** The incident commander, the reporter and administrators. On a locked incident, only the incident commander and administrators.
- **The link.** It is shown once and emailed to the guest. Only its SHA-256 is stored. The email has no incident title.
- **What the guest sees.** The incident summary (title, description, severity, status, category), the incident chat, and the evidence list. The guest can post to the chat and, if allowed, upload evidence. Guests cannot download evidence.
- **What the guest never sees.** Other incidents, tasks, the ledger, members, the escalation matrix, and any other page or API. The link opens `/incident-guest/<token>` and its API under `/api/public/incident-guest/<token>` only.
- **Chat.** Guest messages show as `Name (guest)` and reach responders live. Guests are not on the socket; their page polls every 5 seconds.
- **Evidence.** Guest uploads get the same SHA-256 and ledger entry as responder uploads, with the category `guest`.
- **Ending access.** Revoke the link on the Access card. A link also stops when it expires or the incident is deleted. Locking an incident pauses every guest link made before the lock; the Access card shows them as paused.
- **Audit.** Invites and revokes are on the incident ledger and in the org audit log.
- **Limits.** Per IP, per link, and per inviter. Over the limit, the API answers 429.

## Public status pages

One public page per incident, for customers or the public.

- **Create.** On the Comms tab, enter a public title under **Public status page** and select **Create**. The page starts offline. Select **Publish** to put it online.
- **The link.** It is shown once. Only its SHA-256 is stored. **Get a new link** replaces it; the old link stops working.
- **What it shows.** The organization name, the page title, a status label (Investigating, Monitoring or Resolved) and the updates posted to it. Nothing else from the incident.
- **Posting an update.** When you publish a public update, leave **Post to the status page** checked. To post an older update, use the globe button next to it. **Remove from page** takes it off the page. An unpublished update leaves the page.
- **Audience.** By default the page shows public updates. Choose **Customer and public updates** to show both. Internal updates never show.
- **Locked incidents.** A locked incident cannot have a status page. Locking an incident takes its page offline.
- **Subscribers.** Anyone with the link can subscribe by email. They get a confirmation email first (double opt-in). Each posted update is emailed to confirmed subscribers, with an unsubscribe link and a `List-Unsubscribe` header. The confirm and unsubscribe links show a button; opening the link alone changes nothing.
- **Caching.** The JSON at `/api/public/status/<token>` is cached for 30 seconds. The page itself is not cached.
- **Limits.** Reads and subscribes are limited per IP, and subscribes per address.
- **Mail.** It uses the email transport you set up for CE (SMTP or Resend). See [Paging](paging.md#email).

## Messaging

Send one message to many people out of band: in app, email, SMS, voice call, webhooks and plugins.

- **Who can send.** Contributors and administrators. Readers do not see Messaging; they receive broadcasts.
- **Who it reaches.** Any mix of: all members, members by role, members by name, all escalation contacts, contacts by tier, contacts by role, contacts by name. A contact linked to a selected member gets one message, as that member. At most 1,000 people.
- **Channels.** The same providers as paging. Email goes to the member's account email or the contact's email. SMS and voice go only to a verified phone, or one an administrator allowed, and count toward the same SMS and voice limits as pages. A channel that cannot reach someone is recorded as skipped, with the reason.
- **Acknowledge.** Every message carries a signed acknowledge link, the same link as a page. Voice calls take 1 to acknowledge. The in-app notification opens the same link.
- **Delivery status.** Open a sent broadcast to see each person, each channel's result, and when they acknowledged.
- **Webhooks and plugins.** They get `kind: "broadcast"` (webhook type `crucible.broadcast`). See [Delivery providers](delivery-providers.md).
- **Limits.** 10 broadcasts a minute per organization.
- **Audit.** Each broadcast is in the org audit log.

## Playbooks tab

Run playbook documents from Documents as a checklist on an incident. No exercise is involved.

- **Suggestions.** The tab ranks the organization's playbook documents, including the shipped library playbooks, by rules: the incident category, ATT&CK tags on the incident that the document mentions, and words shared by the incident and the document title or headings. Each suggestion says why.
- **Attach.** Attach a suggestion, or any playbook from the list. You can attach more than one.
- **The checklist.** Steps come from the document, grouped by its sections: numbered list items, task list items (`- [ ]`), bold step ids such as `**C1.**`, and bold decision points such as `**Decision point C-A: ...**`. Code blocks and tables are left out.
- **Checking off.** Each step records who checked it and when. Progress shows above the checklist. A run with every step done is marked completed.
- **Editing.** **Edit checklist** lets you add, reword, move and remove steps for this incident. The document does not change, and a later edit of the document does not change an attached checklist.
- **Make task.** Turns a step into an incident task, once per step.
- **Who can edit.** Contributors and administrators. On a locked incident, the incident commander and administrators. Readers see the checklist.
- **Record.** Attach, removal and every check-off are on the incident ledger. Checklists and check-offs are in the case-file export.

## Training incidents

A training incident is a practice incident for onboarding (**Onboarding > Your setup > Run a training incident**). Each member gets their own.

- **What is in it.** A short ransomware scenario on a finance database: affected assets, two indicators, a high-risk containment action waiting for approval, a recovery action, three tasks, an open decision and a few chat messages. You are the incident commander.
- **What you can do.** Everything in the war room: tasks, actions, decisions, chat, evidence, status updates and the postmortem.
- **What it never does.** It pages no one, sends no notification (in app, push, email or SMS), calls no webhook or delivery plugin, has no status page or guest links, and runs no SLA clocks. Its case file and calendar feed cannot be exported.
- **Where it does not appear.** The incident list, the Ops Room, metrics, the executive dashboard, the readiness score and reports. Open it from Onboarding. A banner marks it in the war room.
- **Who.** Contributors, exercise directors and administrators. Readers cannot work incidents, so they do not get one.
- **Reset.** **Reset** (on the step or in the banner) deletes it and everything in it. Start a new one from the step.
