# syntax=docker/dockerfile:1
#
# One image for `docker compose --profile app up`: the API, the web app and the
# one-shot database setup all run from it with different commands. See
# "Run everything in Docker" in README.md.
#
# Built for running IWM locally. It keeps the full pruned workspace (dev
# dependencies included) because the setup step needs the Prisma CLI and tsx.

FROM node:22-bookworm-slim AS base
# Prisma's engines need OpenSSL, which the slim image leaves out.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm \
  npm_config_store_dir=/pnpm/store \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  TURBO_TELEMETRY_DISABLED=1 \
  NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Keep only the API, the web app and the packages they use. Desktop and mobile
# never reach the install step.
FROM base AS pruner
COPY . .
# The turbo version package.json asks for, so a dependency bump moves both.
RUN pnpm dlx "turbo@$(node -p "require('./package.json').devDependencies.turbo")" \
  prune @botss/api @botss/web --docker

# Install from package manifests only, so a source change reuses this layer.
FROM base AS deps
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY .npmrc ./
# @botss/database runs `prisma generate` on install and needs its schema.
COPY packages/database/prisma/schema.prisma ./packages/database/prisma/schema.prisma
RUN --mount=type=cache,id=iwm-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=pruner /repo/out/full/ ./
# Every package tsconfig extends this; prune does not copy root files.
COPY tsconfig.base.json ./
RUN pnpm exec turbo run build --filter=@botss/api --concurrency=1

# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build
# arguments, not runtime env. docker-compose.yml passes them from .env.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_API_BASE_PATH=/api/v1
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ARG NEXT_PUBLIC_ADMIN_EMAIL=admin@example.com
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ARG NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY=
ARG NEXT_PUBLIC_CPANEL_DOMAIN=
ARG NEXT_PUBLIC_MAIL_DEFAULT_IMAP_HOST=
ARG NEXT_PUBLIC_MAIL_DEFAULT_SMTP_HOST=
# The web build runs outside turbo so the NEXT_PUBLIC_* args reach `next build`
# whatever turbo's env filtering does. Its packages are built first.
RUN pnpm exec turbo run build --filter=@botss/web^... --concurrency=1 \
  && pnpm --filter @botss/web run build \
  && rm -rf apps/web/.next/cache

FROM base AS app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /repo ./
COPY --chown=node:node docker/ ./docker/
# Generated secrets live here (a named volume, see docker-compose.yml). A new
# volume copies this directory's owner, so the API can write to it.
RUN mkdir -p /secrets && chown node:node /secrets
USER node
