# Paging

A page goes out on every configured channel. If nobody acknowledges it, it escalates.

## How it works

1. **Escalation matrix** (`/escalation-matrix`). Contacts for each role. Verification lasts 90 days. Admins get a weekly reminder when it goes stale.
2. **Page.** Open the incident's **Escalation** tab. Page an org member or an external contact, such as an IR retainer. Each page has a 10-minute acknowledgment window.
3. **Delivery.** The page goes to every configured channel for the target. Members also get the in-app alert. The tab shows each page's status per channel.
4. **Escalation.** A server job runs every minute. An unacknowledged page escalates up the incident's roster: tech lead, then incident commander, then executive sponsor. The new target is paged on every channel. When the roster runs out, the page **expires** as unreachable.
5. **Closing stops paging.** Closing or deleting an incident cancels its open pages. You can't page a closed incident.
6. **Locked incidents get redacted pages.** A target who can't see a locked incident still gets paged. The message carries only the severity and the ack link: `Crucible: you are paged for a restricted incident (severity X). Acknowledge: <link>`. This applies on every channel, the SMS `ACK` reply and the ack page. Webhooks and plugins get `restricted: true`. Acknowledgment notices for a locked incident never include the title.

## Channels

| Channel | Needs | Reaches |
| --- | --- | --- |
| In-app | Nothing | Members. The bell, plus a full-screen alert with sound. |
| Email | `SMTP_HOST` or `RESEND_API_KEY` | Anyone with an email address |
| SMS | Twilio | Anyone with a verified phone |
| Voice | Twilio | Anyone with a verified phone |
| Signed webhook | `DELIVERY_WEBHOOK_URL` and `DELIVERY_WEBHOOK_SECRET` | Every page |
| Plugins | A module in `./providers` | Every page |

Addresses:

- **Members.** Their account email. For SMS and voice, the mobile number in **Settings > Notifications**. As a fallback, the phone on a matrix entry linked to them.
- **External contacts.** The email and phone on their matrix entry. To test SMS or voice on yourself, add yourself as a contact.

Phone numbers are stored in E.164 format (`+15551234567`). National input uses `PHONE_DEFAULT_COUNTRY_CODE` (default `1`).

### Phone verification

SMS and voice go only to a verified phone, or one an administrator allowed. This prevents toll fraud. The rule covers pages, escalations and every other SMS Crucible sends.

**Members**

1. Save the number in **Settings > Notifications**.
2. Click **Send code**.
3. Enter the 6-digit code from the text.

