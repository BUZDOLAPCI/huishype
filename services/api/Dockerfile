# Multi-stage build for the HuisHype Fastify API
# Build context: monorepo root (.)

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apk add --no-cache git
WORKDIR /app

# --- Install all dependencies (dev + prod for build) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mocks/package.json packages/mocks/
COPY services/api/package.json services/api/
COPY apps/app/package.json apps/app/
RUN pnpm install --frozen-lockfile

# --- Build TypeScript ---
FROM deps AS build
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY services/api/ services/api/
RUN pnpm --filter @huishype/shared build && \
    pnpm --filter @huishype/api build

# --- Production image ---
FROM base AS production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mocks/package.json packages/mocks/
COPY services/api/package.json services/api/
COPY apps/app/package.json apps/app/
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/services/api/dist services/api/dist
COPY --from=build /app/services/api/drizzle services/api/drizzle

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
