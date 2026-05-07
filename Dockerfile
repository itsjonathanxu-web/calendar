# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for Fly.io deployment.
# Mirrors the outlook sorter pattern: install the `claude` CLI globally so the app
# can shell out to it and use the Pro/Max subscription quota instead of API tokens.
#
# Single Fly volume mounted at /app/data holds both the SQLite database and
# the CLI's OAuth credentials (HOME is set to /app/data, so ~/.claude lives there).

ARG NODE_VERSION=22

# ─── deps stage ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /app

# Native build tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --include=dev

# ─── build stage ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client only — schema push happens at runtime once the
# DATABASE_URL points at the mounted volume.
RUN npx prisma generate
RUN npx next build

# ─── runtime stage ────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# `claude` CLI globally so /lib/scheduler/claude.ts can spawn it.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# HOME=/app/data — set in fly.toml [env] too, but kept here for local container runs.
ENV HOME=/app/data

# Bring over what we actually need to run.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src/generated ./src/generated

# Make sure the data dir exists before Prisma touches it (volume gets mounted at runtime).
EXPOSE 3000
CMD ["sh", "-c", "mkdir -p /app/data && npx prisma db push --accept-data-loss && exec npx next start -H 0.0.0.0 -p 3000"]
