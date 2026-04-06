# Multi-stage build for the HuisHype background worker
# Build context: monorepo root (.)

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN apk add --no-cache git python3 make g++
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm rebuild sharp better-sqlite3 2>/dev/null || true

FROM deps AS build
COPY packages/shared/ packages/shared/
COPY services/api/ services/api/
COPY services/worker/ services/worker/
RUN pnpm --filter @huishype/shared build && \
    pnpm --filter @huishype/api build && \
    pnpm --filter @huishype/worker build

FROM node:22-alpine AS production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/worker/package.json ./services/worker/package.json
COPY --from=build /app/services/worker/dist ./services/worker/dist

RUN addgroup -g 1001 -S huishype && adduser -S -u 1001 huishype
USER huishype

ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "services/worker/dist/index.js"]
