# syntax=docker/dockerfile:1.7
# Sprixy — single container: API + web UI + remote MCP endpoint. No GPU required.

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app

# ── Build ──
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sprixy/web build \
 && pnpm --filter @sprixy/server build \
 && pnpm --filter @sprixy/docs build

# ── Production dependencies only ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/client/package.json packages/client/
COPY packages/mcp/package.json packages/mcp/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
# Optional deps must stay enabled: sharp ships its native binaries as optional packages.
# (ffmpeg itself comes from Debian below and is selected through FFMPEG_PATH.)
RUN pnpm install --prod --frozen-lockfile --filter @sprixy/server...

# ── Runtime ──
FROM node:${NODE_VERSION} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3210 \
    HOST=0.0.0.0 \
    SPRIXY_DATA_DIR=/data \
    SPRIXY_WEB_DIST=/app/apps/web/dist \
    SPRIXY_DOCS_DIST=/app/apps/docs/dist \
    FFMPEG_PATH=/usr/bin/ffmpeg
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/docs/dist ./apps/docs/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
