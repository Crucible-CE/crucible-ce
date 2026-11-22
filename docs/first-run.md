# First run

These steps take you from a fresh install to a test page you acknowledge. Install first. See [install.md](install.md).

## 1. Claim the install

1. Get the one-time setup code.
   ```bash
   docker compose logs app | grep "setup code"
   ```
   From source, the code prints in the `next dev` output when you first open `/setup`.
2. Open `PUBLIC_URL/setup` (default http://localhost:3000/setup).
3. Enter the code, your organization name, your name, email and a password.

You are now the first administrator. Your email is verified. The wizard is off for good.

If the server restarts before you finish, the old code stops working. Read the log again for the new one. If you see "Too many attempts", run `docker compose restart app` and use the new code.

## 2. Set up a delivery channel

The in-app alert reaches only signed-in members. Set up one of these in `.env`, then run `docker compose up -d`.

| Channel | Settings | Docs |
| --- | --- | --- |
| Mailpit (source install) | `SMTP_HOST=localhost`, `SMTP_PORT=1025` in `.env.local`. Mail at http://localhost:8025. | [install.md](install.md#from-source-development) |
| Any SMTP server | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | [paging.md](paging.md#email) |
| Signed webhook | `DELIVERY_WEBHOOK_URL`, `DELIVERY_WEBHOOK_SECRET` | [delivery-providers.md](delivery-providers.md) |
| SMS or voice | Your Twilio account | [paging.md](paging.md#sms-and-voice-twilio) |

Then open **Org admin > Delivery settings**. It lists every provider and whether it is configured. Click **Send test** for each one.

## 3. Add yourself as a contact

1. Open **Escalation matrix** and click **Add contact**.
2. Enter your name, email and phone.
3. Pick a role. Optionally link the entry to your member account.
4. Save.

Phone numbers are stored in E.164 format (`+15551234567`). National input such as `(555) 123-4567` uses `PHONE_DEFAULT_COUNTRY_CODE` (default `1`).

SMS and voice go only to a verified phone.

- **Your contact entry.** Click **Verify contacts**. It emails a confirm link and, with Twilio, texts one. An administrator can also **Mark phone verified**.
- **Your member account.** Set a mobile number in **Settings > Notifications** and click **Send code**.

See [paging.md](paging.md#phone-verification) for the full rules.

## 4. Declare a test incident

1. Open **Incidents** and click **Declare incident**.
2. Enter a title, description, severity and category. Use a clear name like "TEST: paging drill".

The incident has the war room chat, tasks, decisions, evidence, status updates, the **Escalation** tab and the **Case file** page.

## 5. Assign a role

Open the incident's response team panel. Assign someone to a role such as incident commander or tech lead. A role can be held by a member or an external contact.

- An empty incident commander seat can be filled only by the reporter or an administrator.
- A filled seat can be changed only by the current incident commander, the reporter or an administrator.
- Unacknowledged pages escalate in this order: tech lead, incident commander, executive sponsor.

## 6. Page yourself

1. Open the incident's **Escalation** tab.
2. Under **Page responders**, page yourself as a member (email) or page your contact (email, SMS, voice).

Each page has a 10-minute acknowledgment window. The tab shows each channel's status.

| Status | Meaning |
| --- | --- |
| `sent` | Delivered to the provider |
| `failed` | The provider returned an error, shown next to it |
| `skipped` | Not attempted, with the reason (for example `skipped: not configured`) |

## 7. Acknowledge

Every page and escalation message has a signed acknowledge link.

1. Open the link. It shows a confirmation page. Opening it does not acknowledge.
2. Press the button. Escalation stops. The acknowledgment is written to the incident ledger.

With Twilio inbound set up, an SMS reply of `ACK` or `1` also works. On a voice call, press `1` (needs an https `PUBLIC_URL`). See [paging.md](paging.md#acknowledge).

To see escalation, page a contact and don't acknowledge. After 10 minutes the next role is paged.

## 8. Close it

Close the incident from its page. Pick a disposition.

- **True positive**
- **Benign / authorized activity**
- **False positive**, with a reason category

Closing stops open pages. If there is no postmortem yet, you must close with an override and enter a reason. The override and reason are recorded on the ledger. Administrators can then export a signed case file. See [case-file-exports.md](case-file-exports.md).

## Invite teammates

1. Open **Org admin > Members** and create an invite.
2. Pick the role. Optionally enter the invitee's email.
3. Copy the link and send it any way you like.

- The link is single-use and expires after 7 days.
- If email is configured, the new member gets a verification email.
- If email is not configured, turn on **Skip email verification** when you create the invite. Otherwise the member can't sign in.
- The invite always joins your organization. CE is single-organization.

## Roles

| Role | Can do |
| --- | --- |
| `reader` | View incidents they have access to. No changes. |
| `contributor` | Reader, plus declare incidents, chat, tasks, decisions, status updates, evidence and paging. |
| `exercise_director` | Contributor, plus runs the exercise program and every exercise in it. No Org admin. See [exercises.md](exercises.md#who-can-do-what). |
| `administrator` | Contributor, plus delete incidents, export case files, manage members and invites, and open Org admin. |

Deleting an incident is a soft delete. It disappears from every list, feed and lookup. Open pages are cancelled. The record and its ledger are kept. The deletion is written to the ledger and the audit log.

## Locked incidents

A locked incident (called "restricted" in the data model) is hidden from the org list, search, realtime updates and paging for anyone who is not a participant.

| Action | Who |
| --- | --- |
| See it | Participants, the incident commander, administrators |
| Edit it | The incident commander and administrators. Everyone else gets a read-only view. |
| Manage participants while locked | The incident commander and administrators |
| Lock it | The reporter, the incident commander or an administrator |
| Unlock it | An administrator, or the incident commander who held the seat at lock time while they still hold it |

- The reporter and assignee are added as ordinary participants. They can be removed like anyone else.
- Locking adds the current team (reporter, assignee, role holders and you) to the participant list. It records who held the incident commander seat.

## Onboarding

**Onboarding** in the side rail is a checklist that checks itself off from real data. Administrators get **Organization setup** (profile, members, email, channels, the escalation matrix, SLAs, a test page and the signing key). Everyone gets **Your setup** (profile, phone, two-factor, notification preferences and a test page), then four practice steps. Each practice step shows only to roles that can complete it, so readers do not get them.

| Step | Done when | Roles |
| --- | --- | --- |
| Run a training incident | You opened your training incident, added a task or proposed an action, and posted a status update | Contributors, exercise directors, administrators |
| Run the practice Crisis Sim | A solo run of the library practice sim reached ENDEX | Contributors, exercise directors, administrators |
| Add your IR playbook | The organization has a playbook of its own in Documents (uploaded, pasted or duplicated from the Library) | Contributors, exercise directors, administrators |
| Schedule your first exercise | There is an entry on **Schedule** | Contributors, exercise directors, administrators |

The practice sim makes you lead facilitator and the decision maker for its only team. Start it, decide each inject and call ENDEX. Practice runs get no after-action report and no work items. The Ops Room card shows the same progress until you finish or hide it. See [incidents.md](incidents.md#training-incidents) for the training incident.
