#!/usr/bin/env bash
# Crucible CE boot: apply pending migrations, then start the server.
# Migrations are idempotent (prisma migrate deploy applies only what's new),
# so every container boot is safe, including the very first one.
#
# The image has no npm/npx, so both steps call node directly. The server runs
# exactly like `npm run prod:start` minus its `prisma generate` (the client is
# generated at image build time): NODE_ENV=production, server.ts under tsx.
set -euo pipefail

export NODE_ENV=production

echo "[boot] applying database migrations"
node node_modules/prisma/build/index.js migrate deploy

echo "[boot] starting Crucible CE"
exec node --import tsx server.ts
