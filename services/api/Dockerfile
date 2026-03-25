# Multi-stage build for the HuisHype Fastify API
# Build context: monorepo root (.)

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apk add --no-cache git python3 make g++
WORKDIR /app

# --- Install dependencies ---
# --ignore-scripts: skip prepare scripts (maplibre-gl fork's prepare needs
# canvas native addon build tools we don't want to install; our fork already
# has dist/ committed so prepare is unnecessary)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mocks/package.json packages/mocks/
COPY services/api/package.json services/api/
COPY apps/app/package.json apps/app/
RUN pnpm install --frozen-lockfile --ignore-scripts
# Rebuild only the native addons the API actually needs
RUN pnpm rebuild sharp better-sqlite3 2>/dev/null || true

# --- Build TypeScript ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY services/api/ services/api/
RUN pnpm --filter @huishype/shared build && \
    pnpm --filter @huishype/api build

# --- Production image ---
FROM node:22-alpine AS production
WORKDIR /app

# Copy node_modules with workspace symlink structure intact
COPY --from=deps /app/node_modules ./node_modules
# Copy built workspace packages the API depends on
COPY --from=build /app/packages/shared ./packages/shared
# Copy built API service
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/api/node_modules ./services/api/node_modules
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/api/drizzle ./services/api/drizzle
# Workspace root config (needed for pnpm module resolution)
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./

# Copy entrypoint
COPY services/api/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Non-root user
RUN addgroup -g 1001 -S huishype && adduser -S -u 1001 huishype
USER huishype

ENV NODE_ENV=production
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3100/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "services/api/dist/index.js"]
