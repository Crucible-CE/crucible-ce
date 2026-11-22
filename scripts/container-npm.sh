#!/bin/sh
# Installed as /usr/local/bin/npm in the production image, which ships without
# npm (see Dockerfile). It runs the one npm script operators need inside the
# container, so the documented command works there as it does from source:
#
#   docker compose exec app npm run reset-password -- --email you@example.com [--reset-mfa]
#   docker compose exec app npm run verify-bundle -- --key <keyId> bundle.zip
set -eu

if [ "${1:-}" = "run" ] && [ "${2:-}" = "reset-password" ]; then
  shift 2
  if [ "${1:-}" = "--" ]; then shift; fi
  cd /app
  exec node --import tsx scripts/reset-password.ts "$@"
fi

if [ "${1:-}" = "run" ] && [ "${2:-}" = "verify-bundle" ]; then
  shift 2
  if [ "${1:-}" = "--" ]; then shift; fi
  exec node --import tsx /app/scripts/verify-bundle.ts "$@"
fi

echo "npm isn't installed in this image. Available: npm run reset-password -- --email <email> [--reset-mfa], npm run verify-bundle -- --key <keyId> <bundle.zip>" >&2
exit 1