- The code expires after 10 minutes and allows 5 wrong guesses.
- Changing the number clears the verification.
- Without Twilio, the page says SMS isn't configured.
- An administrator can choose **Allow unverified phone** for a member in **Org admin > Members** (the member's menu). This is audited. It is cleared when the member changes the number.
- If the member's own number isn't verified, a verified phone on a linked matrix entry is used.

**Contacts**

- Email and phone are verified separately.
- The emailed confirm link verifies the email only (`emailVerifiedAt`).
- The phone is verified by a confirm link sent by SMS (`phoneVerifiedAt`). This needs Twilio.
- **Verify contacts** sends both confirm links.
- An administrator can **Mark email verified** or **Mark phone verified** after checking out of band.
- An administrator can turn on **Allow SMS/voice before verification** for a contact. The matrix shows a toll-fraud warning.
- Editing a contact's number clears its phone verification. It also clears the override, unless an administrator made the edit. Editing the email clears only the email verification.

An unverified phone is recorded as `skipped: phone not verified`. Other channels still go out.

### Unreachable targets

If no email, SMS or voice channel can be attempted, the page still stands. In-app, webhooks, plugins and escalation still run. The pager sees a warning. The incident commander and every administrator get an in-app alert. Verify the phone or configure a provider.

Built-in providers, the webhook payload and plugins are covered in [delivery-providers.md](delivery-providers.md).

## Email

```env
# Any SMTP server (wins when set)
SMTP_HOST=smtp.example.com
SMTP_PORT=587            # 465 with SMTP_SECURE=true
SMTP_SECURE=false        # true = implicit TLS (465); otherwise STARTTLS
SMTP_REQUIRE_TLS=        # default: STARTTLS required for every non-loopback host; false = allow plaintext
SMTP_USER=pager@example.com
SMTP_PASS=...
SMTP_FROM="Crucible <pager@example.com>"
# ...or Resend
RESEND_API_KEY=re_...
FROM_EMAIL=pager@example.com
```

- `SMTP_PORT` defaults to 587, or 465 when `SMTP_SECURE=true`.
- Without `SMTP_SECURE`, the connection must use STARTTLS. `SMTP_REQUIRE_TLS` is on for every host except `localhost`, `127.0.0.1` and `::1`.
- A relay without TLS on a private network, or a Mailpit container reached by hostname, needs `SMTP_REQUIRE_TLS=false`.
- If both SMTP and Resend are set, SMTP is used unless `EMAIL_PROVIDER=resend`.
- With Docker Compose, put these in `.env` and run `docker compose up -d`.

**Without email.** The app still runs. Email pages are `skipped: not configured`. Verification, password-reset and welcome emails are not sent. Invited members need the invite's **Skip email verification** option. The log warns that mail is not being sent.

**Mailpit.** From a source checkout, `npm run db:up` starts [Mailpit](https://mailpit.axllent.org). Set `SMTP_HOST=localhost` and `SMTP_PORT=1025` in `.env.local`. Send a page or use **Org admin > Delivery settings > Send test**. Read it at http://localhost:8025. The Docker Compose install does not include Mailpit.

## SMS and voice (Twilio)

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_FROM_NUMBER=+15551234567
```

Voice calls read the page with inline TwiML. Placing a call needs no public endpoint.

When `PUBLIC_URL` is **https**:

- The call offers **press 1 to acknowledge**.
- Delivery-status callbacks record busy, no answer and undelivered as failed. They are retried.

## Acknowledge

Acknowledging stops escalation and pending retries. It is recorded on the incident ledger with its channel.

| Method | Setup |
| --- | --- |
| In the app | The alert's **Acknowledge** button |
| Ack link | In every page and escalation message. No sign-in needed. |
| SMS reply | Reply `ACK` or `1`. Needs the Twilio setup below. |
| Voice keypress | Press `1` during the call. Needs an https `PUBLIC_URL`. |

### Ack link

- Signed with `AUTH_SECRET`, or `NEXTAUTH_SECRET` if that is unset. Compose sets both to the same value.
- Its host comes from `PUBLIC_URL`. Set that to an address recipients can reach.
- Tied to the page and its current escalation level.
- Expires after `DELIVERY_ACK_LINK_TTL_HOURS` (default 24).
- Opening it shows a confirmation page. The page is acknowledged only when the button is pressed. Mail scanners and link previews can't acknowledge.
- Stops working once the page is acknowledged, escalates or is cancelled.
- Anyone with the link can acknowledge that page. Treat it like a password.
- Messaging broadcasts use the same link and the same SMS and voice limits. See [Messaging](incidents.md#messaging).

### SMS reply setup

1. In the Twilio console, open **Phone Numbers > Manage > Active numbers**, then your number, then **Messaging configuration**.
2. Under "A message comes in", choose **Webhook** and **HTTP POST**.
3. Enter `https://<your PUBLIC_URL>/api/public/twilio/inbound`.
4. Set `TWILIO_INBOUND_ACK=true`. Outgoing texts then include "Reply ACK".

- Every inbound request is checked with your auth token (`X-Twilio-Signature`). `PUBLIC_URL` must match the URL in the console.
- A reply acknowledges the most recent open page sent to that number at the page's current level.
- The status callback (`/api/public/twilio/status`) and voice keypress (`/api/public/twilio/voice`) need no console setup. Crucible sends their URLs with each message and call.

## Retries and limits

### Delivery records

Each attempt on each channel is a delivery row.

| Status | Meaning |
| --- | --- |
| `sent` | Accepted by the provider |
| `failed` | Attempted and refused, with the provider's error |
| `skipped` | Not attempted, with the reason |

The page view shows the latest attempt per provider.

### Retries

- A failed attempt is retried after 1, 5 and 15 minutes. That is 4 attempts at most (`DELIVERY_RETRY_BACKOFF_MINUTES`).
- An attempt stuck in `pending` for over 2 minutes is marked failed and retried.
- An open page whose current level was never delivered is sent again.
- A crash can cause a duplicate, not a missing page. Webhooks and plugins can dedupe on the delivery `id`.
- Retries stop when the page is acknowledged, escalates, expires or is cancelled, or the incident closes or is deleted.

### SMS and voice limits

SMS and voice are capped per rolling hour and counted separately. The counts include every SMS Crucible sends, such as notification SMS, verification codes and contact verification links.

| Variable | Default | Scope |
| --- | --- | --- |
| `DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR` | `10` | Per phone number. Escalations and critical pages are exempt. |
| `DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR` | `60` | Per phone number, every page |
| `DELIVERY_RATE_LIMIT_PER_ORG_HOUR` | `100` | Per organization, every page |

- Over a cap, the attempt is `skipped: rate limited`. Nothing goes to Twilio.
- The page is retried when the window frees, up to 20 attempts.
- The incident commander and every administrator get an in-app alert.
- Non-page SMS over a cap are refused, not queued.
- Email, webhooks and plugins are not metered.

### Pager limits

One person can send at most 30 pages per 10 minutes, and at most 5 to the same target.

### Skip reasons

| Shown | Cause |
| --- | --- |
| `skipped: not configured` | The email, SMS or voice provider is not set up |
| `skipped: no phone number on file` or `no email address on file` | The target has no such address |
| `skipped: phone not verified` | The target's phone is not verified |
| `failed` | The provider refused the send. Its error is shown. |

- Unconfigured webhooks and plugins are left out.
- A webhook without `DELIVERY_WEBHOOK_SECRET`, or with an `http://` URL, is never sent to. **Org admin > Delivery settings** shows why. The boot log warns. `http://` is allowed only with `DELIVERY_WEBHOOK_ALLOW_PRIVATE=true`.
- Readers see a short reason (`rate limited`, `not configured`, `delivery error`), not the provider's raw error. The ledger records the same short reason.

## Independent delivery

Host CE outside your corporate network and identity plane. See [deployment.md](deployment.md). Keep delivery independent too.

- Send email through an outside provider, not your corporate mail server.
- Use your own Twilio account for SMS and voice.
- Point webhooks at services that run elsewhere.
- Keep a printed copy of the escalation matrix.
