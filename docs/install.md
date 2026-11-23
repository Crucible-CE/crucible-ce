# Install

## Docker Compose (recommended)

Requirements:

- Docker with Compose v2.
- `openssl`, or another way to make random hex.
- At least 4 GB of memory for Docker during the build. About 2 GB to run.
- Internet access for the build (npm packages, Debian updates, Prisma engines).

No image is published yet. The stack builds the app image from this checkout.

### Install

1. Clone the repository and create `.env`.
   ```bash
   git clone https://github.com/Crucible-CE/crucible-ce.git
   cd crucible-ce
   cp .env.docker.example .env
   ```
2. Set the three required secrets in `.env`. Generate each with `openssl rand -hex 32`.

   | Variable | Use | Rule |
   | --- | --- | --- |
   | `POSTGRES_PASSWORD` | Database password | Required |
   | `NEXTAUTH_SECRET` | Signs sessions and acknowledge links | At least 32 characters |
   | `MASTER_KEK` | Encrypts evidence and sensitive fields | Exactly 32 bytes (64 hex characters, or base64) |

3. Set `PUBLIC_URL` to the address your team will use. See [PUBLIC_URL and ports](#public_url-and-ports).
4. Start the stack and read the setup code.
   ```bash
   docker compose up -d --build
   docker compose logs app | grep "setup code"
   ```
   The first build takes several minutes. If `grep` prints nothing, wait a few seconds for migrations and run it again.
5. Open `PUBLIC_URL/setup`. Enter the code (`XXXX-XXXX-XXXX-XXXX`). Create your organization and first administrator.

> **Back up `MASTER_KEK` with your backups.** A database restore without it can't decrypt evidence.

The app does not start if `NEXTAUTH_SECRET` is a placeholder or shorter than 32 characters, or if `MASTER_KEK` is not 32 bytes or is all zeros. `docker compose logs app` says why.

### Setup code

- A restart before setup finishes prints a new code. The old one stops working.
- Setup allows 10 attempts an hour and 10 wrong codes per 15 minutes per client IP. A restart resets both. If you are locked out, run `docker compose restart app` and read the new code.
- Behind a reverse proxy, set `TRUSTED_PROXY_HOPS=1` before you start. Otherwise every visitor shares the proxy's IP and its limits.
- Run a single app container until setup is done. Each instance prints its own code.
- The wizard turns itself off after setup. Everyone else joins by invite link (**Org admin > Members**).

Next, send yourself a test page. See [first-run.md](first-run.md). To run a tabletop exercise, see [exercises.md](exercises.md). Set `EXPORT_SIGNING_PRIVATE_KEY` first if you want signed after-action reports. See [case-file-exports.md](case-file-exports.md#key-rotation).

When images are published to `ghcr.io/crucible-ce/crucible-ce` (amd64 only), you can run `docker compose pull && docker compose up -d`. Until then, always add `--build`.

### PUBLIC_URL and ports

Set `PUBLIC_URL` to the exact URL users open, with scheme and port and no trailing path. The app reads it at startup. It is used for email links, acknowledge links, exercise join links and calendar files, the Twilio signature check and allowed Socket.io origins.

- `CRUCIBLE_PORT` (default `3000`) is the port published on the host. The container always listens on 3000.
- If port 3000 is in use, change both. Example: `CRUCIBLE_PORT=8080` with `PUBLIC_URL=http://localhost:8080`. They must match.
- Behind a reverse proxy, `PUBLIC_URL` is the proxy's https address. See [reverse-proxy.md](reverse-proxy.md).
- Twilio callbacks and the voice "press 1" acknowledgment need an https `PUBLIC_URL` that Twilio can reach.
- The app speaks plain HTTP. Put TLS in front of it for anything beyond localhost.
- Exercise participants open join links on their own devices. With `PUBLIC_URL=http://localhost:3000`, those links work only on the server itself. Set it to an address participants can reach before you invite anyone. See [exercises.md](exercises.md#invites-and-joining).

To change `PUBLIC_URL`, edit `.env` and run `docker compose up -d`. Everyone has to sign in again.

### Behind a reverse proxy

Set `TRUSTED_PROXY_HOPS=1` in `.env`. This is required. At the default `0`, every client looks like the proxy and shares one rate-limit bucket for sign-in, setup and password reset. The server logs a warning if it sees `X-Forwarded-For` while the setting is `0`. See [reverse-proxy.md](reverse-proxy.md) for Caddy and nginx examples.

### Email and other integrations

These are optional.

| Feature | Setting | Docs |
| --- | --- | --- |
| Email (invites, verification, password reset, paging) | `SMTP_HOST` or `RESEND_API_KEY` | [paging.md](paging.md#email) |
| SMS and voice paging | Your Twilio account | [paging.md](paging.md#sms-and-voice-twilio) |
| Webhook and plugin paging | `DELIVERY_WEBHOOK_URL`, plugins | [delivery-providers.md](delivery-providers.md) |
| Signed case-file exports | `EXPORT_SIGNING_PRIVATE_KEY` | [case-file-exports.md](case-file-exports.md) |

Without email:

- Invited members can't verify their address. Use the invite's **Skip email verification** option. See [first-run.md](first-run.md#invite-teammates).
- Password reset mail is not sent.
- Email pages are skipped.

The admin you create in setup is already verified.

Every variable is listed in [configuration.md](configuration.md).

### What runs

| Service | Image | Notes |
| --- | --- | --- |
| `app` | Built from `Dockerfile` | Next.js, Socket.io and cron jobs in one process, port 3000 |
| `postgres` | `postgres:16`, pinned by digest | Volume `crucible_pgdata` |
| `redis` | `redis:7`, pinned by digest | Volume `crucible_redisdata`. Rate limits and cron locks. Required. |

- Uploads (evidence, attachments, exports) live in the `crucible_uploads` volume.
- Postgres and Redis are not published to the host.
- Run exactly one `app` container. There are no settings for replicas.

### Image hardening

These are on by default. Nothing to configure.

- The Node, `postgres` and `redis` base images are pinned by digest. Debian packages are upgraded during the build.
- The runtime image has no devDependencies and no package manager. `npm`, `npx`, `corepack` and `yarn` are removed. The entrypoint runs `prisma migrate deploy`, then `server.ts` under tsx, with `node`.
- `npm` in the image is a small script that runs only `npm run reset-password`. See [authentication.md](authentication.md#server-recovery-command).
- Files under `/app` are owned by root. The app user is `nextjs` (uid 1001). The only writable paths are `/app/uploads` and `/app/.next/cache`.
- Compose sets `read_only: true`, a tmpfs on `/tmp` and `/app/.next/cache`, `cap_drop: [ALL]` and `no-new-privileges`.

A plugin that writes files must write under `/tmp` (lost on restart) or `/app/uploads`. Outside Compose, give the image the same writable mounts.

## From source (development)

Requirements: Node 24 or newer, and Docker for the dev services.

```bash
npm ci
cp .env.example .env.local     # then replace the placeholder secrets
cp .env.local .env             # the Prisma CLI reads .env, not .env.local
npx prisma generate
npm run db:up
npx prisma migrate deploy
npm run dev:full
```

1. **Secrets.** `.env.example` has placeholders. The server won't start with them. Set `NEXTAUTH_SECRET` and `AUTH_SECRET` with `openssl rand -base64 32`. Set `MASTER_KEK` with `openssl rand -hex 32`.
2. **`.env` for Prisma.** Next.js and the socket sidecar read `.env.local`. The Prisma CLI reads only `.env`. Copy the file, or export `DATABASE_URL` and `DIRECT_URL` in your shell. `.env` is git-ignored.
3. **`npm run db:up`** starts `docker-compose.dev.yml`.

   | Service | Port |
   | --- | --- |
   | Postgres (`DIRECT_URL`, migrations) | `5432` |
   | PgBouncer (`DATABASE_URL`, runtime) | `6432` |
   | Redis | `6379` |
   | Mailpit SMTP | `1025` |
   | Mailpit web UI | `8025` |

   The credentials in `.env.example` (`crucible` / `crucible`, database `crucible`) match.
4. **`npm run dev:full`** runs Next.js on port 3000 and the Socket.io and cron sidecar on port 3001. Open http://localhost:3000.
5. **Setup code.** In dev, the code prints to the console the first time you open `/setup`.
6. **Mailpit.** Add `SMTP_HOST=localhost` and `SMTP_PORT=1025` to `.env.local` and restart. Read mail at http://localhost:8025.

Other commands:

| Command | Does |
| --- | --- |
| `npm run db:down` | Stop the dev services |
| `npm run db:reset` | Wipe the dev data |
| `npm test` | Run the tests |
| `npm run db:studio` | Open Prisma Studio |
