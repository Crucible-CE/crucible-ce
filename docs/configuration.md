# Configuration

Every environment variable the code reads, with its default. If this page and the code disagree, the code is right. Please open an issue.

- **Docker Compose.** Put values in `.env` next to `docker-compose.yml`. Compose passes only the variables listed in the `app.environment` block. The **Compose** column shows which. See [Variables Compose does not pass](#variables-compose-does-not-pass).
- **From source.** Put values in `.env.local` (Next.js and the socket sidecar) and `.env` (Prisma CLI). See [install.md](install.md#from-source-development).
- Leave a variable blank or remove it to use the default.

## Required

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | none | Password for the bundled Postgres. Builds `DATABASE_URL`. | `.env` only, required |
| `NEXTAUTH_SECRET` | none | Signs sessions, acknowledge links, invite links and two-factor sign-in cookies. Keys are derived per purpose with HKDF. At least 32 characters, not a placeholder. Changing it invalidates open invite and acknowledge links. | passed, required |
| `AUTH_SECRET` | none | Same role as `NEXTAUTH_SECRET`. If both are set, both must be valid. When set, it signs acknowledge and invite links. | set from `NEXTAUTH_SECRET` |
| `MASTER_KEK` | none | Encrypts evidence and sensitive fields. Root of the ledger HMAC key (HKDF info `ledger-v1`), the authenticator secret key (`mfa-totp-v1`) and the recovery-code hash key (`mfa-recovery-v1`). Exactly 32 bytes (64 hex characters, or base64). Not all zeros. **Back it up.** Changing it breaks authenticator apps and recovery codes (security keys keep working) and ledger verification (`key_mismatch`). See [authentication.md](authentication.md#keys-and-backups) and [case-file-exports.md](case-file-exports.md#key-rotation). | passed, required |
| `DATABASE_URL` | none | Postgres connection for the app. Behind PgBouncer, add `?pgbouncer=true`. | set by Compose |
| `DIRECT_URL` | none | Direct Postgres connection for migrations. Can equal `DATABASE_URL`. | set by Compose |

## Network and URLs

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `PUBLIC_URL` | `NEXTAUTH_URL`, then `http://localhost:3000` | The URL users open. Used for email and acknowledge links, exercise join links and calendar files, Twilio signature checks, the CSRF origin for API writes, allowed Socket.io origins and the CSP WebSocket host. Also the WebAuthn relying party. Security keys need `https://` or `http://localhost`, and only work under the host they were registered on. Read at runtime. | passed (default `http://localhost:3000`) |
| `NEXTAUTH_URL`, `AUTH_URL` | none | Auth.js base URL. Also accepted as the app's origin. Set equal to `PUBLIC_URL`. | set from `PUBLIC_URL` |
| `SOCKET_EXTRA_ALLOWED_ORIGINS` | none | Extra origins allowed to open a Socket.io connection, comma-separated. Clients with no `Origin` header still need a valid session. | passed |
| `CRUCIBLE_PORT` | `3000` | Host port Compose publishes. | `.env` only |
| `TRUSTED_PROXY_HOPS` | `0` | Reverse proxies that append to `X-Forwarded-For`. Integer 0 to 10. **Required behind a proxy** (`1` for one proxy). At `0`, every client shares one rate-limit bucket. See [reverse-proxy.md](reverse-proxy.md). | passed |
| `PORT` | `3000` | Port `server.ts` listens on. | fixed by the image |
| `SOCKET_PORT` | `3001` | Port of the dev socket sidecar (`npm run dev:ws`). Production serves Socket.io on `PORT`. | not applicable |
| `CRUCIBLE_VERSION`, `CRUCIBLE_IMAGE_OWNER` | `latest`, `crucible-ce` | Image tag and owner. Only useful once images are published. | `.env` only |

**`PUBLIC_URL` must be the exact URL in the browser**, with scheme, host and port. Otherwise every save, comment and sign-in fails with a 403. The error names both values, for example `Origin http://10.0.0.5:3000 does not match PUBLIC_URL http://localhost:3000; set PUBLIC_URL to the URL users open`. At boot the server logs `[server] CSRF: allowed origin https://...`. Check it with `docker compose logs app`.

## Email

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `SMTP_HOST` | none | Turns on SMTP. Wins over Resend. | passed |
| `SMTP_PORT` | `587`, or `465` with `SMTP_SECURE=true` | SMTP port | passed |
| `SMTP_SECURE` | `false` | `true` = implicit TLS. Otherwise STARTTLS. | passed |
| `SMTP_REQUIRE_TLS` | on, except loopback | Require STARTTLS. On for every host except `localhost`, `127.0.0.1` and `::1`. `false` allows plaintext (a relay without TLS, Mailpit). `true` forces it on loopback. Applies to all email. | passed |
| `SMTP_USER`, `SMTP_PASS` | none | SMTP credentials | passed |
| `SMTP_FROM` | `FROM_EMAIL` | Sender, for example `"Crucible <pager@example.com>"` | passed |
| `RESEND_API_KEY` | none | Turns on Resend when SMTP is not set | passed |
| `FROM_EMAIL` | `noreply@localhost.invalid` | Sender for Resend. Fallback for SMTP. | passed |
| `EMAIL_PROVIDER` | auto | `smtp` or `resend`. Picks one when both are set. | passed |

## Paging and delivery

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | none | Twilio SMS and voice. Also needed for phone verification. Without Twilio, only an administrator override opens a phone. | passed |
| `TWILIO_INBOUND_ACK` | off | `true` once the number's messaging webhook points at `/api/public/twilio/inbound`. Adds "Reply ACK" to texts. | passed |
| `DELIVERY_WEBHOOK_URL` | none | One URL or a comma-separated list | passed |
| `DELIVERY_WEBHOOK_SECRET` | none | HMAC secret. Required. Unsigned webhooks are refused. | passed |
| `DELIVERY_WEBHOOK_URL_N`, `DELIVERY_WEBHOOK_SECRET_N` | none | Extra targets, each with an optional own secret. Any N works in the code. Past `_9`, use the comma-separated list or an override file. | `_2` to `_9` passed |
| `DELIVERY_WEBHOOK_ALLOW_PRIVATE` | `false` | `true` lets webhooks and plugins reach private and loopback addresses and `http://` URLs. Testing only. | passed |
| `DELIVERY_RETRY_BACKOFF_MINUTES` | `1,5,15` | Retry delays after a failed attempt. `0` turns retries off. | passed |
| `DELIVERY_RATE_LIMIT_PER_RECIPIENT_HOUR` | `10` | SMS (and, separately, voice) per phone number per hour. Counts every SMS. Escalations and critical pages are exempt. A limited page is retried later. Other SMS are refused. | passed |
| `DELIVERY_RATE_LIMIT_PER_NUMBER_CEILING_HOUR` | `60` | SMS (and, separately, voice) per phone number per hour, for every page | passed |
| `DELIVERY_RATE_LIMIT_PER_ORG_HOUR` | `100` | SMS (and, separately, voice) per organization per hour, for every page | passed |
| `DELIVERY_ACK_LINK_TTL_HOURS` | `24` | Lifetime of the signed acknowledge link | passed |
| `PROVIDERS_DIR` | `./providers` | Folder of provider plugins | fixed to `/app/providers` |
| `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN` | `https://ntfy.sh`, none, none | Read by `providers/example-ntfy.mjs` | passed |

## Storage and exports

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `EVIDENCE_DIR` | `./uploads/evidence` | Evidence files on the filesystem backend | not passed (default is in the uploads volume) |
| `EXPORT_DIR` | `./uploads/exports` | Case-file exports | not passed (same) |
| `STORAGE_DIR` | `./uploads/documents` | Other stored documents | not passed (same) |
| `MAX_ATTACHMENT_BYTES` | `104857600` (100 MB) | Maximum size of one upload | passed |
| `MAX_CONCURRENT_UPLOADS` | `4` | Uploads processed at once per process. Peak memory is about `2 × MAX_ATTACHMENT_BYTES × MAX_CONCURRENT_UPLOADS`. Extra uploads get `503` with `Retry-After: 5`. | passed |
| `STORAGE_S3_BUCKET` | none | Stores evidence and exports in S3-compatible storage | passed |
| `STORAGE_S3_REGION` | `us-east-1` | S3 region | passed |
| `STORAGE_S3_PREFIX` | empty | Key prefix in the bucket | passed |
| `STORAGE_S3_ENDPOINT` | AWS | Custom endpoint for R2, MinIO or B2 (path-style) | passed |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | none | S3 credentials, read by the AWS SDK. The bucket region comes from `STORAGE_S3_REGION`. | passed |
| `EXPORT_SIGNING_PRIVATE_KEY` | none | Ed25519 private key, PKCS8 PEM, raw or base64. Without it, exports are off and ledger heads are unsigned. It also signs after-action reports; without it reports cannot be signed. An invalid value prints a boot warning. See [case-file-exports.md](case-file-exports.md#key-rotation). | passed |
| `CXZ_PASSPHRASE` | none | Read by `npm run verify-export`. Used by the recipient. | not applicable |
| `EXPORT_VERIFY_PUBLIC_KEY` | none | Read by `npm run verify-export`. The sender's pinned public key (path, PEM or base64), same as `--public-key`. Without it the verifier exits `3` unless `--allow-untrusted` is passed. Used by the recipient. | not applicable |
| `CLOUD_TRIAL_URL` | none | Crucible Cloud trial sign-up link. The Cloud page shows "Try Crucible Cloud free for 1 week" and Cloud notes link to the matching card. Unset marks Cloud as coming soon on the page and in every note. Read on the server at request time. | passed |
| `GUEST_CAP_PER_EXERCISE` | `60` | Most guests one exercise takes. Guests join with an invite code and no account. See [exercises.md](exercises.md#invites-and-joining). | passed |

Storage backends are the local filesystem (default) and S3-compatible storage.

## Security and limits

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `ACTIVITY_IP_SALT` | none | Salt for hashing IPs, and the typed email of failed sign-ins and resets for unknown accounts, in the activity log. Unset means neither is recorded. | passed |
| `KMS_PROVIDER` | unset | Not supported. Leave it unset. Any value other than `env` stops the server at boot. | not passed |
| `FEATURE_CLOSURE_REQUIRE_FINAL_POSTMORTEM` | `false` | `true` makes closing require a finalized postmortem, not a draft | passed |
| `PHONE_DEFAULT_COUNTRY_CODE` | `1` | Country code for numbers entered without `+` | passed (default `1`) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | random per build | Nothing to set. CE has no Server Actions. | not applicable |
| `CRUCIBLE_PEER_IP_HEADER` | internal | Set by `server.ts` at boot. Don't set it. | internal |

## Runtime

CE runs as one process with the web app, Socket.io and cron jobs. Run one app container.

| Variable | Default | Purpose | Compose |
| --- | --- | --- | --- |
| `REDIS_URL` | none | Redis for rate limits and cron locks. **Required.** `docker-compose.yml` runs Redis and sets it. See the warning below. | set by Compose |
| `NEXT_PUBLIC_SOCKET_URL`, `NEXT_PUBLIC_APP_URL` | same origin | Extra Socket.io endpoints and origins. Build time. | not applicable at runtime |
| `NEXT_PUBLIC_APP_ENV` | from `NODE_ENV` | `production`, `preview` or `development`. Non-production shows a badge. Build time. | not applicable at runtime |
| `NEXT_PUBLIC_SOURCE_URL` | `https://github.com/Crucible-CE/crucible-ce` | Target of the "Source code" link in the user menu. Build time. | not applicable at runtime |
| `PRISMA_CONNECTION_LIMIT` | `15` | Prisma pool size when the URL has no `connection_limit` | **not passed** |
| `PRISMA_POOL_TIMEOUT` | `5` | Prisma pool wait in seconds when the URL has no `pool_timeout` | **not passed** |
| `NODE_ENV` | `production` in the image | Node mode | set by the image |

> **Without Redis, rate limits fail open.** If Redis is unset or down, sign-in, password reset, registration and other limits allow every request. A warning is logged. Two-factor sign-in keeps its database limits (see [authentication.md](authentication.md#limits-on-wrong-codes)). Cron locks fall back to a process lock. `/api/health` reports `degraded`. Keys are prefixed with `NODE_ENV`.

`NEXT_PUBLIC_` variables are fixed when `next build` runs. Changing them in `.env` does nothing for a pre-built image.

## Variables Compose does not pass

Don't edit `docker-compose.yml`. It changes on upgrade. Create `docker-compose.override.yml` next to it. Compose merges it automatically.

```yaml
services:
  app:
    environment:
      PRISMA_CONNECTION_LIMIT: "25"
      DELIVERY_WEBHOOK_URL_10: ${DELIVERY_WEBHOOK_URL_10:-}
```

Then run `docker compose up -d`. Add `--build` when you build from source.
