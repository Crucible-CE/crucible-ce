# Delivery providers

Each page and escalation goes to every configured delivery provider. CE has five built-in providers, set with environment variables. You can add your own as plugins. For paging behavior, see [paging.md](paging.md).

| Provider id | Channel | Configured by | Receives |
| --- | --- | --- | --- |
| `smtp` | email | `SMTP_HOST` (+ `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) | Targets with an email address |
| `resend` | email | `RESEND_API_KEY` + `FROM_EMAIL` | Targets with an email address |
| `twilio-sms` | sms | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Targets with a phone number |
| `twilio-voice` | voice | Same as SMS | Targets with a phone number |
| `webhook`, `webhook-2`, ... | webhook | `DELIVERY_WEBHOOK_URL` + `DELIVERY_WEBHOOK_SECRET` | Every page |
| Plugins | any | Your module | Every page |

Email uses one transport.

- SMTP when `SMTP_HOST` is set. Otherwise Resend.
- With neither, email pages show `skipped: not configured`.
- `EMAIL_PROVIDER=smtp|resend` picks one when both are set.
- The same transport sends invites, verification and password-reset mail.

**Org admin > Delivery settings** lists every provider and whether it is configured. **Send test** sends a test message to your own email and phone.

## Signed webhook

Use the webhook to reach ntfy, a Signal or Matrix bridge, PagerDuty Events (through a relay), Opsgenie, or your own service.

```env
DELIVERY_WEBHOOK_URL=https://hooks.example.com/crucible      # or a comma-separated list
DELIVERY_WEBHOOK_SECRET=<openssl rand -hex 32>               # required: unsigned webhooks are refused
DELIVERY_WEBHOOK_URL_2=https://other.example.com/hook        # optional extra targets
DELIVERY_WEBHOOK_SECRET_2=<its own secret>                   # optional; defaults to DELIVERY_WEBHOOK_SECRET
```

- The code accepts any `DELIVERY_WEBHOOK_URL_N`. `docker-compose.yml` passes `_2` to `_9`. For more, use a `docker-compose.override.yml`. See [configuration.md](configuration.md#variables-compose-does-not-pass).
- Each target is its own provider (`webhook`, `webhook-2`, ...) with its own delivery rows and retries.

| Rule | Behavior |
| --- | --- |
| Request | `POST`, `Content-Type: application/json` |
| Timeout | 10 seconds |
| Redirects | Not followed. A `3xx` counts as failed. |
| Success | Any `2xx`. Anything else is retried. |
| Address check | Private, loopback, link-local, CGNAT, multicast and documentation addresses are refused. Every resolved address is checked at connect time. |
| Scheme | https only. An `http://` URL shows as not configured, and the boot log warns. |
| Secret | Required. Without one, the webhook is never sent to. |

`DELIVERY_WEBHOOK_ALLOW_PRIVATE=true` turns off the address check and allows `http://`. Use it only to test against `localhost` or the compose network. **Never set it in production.**

### Headers

| Header | Value |
| --- | --- |
| `X-Crucible-Timestamp` | Unix seconds when the request was signed |
| `X-Crucible-Signature` | `t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` |
| `X-Crucible-Event` | `crucible.page`, `crucible.escalation`, `crucible.ack`, `crucible.broadcast` or `crucible.test` |
| `X-Crucible-Delivery` | Idempotency key. Same as `id` in the body. Unchanged across retries. |
| `X-Crucible-Delivery-Attempt` | Attempt number. Same as `attempt` in the body. |

### Payload (version 1)

```json
{
  "version": 1,
  "type": "crucible.page",
  "id": "cm3x...:0:webhook",
  "attempt": 1,
  "restricted": false,
  "sentAt": "2026-10-14T12:00:00.000Z",
  "title": "[CRITICAL] Paged: Ransomware on file servers",
  "text": "Ada Lovelace paged you to a critical incident. Note: join the bridge",
  "ackUrl": "https://crucible.example.com/api/public/page-ack/cm3x....0.1760530000.Q2FmZ...",
  "incident": {
    "id": "cm3w...",
    "title": "Ransomware on file servers",
    "severity": "critical",
    "url": "https://crucible.example.com/incidents/cm3w..."
  },
  "page": { "id": "cm3x...", "level": 0, "priority": "critical" },
  "recipient": {
    "name": "Grace Hopper",
    "email": "grace@example.com",
    "phone": "+15551234567",
    "userId": "cm1u...",
    "contactId": null
  }
}
```

| Field | Notes |
| --- | --- |
| `type` | `crucible.page` is a new page. `crucible.escalation` means the page moved to the next role, and `page.level` goes up. `crucible.ack` means it was acknowledged. It is best effort with no retry. `crucible.test` comes from **Send test**, with `incident`, `page` and `ackUrl` set to `null`. `crucible.broadcast` is a Messaging broadcast to one person, with `incident` and `page` set to `null` and an `ackUrl`. |
| `id` | `<pageId>:<level>:<providerId>`. Stable across retries of the same level. Dedupe on it. |
| `attempt` | 1, then 2, 3, ... on retries. Covered by the signature. |
| `restricted` | `true` for a locked incident the target can't see. See below. |
| `ackUrl` | Signed, single-use acknowledge link. Forward it to the person. Anyone with it can acknowledge. `null` on `crucible.ack` and `crucible.test`. |
| `recipient` | The target's addresses. `contactId` is set for an external contact, `userId` for a member. |

When `restricted` is `true`, the payload carries only the severity and the ack link.

- `title` is `[SEV] Restricted incident page`.
- `text` is `Crucible: you are paged for a restricted incident (severity X).`
- `incident` is `{ "id": "", "title": "Restricted incident", "severity": "...", "url": "" }`.
- `crucible.ack` notices for a locked incident are always restricted.

Show nothing more.

### Verify the signature

Verify against the **raw** request body, before you parse it. Reject timestamps more than 5 minutes old.

**Node.js**

```js
const crypto = require("node:crypto");

function verifyCrucible(secret, rawBody, header, toleranceSec = 300) {
  const parts = Object.fromEntries(
    String(header || "").split(",").map((kv) => kv.trim().split("=", 2)),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express: app.post("/crucible", express.raw({ type: "application/json" }), (req, res) => {
//   if (!verifyCrucible(process.env.SECRET, req.body.toString("utf8"), req.get("X-Crucible-Signature")))
//     return res.sendStatus(401);
//   const event = JSON.parse(req.body); ...; res.sendStatus(204);
// });
```

**Python**

```python
import hashlib, hmac, time

def verify_crucible(secret: str, raw_body: bytes, header: str, tolerance: int = 300) -> bool:
    parts = dict(p.strip().split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(int(time.time()) - t) > tolerance or "v1" not in parts:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])

# Flask: verify_crucible(SECRET, request.get_data(), request.headers.get("X-Crucible-Signature"))
```

## Write a plugin

Plugins are JavaScript modules (`.js`, `.mjs` or `.cjs`) in `PROVIDERS_DIR`.

| Install | Folder |
| --- | --- |
| From source | `./providers` (default) |
| Docker | `/app/providers`, mounted read-only from `./providers` in your checkout |

- The server imports each top-level file once at boot and logs what it loaded. After a change, run `docker compose restart app`.
- Files whose names start with `.` or `_` are skipped.
- A plugin that fails to import, throws in its factory, has the wrong shape or reuses an id is logged and skipped. The server keeps running. **Org admin > Delivery settings** lists load errors.

> **Security.** A plugin runs inside the Crucible process with full app privileges. That includes database credentials, `MASTER_KEK`, every record the app can decrypt, and the network. Read it, pin it, and keep the providers folder writable by administrators only.

### Contract

The default export is a provider object, or a factory (sync or async) that gets `{ env, logger, guardedPost }` and returns one.

```ts
type Channel = "email" | "sms" | "voice" | "push" | "webhook" | "custom";

interface DeliveryProvider {
  id: string;              // unique, /^[a-z0-9][a-z0-9._-]{0,63}$/, not a built-in id
  displayName: string;
  channels: Channel[];     // non-empty; the first is recorded on delivery rows
  isConfigured(): boolean; // cheap + synchronous; unconfigured plugins are left out of fan-out
  notConfiguredReason?(): string | null; // optional: shown in Org admin > Delivery settings when not configured
  send(message: DeliveryMessage, recipient: DeliveryRecipient): Promise<DeliveryResult>;
}

interface DeliveryMessage {
  kind: "page" | "escalation" | "ack" | "test" | "broadcast";
  id: string;              // idempotency key "<pageId>:<level>:<providerId>", same on every retry
  attempt: number;         // 1, 2, 3, ... (retries count up)
  restricted?: boolean;    // locked incident the target can't see: severity + ack link only
  incident: { id: string; title: string; severity: string; url: string } | null;
  page: { id: string; level: number; priority: string } | null;
  title: string;           // one-line headline
  text: string;            // plain-text body
  ackUrl: string | null;   // signed single-use acknowledge link
  sentAt: string;          // ISO-8601
}

// What the factory receives.
interface ProviderContext {
  env: NodeJS.ProcessEnv;
  logger: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
  // SSRF-guarded POST: https only (http:// and private targets only with
  // DELIVERY_WEBHOOK_ALLOW_PRIVATE=true), every resolved address checked at
  // connect time, no redirects, hard timeout (default 10 s, max 20 s).
  // Resolves { status, body (first 2 KB) }; rejects on a blocked target or a transport error.
  guardedPost(url: string, opts: { headers?: Record<string, string>; body: string; timeoutMs?: number }): Promise<{ status: number; body: string }>;
}

interface DeliveryRecipient {
  name: string;
  email?: string | null;
  phone?: string | null;   // E.164
  userId?: string | null;
  contactId?: string | null;
}

interface DeliveryResult {
  status: "sent" | "failed" | "skipped";
  providerRef?: string;    // your remote id, shown in the audit trail
  error?: string;          // why it failed or was skipped
}
```

Rules:

- `send` is called once per page or escalation attempt, and best effort for `ack` notices.
- If you can't reach the recipient, return `{ status: "skipped", error }`. Don't throw.
- A throw, a hang over **20 seconds** or a malformed result is recorded as `failed`.
- `failed` is retried on the backoff (1, 5 and 15 minutes by default). `message.id` is the same on every retry. `message.attempt` counts up. A crash mid-send also causes a retry, so the same `id` can arrive twice. Dedupe on it.
- Use `ctx.guardedPost` for HTTP, not `fetch()`. It applies the same address check as the webhook.
- When `message.restricted` is `true`, show only what the message carries. Don't look the incident up.
- Read settings from `env` in the factory. In Docker, add your variables to the `app` service's `environment:` block.

See [`providers/example-ntfy.mjs`](../providers/example-ntfy.mjs) for a complete example. It sends ntfy push notifications with an **Acknowledge** button.

### Test a plugin

```bash
# Load + validate only
npm run provider:test -- ./providers/my-provider.mjs --dry-run
# Send one realistic page through it
NTFY_TOPIC=my-test-topic npm run provider:test -- ./providers/example-ntfy.mjs
npm run provider:test -- ./providers/my-provider.mjs --kind escalation --email me@example.com --phone +15551234567
```

- Run it from a source checkout after `npm ci`, not inside the container.
- Plugin settings come from your shell environment.
- The harness uses the server's loader, validation and timeout. It sends one message and prints the result.

| Exit code | Result |
| --- | --- |
| `0` | sent |
| `2` | skipped |
| `1` | failed or not loadable |
