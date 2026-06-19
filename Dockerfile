# syntax=docker/dockerfile:1.7
# ChampHarbinger — Next.js 16 standalone build.
# Built on node:20-alpine. Multi-stage to keep the final image small.

ARG NODE_VERSION=20-alpine

# ----------------------------------------------------------------------------
# deps — install production + build deps
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc6-compat is occasionally needed by Next / sharp on Alpine.
RUN apk add --no-cache libc6-compat
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# build — compile Next.js in standalone mode
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next inlines NEXT_PUBLIC_* at build time. Pass them as build args if you
# want the client bundle to include them; otherwise they'll be baked as empty.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_HARBINGER_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_HARBINGER_APP_URL=$NEXT_PUBLIC_HARBINGER_APP_URL
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=$NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
# `next build` evaluates route modules to collect page data; the db client
# (db/index.ts) and ai env (src/lib/ai/env.ts) validate these at import. The
# build never connects to anything — supply harmless placeholders so the checks
# pass. Real values are injected by Railway at runtime in the runner stage.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV OPENROUTER_API_KEY=sk-build-time-placeholder
RUN pnpm build

# ----------------------------------------------------------------------------
# runner — minimal runtime image
# ----------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Drizzle schema + migration files (added by Stream A — required so the
# release-phase migration script can find them at runtime).
COPY --from=builder --chown=nextjs:nodejs /app/db ./db

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
