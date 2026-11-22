# Contributing

Crucible CE does not accept outside code contributions. Report bugs and request features in GitHub issues. For security issues, see [SECURITY.md](SECURITY.md).

## Development

These notes are for the maintainers and for anyone running internal modifications.

### Set up

See [docs/install.md](docs/install.md#from-source-development).

1. Install Node 24.
2. `npm ci`
3. Copy `.env.example` to `.env.local` and to `.env`.
4. `npx prisma generate`
5. `npm run db:up`
6. `npx prisma migrate deploy`
7. `npm run dev:full`

### Checks

- CI (`.github/workflows/ci.yml`) runs `npx prisma generate`, `npm run typecheck`, `npm run lint`, `npm test`, `npx next build` and the e2e suite. It runs on every push to main and every pull request. Run the same checks before you push.
- Don't use em or en dashes in user-visible text.
- Schema changes need a migration (`npx prisma migrate dev`). Migrations apply when the container boots, so plan for existing installs.
- Check every command, variable and path in the docs against the code.

### Run the e2e suite

`e2e/` holds the release smoke suite. Playwright (Chromium) drives the real Docker image through setup, members, incidents, chat, paging, the lock, calendar feeds, closing, a signed export, org admin, the three exercise modes with guests, the after-action flow to a verified evidence bundle, Studio, the schedule and reports, Cloud notes, two-factor, sign-out and a few security checks.

You need Docker and Node 24. Once:

```bash
npm ci
npx playwright install chromium
```

Then:

```bash
npm run test:e2e          # build the image, start the stack, run every spec, tear it down
npm run test:e2e:report   # open the HTML report of the last run
```

| Item | Value |
| --- | --- |
| Compose project | `ce-e2e` (`docker-compose.yml` plus `e2e/docker-compose.e2e.yml`) |
| App | http://localhost:3200 |
| Mailpit | http://127.0.0.1:8226 |
| Webhook receiver | http://127.0.0.1:3299 |
| Secrets and signing key | Generated per run in `e2e/.state/` (gitignored) |
| Stack logs | `test-results/e2e-stack.log` |

The suite does not touch a `crucible-ce` project on the same machine. It ends with `docker compose down -v`.

Specs run in file order on one worker. Each one uses state from the one before. To debug one spec:

```bash
E2E_KEEP_STACK=1 npm run test:e2e                     # full run, leave the stack up
E2E_EXTERNAL_STACK=1 npm run test:e2e -- 06-paging    # rerun one spec against it
npm run e2e:down                                      # remove the stack and its volumes
```

A spec that changes state for good (setup, close, sign-out) passes again only after a fresh `npm run test:e2e`.

A browser console error or an unexpected 4xx or 5xx response fails the test. A test that expects one declares it with `guard.allowHttp()`.

In CI the suite is the `e2e` job. It uploads the HTML report and stack logs on failure.

### Releases

- A semver tag (`v*`) builds the image and pushes it to `ghcr.io/crucible-ce/crucible-ce`, with SLSA provenance and an SBOM.
- Workflow actions are pinned to full commit SHAs. When you bump one, update the SHA and its `# vX.Y.Z` comment together.
- Security fixes ship out of band. There is no fixed release schedule.
