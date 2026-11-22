# Upgrade

The container applies pending database migrations on every boot (`prisma migrate deploy`).

## Docker Compose

No image is published yet. Build from the repository.

1. Back up first. See [backup-restore.md](backup-restore.md). Migrations only go forward. There is no automatic downgrade.
2. Read the release notes. Breaking changes are listed there with steps.
3. Pull, rebuild and watch the log.
   ```bash
   git pull
   docker compose up -d --build
   docker compose logs -f app     # migrations, then "[boot] starting Crucible CE"
   ```
4. Compare `.env.docker.example` with your `.env` for new variables. Run `git diff HEAD@{1} -- .env.docker.example` after the pull. Unset variables use their defaults. See [configuration.md](configuration.md).
5. If you use a `docker-compose.override.yml`, check that it still applies. The app runs with a read-only root filesystem. See [install.md](install.md#image-hardening).

Expect a short outage while the container restarts.

If a migration fails, the container exits and restarts with the same error. Restore the backup and open an issue with the log.

### To 0.2

0.2 adds exercises and improvement. Its migrations only add tables and columns. Existing incident data does not change. The exercise library (templates, capabilities and frameworks) is seeded on first boot after the upgrade. Set `EXPORT_SIGNING_PRIVATE_KEY` if you want signed after-action reports, and check `PUBLIC_URL` before you invite exercise participants. See [exercises.md](exercises.md).

### Published images

When release images exist at `ghcr.io/crucible-ce/crucible-ce` (amd64 only), upgrade without building.

```bash
docker compose pull
docker compose up -d
```

To pin a release, set `CRUCIBLE_VERSION=0.2.1` in `.env`. The default is `latest`. Pinning works only after that tag is published. Today there is nothing to pull. Use `--build`.

## From source

```bash
git pull
npm ci
npx prisma generate
npx prisma migrate deploy      # needs DATABASE_URL and DIRECT_URL in .env or your shell
```

Then restart `npm run dev:full`. For a production-style run, use `npm run prod` (build, migrate, start). `npm start` starts an existing build through the custom server. Don't use `next start`. It has no Socket.io and no paging crons.
