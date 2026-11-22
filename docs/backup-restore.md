# Backup and restore

A backup has three parts. You need all three.

| Part | Location | Contents |
| --- | --- | --- |
| Database | Volume `crucible_pgdata` | Incidents, the ledger, members, contacts |
| Uploads | Volume `crucible_uploads` | Evidence, attachments, case-file exports |
| `.env` | Next to `docker-compose.yml` | `MASTER_KEK` and `NEXTAUTH_SECRET` |

> **Keep `MASTER_KEK`.** Evidence and sensitive fields are encrypted with keys derived from it. A restore without the original `MASTER_KEK` can't decrypt them. Store `.env` with the same protection as the data, but not in the same place.

Redis (`crucible_redisdata`) needs no backup.

## Volume names

Compose prefixes volume names with the project name. That is the directory name unless you set `COMPOSE_PROJECT_NAME`. A checkout in `crucible-ce/` gives `crucible-ce_crucible_pgdata` and `crucible-ce_crucible_uploads`. Check yours:

```bash
docker volume ls | grep crucible
```

The commands below use the `crucible-ce_` prefix. Replace it with yours.

## Back up

Stop the app first so the database and uploads match.

```bash
docker compose stop app

# 1. Database (plain SQL)
docker compose exec -T postgres pg_dump -U crucible crucible > crucible-$(date +%F).sql

# 2. Uploads
docker run --rm \
  -v crucible-ce_crucible_uploads:/data:ro \
  -v "$PWD":/backup \
  alpine tar czf /backup/uploads-$(date +%F).tar.gz -C /data .

# 3. Config
cp .env env-backup-$(date +%F)

docker compose start app
```

Copy the three files off this host.

If you use S3-compatible storage (`STORAGE_S3_BUCKET`), evidence and exports are in the bucket. Back up the bucket with your provider's tools, such as versioning or replication.

## Restore

Restore into an empty database before the app first boots on the new host.

```bash
# 1. Put the original .env back (same MASTER_KEK, NEXTAUTH_SECRET, POSTGRES_PASSWORD)
cp env-backup-2026-10-14 .env

# 2. Create the containers and volumes without starting the app
docker compose up --no-start

# 3. Start only Postgres and load the dump
docker compose up -d postgres
docker compose exec -T postgres psql -U crucible crucible < crucible-2026-10-14.sql

# 4. Restore uploads into the volume
docker run --rm \
  -v crucible-ce_crucible_uploads:/data \
  -v "$PWD":/backup \
  alpine tar xzf /backup/uploads-2026-10-14.tar.gz -C /data

# 5. Start everything. Newer migrations apply at boot.
docker compose up -d --build
```

- If step 3 fails, wait for Postgres: `docker compose exec postgres pg_isready -U crucible`.
- Extract uploads as root (the default above) to keep file ownership. The app runs as user 1001.
- The setup wizard stays off after a restore.
- To restore onto a database that already has tables, drop and recreate it first.

> **Warning.** `docker compose down -v` deletes **all** volumes. Run it only on a host you mean to wipe.

## Test the backup

1. Restore into a scratch host or a different checkout directory. A different directory gives different volume names.
2. Sign in.
3. Open an evidence file. This confirms `MASTER_KEK` and the uploads match.
