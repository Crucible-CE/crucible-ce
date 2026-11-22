# Provider plugins

A plugin adds a delivery channel to Crucible CE. Put a `.js`, `.mjs` or `.cjs` file in this folder. The server loads every top-level file here once at boot.

| Install | Folder |
| --- | --- |
| From source | `./providers` |
| Docker | `/app/providers`. `docker-compose.yml` mounts this folder read-only. |
| Custom | Set `PROVIDERS_DIR`. |

- Files whose names start with `.` or `_` are ignored.
- After a change, run `docker compose restart app`.
- Docker passes only the variables listed in `docker-compose.yml`. Add your plugin's settings to the `app` service's `environment:` block or to a `docker-compose.override.yml`.
- A plugin that fails to load is logged and skipped. The server keeps running. **Org admin > Delivery settings** lists every provider and every load error.

> **Security.** Plugins run inside the app process with its full privileges. That includes the database credentials, `MASTER_KEK` and network access. Install only code you have read. Keep this folder writable by administrators only.

## Contract

```js
// providers/my-provider.mjs
export default function create({ env, logger, guardedPost }) {
  return {
    id: "my-provider",            // unique: lowercase a-z 0-9 . _ - (max 64)
    displayName: "My provider",
    channels: ["push"],           // email | sms | voice | push | webhook | custom
    isConfigured: () => Boolean(env.MY_PROVIDER_TOKEN),
    notConfiguredReason: () => (env.MY_PROVIDER_TOKEN ? null : "MY_PROVIDER_TOKEN is not set"), // optional
    async send(message, recipient) {
      // message.id is the same on every retry ("<pageId>:<level>:<providerId>"). Dedupe on it.
      // message.attempt counts up (1, 2, ...). message.restricted means severity and ack link only.
      const res = await guardedPost("https://api.example.com/notify", {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MY_PROVIDER_TOKEN}` },
        body: JSON.stringify({ title: message.title, text: message.text, ack: message.ackUrl, dedupe: message.id }),
      });
      return res.status < 300 ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}` };
    },
  };
}
```

- You can also default-export the provider object without a factory.
- `send` gets every page and escalation, plus an `ack` notice when a page is acknowledged.
- If it can't reach the recipient (for example, no phone number), return `{ status: "skipped", error: "..." }`.
- Each send has a hard limit of 20 seconds.
- Make HTTP calls with `ctx.guardedPost(url, { headers, body, timeoutMs })`, not `fetch()`. It allows https only, refuses private, loopback, link-local and cloud-metadata targets, follows no redirects and has a hard timeout. `DELIVERY_WEBHOOK_ALLOW_PRIVATE=true` lifts the https and private-target rules for local testing.
- When `message.restricted` is `true`, the page is for a locked incident the target can't see. The message carries only the severity and the ack link. Show nothing more. Don't look the incident up.

The full message and recipient schema is in [docs/delivery-providers.md](../docs/delivery-providers.md).

## Test a plugin

```bash
NTFY_TOPIC=my-test-topic npm run provider:test -- ./providers/example-ntfy.mjs
npm run provider:test -- ./providers/my-provider.mjs --email me@example.com --phone +15551234567
npm run provider:test -- ./providers/my-provider.mjs --dry-run   # load and validate only
```

The harness uses the server's loader and validation. It sends one sample page and prints the result.

| Exit code | Result |
| --- | --- |
| `0` | sent |
| `2` | skipped |
| `1` | failed |

## Example

[`example-ntfy.mjs`](example-ntfy.mjs) sends pages as ntfy push notifications with an **Acknowledge** button. It is inactive until `NTFY_TOPIC` is set.
