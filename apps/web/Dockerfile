# Multi-stage build for the HuisHype web app
# Build context: monorepo root (.)
# Produces static files served by nginx

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
# Git needed for github: dependencies (maplibre forks)
RUN apk add --no-cache git
WORKDIR /app

# --- Install dependencies ---
# --ignore-scripts: skip prepare scripts (maplibre-gl fork's prepare needs
# canvas native addon which requires heavy build tools; our fork already has
# dist/ committed so prepare is unnecessary)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY packages/mocks/package.json packages/mocks/
COPY services/api/package.json services/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts

# --- Build ---
FROM deps AS build

# Build-time env vars baked into the static JS bundle
ARG VITE_API_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}

COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/api-client/ packages/api-client/
COPY apps/web/ apps/web/

# Build workspace deps first, then build the Vite web app
RUN pnpm --filter @huishype/shared build && \
    pnpm --filter @huishype/api-client build && \
    pnpm --dir apps/web build

# --- Serve with nginx ---
FROM nginx:alpine AS production
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1
