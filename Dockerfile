# syntax=docker/dockerfile:1
#
# Crucible CE production image.
#
# IMPORTANT — this is NOT a `next start` image. Production runs the custom
# Socket.io + node-cron server (server.ts) under tsx: server.ts and everything
# it imports from src/ are executed AS TYPESCRIPT AT RUNTIME, not compiled
# ahead of time. So the runtime stage needs the source tree (src/, server.ts,
# tsconfig.json for the @/ path alias, next.config.mjs), not just `.next`. It
# also needs prisma/ (schema + migrations): the entrypoint applies migrations
# at boot.
#
# Hardening (see docs/install.md, "Image hardening"):
#   - base image pinned by digest and OS packages upgraded at build time;
#   - runtime node_modules pruned to production dependencies (tsx and the
#     prisma CLI are production dependencies for exactly this reason);
#   - no npm / npx / corepack / yarn in the final image (the entrypoint calls
#     node directly; /usr/local/bin/npm is a stand-in that only runs the
#     reset-password recovery command);
#   - every app file is owned by root and read-only to the app user; only
#     /app/uploads (the data volume) and /app/.next/cache are writable;
#   - runs as an unprivileged user and works with a read-only root filesystem
#     (docker-compose.yml runs it that way, with a tmpfs /tmp).
#
# node:24-bookworm-slim does not ship OpenSSL, which the Prisma engines need
# at both `prisma generate` and runtime, so the base stage installs it.

# Pinned by digest (multi-arch index). To update: docker buildx imagetools
# inspect node:24-bookworm-slim, then replace the digest below.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# ---------------------------------------------------------------------------
# Stage: base — patched OS + OpenSSL, shared by every stage.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends openssl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# ---------------------------------------------------------------------------
# Stage: deps — install ALL dependencies (including devDependencies).
# ---------------------------------------------------------------------------
# `next build` needs build-time devDependencies (@tailwindcss/postcss,
# tailwindcss, postcss, typescript, @types/*) to compile CSS and typecheck.
# --include=dev survives anyone exporting NODE_ENV=production as a build arg.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# ---------------------------------------------------------------------------
# Stage: build — generate the Prisma client, run `next build`, then prune
# node_modules down to production dependencies for the runtime stage.
# ---------------------------------------------------------------------------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `next build` (and `prisma generate` beforehand, via prod:build) needs a
# resolvable DATABASE_URL and a few other envs even though no live DB is
# contacted at build time. Fonts are self-hosted (src/app/fonts), so the
# build makes no font-CDN calls.
ARG DATABASE_URL=postgresql://u:p@127.0.0.1:5432/db
ARG DIRECT_URL=postgresql://u:p@127.0.0.1:5432/db
ARG NEXTAUTH_SECRET=build-placeholder-secret
ARG AUTH_SECRET=build-placeholder-secret
ARG MASTER_KEK=0000000000000000000000000000000000000000000000000000000000000000
ENV DATABASE_URL=${DATABASE_URL} \
    DIRECT_URL=${DIRECT_URL} \
    NEXTAUTH_SECRET=${NEXTAUTH_SECRET} \
    AUTH_SECRET=${AUTH_SECRET} \
    MASTER_KEK=${MASTER_KEK} \
    NODE_ENV=production

# After the build: drop the build cache (large, not needed at runtime) and
# prune devDependencies. The generated Prisma client (node_modules/.prisma)
# and the downloaded Prisma engines survive the prune; the tests fail the
# build if they ever stop doing so.
RUN npm run prod:build \
    && rm -rf .next/cache \
    && npm prune --omit=dev \
    && test -f node_modules/.prisma/client/index.js \
    && test -f node_modules/prisma/build/index.js \
    && test -d node_modules/tsx

# ---------------------------------------------------------------------------
# Stage: runtime.
# ---------------------------------------------------------------------------
# The app never needs a package manager at runtime, so npm, npx, corepack and
# yarn (and their bundled dependencies) are removed from the final image.
FROM base AS runtime
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /usr/sbin/nologin --create-home nextjs \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Everything below is copied owned by root (COPY's default), so the app user
# can read but not modify the code it runs.

# Production node_modules (pruned in the build stage, generated Prisma client
# included). Copying files does not carry the build stage's ARG/ENV values.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Build output.
COPY --from=build /app/.next ./.next

# Runtime source: server.ts imports from src/ and tsx executes it as
# TypeScript, so the source tree ships as-is (not just compiled output).
COPY --from=build /app/src ./src
COPY --from=build /app/server.ts /app/load-env.ts /app/tsconfig.json /app/next.config.mjs ./

# Prisma schema + migrations for the boot-time `prisma migrate deploy`.
COPY --from=build /app/prisma ./prisma

# Static assets (branding).
COPY --from=build /app/public ./public

# Delivery-provider plugins folder (README + example). docker-compose mounts
# the host ./providers read-only over it, so custom plugins replace these.
COPY --from=build /app/providers ./providers

# License and third-party notices (including the bundled fonts' OFL).
COPY --from=build /app/LICENSE /app/NOTICE ./

# Boot: apply migrations, then start the server.
COPY --from=build --chmod=0755 /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Server recovery command (docs/authentication.md, "Reset a password"). npm
# itself is gone, so a small stand-in at /usr/local/bin/npm runs only
# `npm run reset-password -- ...` (node + tsx, like the server).
# Evidence bundle check for signed after-action reports, runnable in the image:
#   docker compose exec app npm run verify-bundle -- --key <keyId> bundle.zip
COPY --from=build /app/scripts/reset-password.ts ./scripts/reset-password.ts
COPY --from=build /app/scripts/verify-bundle.ts ./scripts/verify-bundle.ts
COPY --from=build --chmod=0755 /app/scripts/container-npm.sh /usr/local/bin/npm

# The only writable paths: the data volume, and Next's runtime cache (image
# optimization / fetch cache). Under a read-only root filesystem, mount the
# volume on /app/uploads and a tmpfs on /tmp and /app/.next/cache.
RUN mkdir -p /app/uploads /app/.next/cache \
    && chown nextjs:nodejs /app/uploads /app/.next/cache
VOLUME ["/app/uploads"]

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
